-- Manual delivery stages (owner decision 2026-11-02; tasks/fulfilment-plan.md "Manual delivery
-- stages", supersedes the §5 Porter dispatch). Porter and self-delivery have no tracker elsewhere:
-- staff move the order through the stages by hand and the customer follows them on /track.
-- Flow: shelf check (online_order_set_availability, unchanged) → online_order_manual_process
-- (refunds for missing units, courier chosen, 'processed') → online_order_manual_advance
-- ('packed' → 'shipped' → 'out_for_delivery'; crossing into shipped does the bill, shipped_qty and
-- email once) → online_order_mark_delivered.
-- online_order_dispatch_manual stays, unused, until prod is on the new functions.
-- Run after migration_online_orders_porter.sql. Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- orders.courier check gains 'self' (shiprocket, porter, self).
-- orders.status check gains 'processed'. Not 'processing': that one means a Shiprocket op holds a
--   lease, and it drives Send back.
-- online_order_manual_process(p_order_id uuid, p_actor uuid, p_courier text) returns jsonb
--   {status, refund_id, all_unavailable, changed, sr_order_id}. p_courier 'porter' | 'self'. Ship
--   order in 'paid' with no op, no AWB, availability set for every item that took stock. Units not
--   available are refunded ('unavailable'; a rebooked order's bill gets the offset). None available
--   → 'cancelled', courier not set. Otherwise 'processed', courier, courier_name ('Porter' |
--   'Bindal''s Creation'), event 'processed' {courier, refund_id}. No bill, no shipped_qty. The plan
--   (with courier) is stored in process_plan; a repeat returns the stored result with changed=false
--   and sr_order_id null. sr_order_id (first call only) is the Shiprocket order created at payment,
--   which the caller cancels best effort.
-- online_order_manual_advance(p_order_id uuid, p_actor uuid, p_target text) returns jsonb
--   {status, bill_id, changed}. p_target 'packed' | 'shipped' | 'out_for_delivery'. Manual ship order
--   with no op. Forward only: target at or behind the current stage → changed=false, no writes.
--   Crossing into shipped: shipped_qty := available_qty, Bill of Supply, job email_shipped (ref
--   'manual'). One event of kind p_target {courier, bill_id when crossing}. A status outside the
--   ladder (cancelled, cancelling...) raises.
-- online_order_mark_delivered: unchanged except an empty reason is allowed for courier porter or
--   self (recorded as 'Delivered by Porter' | 'Delivered by shop').
-- online_order_claim: unchanged except a self order is treated as a Porter order (cancel only), and
--   cancel may also claim a manual order from 'processed' or 'packed'.
-- online_order_cancel and _online_refund_create: unchanged. Cancel already restocks available_qty
--   and refunds qty - refunded_qty, and shipping is refunded once; test file proves it for manual.
-- _order_public_json: unchanged. New orders have no manual_tracking_url, so tracking_url is null.
-- Admin-only is enforced in admin-order-action; execute granted to service_role only.
-- =====================================================================
set local lock_timeout = '3s';

alter table public.orders drop constraint if exists online_orders_courier_check;
alter table public.orders add constraint online_orders_courier_check
  check (courier in ('shiprocket', 'porter', 'self'));

alter table public.orders drop constraint if exists online_orders_status_check;
alter table public.orders add constraint online_orders_status_check check (status in (
  'pending_payment', 'paid', 'processing', 'processed', 'cancelling', 'packed', 'shipped',
  'out_for_delivery', 'delivered', 'payment_failed', 'expired', 'cancelled',
  'rto', 'rto_received', 'ready_for_pickup'));

-- ---------- process by hand (Porter, self) ----------

-- One transaction under the order row lock: the delivery is arranged outside this system, so there
-- is no courier call to fence and no op lease (same shape as online_order_dispatch_manual).
create or replace function public.online_order_manual_process(p_order_id uuid, p_actor uuid, p_courier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_ship jsonb := '[]'::jsonb;
  v_avail int := 0;
  v_left int;
  v_refund uuid;
  v_all boolean;
  v_plan jsonb;
begin
  if p_courier is null or p_courier not in ('porter', 'self') then
    raise exception 'manual_process: courier must be porter or self';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  -- Retry after a lost response: only manual dispatch writes a plan with one of these couriers.
  if o.process_plan ->> 'courier' in ('porter', 'self') and o.status <> 'paid' then
    return jsonb_build_object('status', o.status, 'refund_id', o.process_plan -> 'refund_id',
                              'all_unavailable', o.process_plan -> 'all_unavailable', 'changed', false,
                              'sr_order_id', null);
  end if;
  if o.fulfilment <> 'ship' then
    raise exception 'manual_process: order % is not a ship order', o.order_ref;
  end if;
  if o.status <> 'paid' or o.op_action is not null or o.awb is not null then
    raise exception 'manual_process: order must be paid with no action or courier booking in progress (status %, op %)',
      o.status, o.op_action;
  end if;
  if exists (select 1 from public.order_items i where i.order_id = o.id and i.stock_taken > 0 and i.available_qty is null) then
    raise exception 'availability not set for every item';
  end if;

  -- Same shelf-check outcome as online_order_prepare_process.
  for it in select * from public.order_items where order_id = o.id order by line_no loop
    v_left := it.stock_taken - coalesce(it.available_qty, 0);
    if v_left > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', v_left);
    end if;
    v_avail := v_avail + coalesce(it.available_qty, 0);
    if coalesce(it.available_qty, 0) > 0 then
      v_ship := v_ship || jsonb_build_object('item_id', it.id, 'units', it.available_qty);
    end if;
  end loop;
  v_all := v_avail = 0;
  v_refund := public._online_refund_create(o.id, 'unavailable', v_units, v_all, p_actor);
  -- Second shelf check of a rebooked order: the bill already lists these units.
  if v_refund is not null and o.bill_id is not null then
    perform public._online_bill_offset(v_refund, 'Rebook: unavailable', v_all);
  end if;
  v_plan := jsonb_build_object('courier', p_courier, 'shippable_items', v_ship, 'all_unavailable', v_all,
                               'refund_id', v_refund);

  if v_all then
    update public.orders set status = 'cancelled', process_plan = v_plan, updated_at = now() where id = o.id;
    perform public._online_event(o.id, 'cancelled', 'paid', 'cancelled', p_actor,
      jsonb_build_object('reason', 'no item available', 'refund_id', v_refund, 'courier', p_courier));
    return jsonb_build_object('status', 'cancelled', 'refund_id', v_refund, 'all_unavailable', true,
                              'changed', true, 'sr_order_id', o.sr_order_id);
  end if;

  update public.orders set status = 'processed', courier = p_courier,
         courier_name = case p_courier when 'porter' then 'Porter' else 'Bindal''s Creation' end,
         process_plan = v_plan, process_error = null, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'processed', 'paid', 'processed', p_actor,
    jsonb_build_object('courier', p_courier, 'refund_id', v_refund));
  return jsonb_build_object('status', 'processed', 'refund_id', v_refund, 'all_unavailable', false,
                            'changed', true, 'sr_order_id', o.sr_order_id);
end;
$$;

-- ---------- advance a manual order ----------

-- Forward only, and a later stage completes the earlier ones, so the bill and shipped email hang on
-- crossing into shipped rather than on the target: skipping a stage cannot miss or repeat them.
create or replace function public.online_order_manual_advance(p_order_id uuid, p_actor uuid, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_old_rank int;
  v_target_rank int;
  v_bill int;
  v_data jsonb;
begin
  v_target_rank := case p_target when 'packed' then 2 when 'shipped' then 3 when 'out_for_delivery' then 4 end;
  if v_target_rank is null then
    raise exception 'manual_advance: bad target %', p_target;
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if coalesce(o.courier, '') not in ('porter', 'self') or o.fulfilment <> 'ship' then
    raise exception 'manual_advance: order % is not a manual delivery', o.order_ref;
  end if;
  if o.op_action is not null then
    raise exception 'manual_advance: order % has an operation in progress (%)', o.order_ref, o.op_action;
  end if;
  v_old_rank := case o.status when 'processed' then 1 when 'packed' then 2 when 'shipped' then 3
                              when 'out_for_delivery' then 4 when 'delivered' then 5 end;
  if v_old_rank is null then
    raise exception 'manual_advance: order % cannot advance from status %', o.order_ref, o.status;
  end if;
  if v_old_rank >= v_target_rank then
    return jsonb_build_object('status', o.status, 'bill_id', o.bill_id, 'changed', false);
  end if;

  v_data := jsonb_build_object('courier', o.courier);
  if v_old_rank < 3 and v_target_rank >= 3 then
    -- As online_order_mark_packed: shipped_qty is what left the shop, which the bill and returns read.
    update public.order_items set shipped_qty = coalesce(available_qty, 0) where order_id = o.id;
    update public.order_items i set status = public._item_status(i) where i.order_id = o.id;
    -- Returns the existing bill on a rebooked order; the shelf check already offset it.
    v_bill := public.online_order_create_bos(o.id);
    v_data := v_data || jsonb_build_object('bill_id', v_bill);
    -- Own ref: a rebooked order may already hold the '' email_shipped job of its first shipment.
    perform public._enqueue_job(o.id, 'email_shipped', 'manual');
  end if;
  update public.orders set status = p_target, updated_at = now() where id = o.id;
  perform public._online_event(o.id, p_target, o.status, p_target, p_actor, v_data);
  return jsonb_build_object('status', p_target, 'bill_id', coalesce(v_bill, o.bill_id), 'changed', true);
end;
$$;

-- ---------- mark delivered: reason optional for manual orders ----------

-- Superadmin-only for Shiprocket orders is still enforced in the Edge Function; any admin may
-- mark a manual order delivered (no courier webhook will), so the reason may be left empty.
create or replace function public.online_order_mark_delivered(
  p_order_id uuid, p_actor uuid, p_delivered_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if o.status not in ('shipped', 'out_for_delivery') or o.delivered_at is not null then
    raise exception 'order % must be shipped or out for delivery and not yet delivered (status %)', p_order_id, o.status;
  end if;
  if o.op_action is not null then
    raise exception 'order % has an operation in progress (%)', p_order_id, o.op_action;
  end if;
  if v_reason = '' and o.courier = 'porter' then
    v_reason := 'Delivered by Porter';
  elsif v_reason = '' and o.courier = 'self' then
    v_reason := 'Delivered by shop';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to mark an order delivered';
  end if;
  if p_delivered_at is null or p_delivered_at > now() then
    raise exception 'delivered date cannot be in the future';
  end if;
  if p_delivered_at < now() - interval '30 days' then
    raise exception 'delivered date cannot be more than 30 days ago';
  end if;
  if o.paid_at is not null and p_delivered_at < o.paid_at then
    raise exception 'delivered date cannot be before the order was paid';
  end if;

  update public.orders set status = 'delivered', delivered_at = p_delivered_at, updated_at = now()
   where id = o.id;
  perform public._online_event(o.id, 'delivered', o.status, 'delivered', p_actor,
    jsonb_build_object('manual', true, 'reason', v_reason, 'actor', p_actor));
  perform public._enqueue_job(o.id, 'email_delivered');
  return jsonb_build_object('changed', true, 'status', 'delivered', 'delivered_at', p_delivered_at);
end;
$$;

-- ---------- claim: manual orders ----------
create or replace function public.online_order_claim(
  p_order_id uuid, p_action text, p_actor uuid, p_op_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_target text;
  v_from text;
begin
  if p_action is null or p_action not in ('process', 'cancel', 'send_back', 'rebook') then
    raise exception 'online_order_claim: bad action %', p_action;
  end if;
  v_target := case p_action when 'process' then 'processing' when 'cancel' then 'cancelling' end;
  if p_op_key is null or p_op_key = '' then raise exception 'online_order_claim: op key required'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  v_from := o.status;

  -- Store pickup never goes through Shiprocket, and a manual order has no Shiprocket shipment
  -- to send back or rebook: only cancel may claim either.
  if (o.fulfilment = 'pickup' or o.courier in ('porter', 'self')) and p_action <> 'cancel' then
    return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  -- Admin ops on an order that already holds the same kind of op: resume / busy / take over.
  if p_action in ('send_back', 'rebook') and o.op_action = p_action then
    if o.op_key = p_op_key then
      update public.orders set op_lease_until = now() + interval '5 minutes', updated_at = now()
       where id = o.id returning * into o;
      return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if not coalesce(o.op_lease_until < now(), false) then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'busy',
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claim_takeover', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  if p_action = 'send_back' then
    if o.status <> 'processing' then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_action is distinct from 'process' or not coalesce(o.op_lease_until < now(), false) then
      return jsonb_build_object('claimed', false, 'resumed', false,
        'reason', case when o.op_action is distinct from 'process' then 'other_action' else 'busy' end,
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    -- A fresh key is what fences out the stalled Process worker.
    if o.op_key = p_op_key then raise exception 'online_order_claim: send_back needs a new op key'; end if;
    update public.orders set op_key = p_op_key, op_action = 'send_back', op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claimed', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  if p_action = 'rebook' then
    if o.status not in ('packed', 'shipped', 'out_for_delivery') then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_action is not null then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'other_action',
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_action = 'rebook', op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claimed', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  -- process / cancel (unchanged except: a same-key resume must also be the same action)
  if o.status in ('processing', 'cancelling') then
    if o.op_key = p_op_key and coalesce(o.op_action, '') = p_action then
      update public.orders set op_lease_until = now() + interval '5 minutes', updated_at = now()
       where id = o.id returning * into o;
      return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_lease_until > now() or coalesce(o.op_action, '') <> p_action then
      return jsonb_build_object('claimed', false, 'resumed', false,
        'reason', case when coalesce(o.op_action, '') <> p_action then 'other_action' else 'busy' end,
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claim_takeover', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  -- A pickup order waiting at the counter can still be cancelled (restock + refund), and so can a
  -- manual order that has not left the shop. A Shiprocket 'packed' order has a booked courier: no.
  -- coalesce: courier is null on Shiprocket orders, and a null here would let the claim through.
  if not (o.status = 'paid'
          or (p_action = 'cancel' and o.status = 'ready_for_pickup')
          or (p_action = 'cancel' and o.status in ('processed', 'packed')
              and coalesce(o.courier, '') in ('porter', 'self'))) then
    return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  update public.orders set status = v_target, op_key = p_op_key, op_action = p_action, op_actor = p_actor,
         op_lease_until = now() + interval '5 minutes', process_error = null, updated_at = now()
   where id = o.id returning * into o;
  perform public._online_event(o.id, 'claimed', v_from, v_target, p_actor,
    jsonb_build_object('action', p_action, 'op_key', p_op_key));
  return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
    'status', o.status, 'order', public._order_ops_json(o));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_order_manual_process(uuid, uuid, text)',
    'public.online_order_manual_advance(uuid, uuid, text)',
    'public.online_order_mark_delivered(uuid, uuid, timestamptz, text)',
    'public.online_order_claim(uuid, text, uuid, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
