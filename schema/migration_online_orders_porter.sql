-- Porter: manual local delivery (owner decision 2026-10-29; tasks/fulfilment-plan.md §5, PR D).
-- An admin-only fulfilment choice for a paid SHIP order: staff book the ride in the Porter app
-- (outside this system), optionally paste its tracking link and mark the order dispatched.
-- Flow: shelf check (online_order_set_availability, unchanged) → online_order_dispatch_manual
-- (refunds for missing units, Bill of Supply, shipped, email) → online_order_mark_delivered
-- (any admin for Porter orders; superadmin-only for Shiprocket is kept in admin-order-action).
-- Run after migration_online_orders_pickup.sql. Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- orders.courier text null, check in ('shiprocket', 'porter'). Set to 'porter' by
--   dispatch_manual. Not backfilled: null keeps meaning "the default Shiprocket flow" (every
--   order before this migration, and every Shiprocket order after it), so no existing function
--   has to start writing it. 'shiprocket' is allowed for an explicit value later.
-- orders.manual_tracking_url text null: https:// URL without spaces, at most 500 chars.
-- online_order_dispatch_manual(p_order_id uuid, p_actor uuid, p_tracking_url text) returns jsonb
--   {status, bill_id, refund_id, all_unavailable, changed, sr_order_id}. Ship order in 'paid'
--   with no op, no AWB, availability set for every item that took stock. Same shelf-check
--   outcome as prepare_process: units not available are refunded ('unavailable'; a rebooked
--   order's bill gets the offset); none available → 'cancelled'. Otherwise shipped_qty :=
--   available_qty, Bill of Supply, status 'shipped', courier 'porter', courier_name 'Porter',
--   manual_tracking_url, job email_shipped (ref 'porter'). The plan (with courier 'porter') is
--   stored in process_plan; a repeat returns the stored result with changed=false.
--   sr_order_id (first call only) is the Shiprocket order created at payment, which the caller
--   cancels best effort so nobody books it by mistake.
-- online_order_mark_delivered: unchanged except an empty reason is allowed for a Porter order
--   (recorded as 'Delivered by Porter').
-- online_order_claim: unchanged except a Porter order can only be claimed for 'cancel'
--   (process / send_back / rebook → {claimed:false, reason:'status'}).
-- _order_public_json: adds 'courier'; tracking_url is the manual link for a Porter order.
-- Admin-only is enforced in admin-order-action; execute granted to service_role only.
-- =====================================================================
set local lock_timeout = '3s';

alter table public.orders add column if not exists courier text;
alter table public.orders drop constraint if exists online_orders_courier_check;
alter table public.orders add constraint online_orders_courier_check check (courier in ('shiprocket', 'porter'));

alter table public.orders add column if not exists manual_tracking_url text;
alter table public.orders drop constraint if exists online_orders_manual_tracking_url_check;
-- The link is shown to the shopper (order page, email): https only, no spaces, bounded.
alter table public.orders add constraint online_orders_manual_tracking_url_check
  check (manual_tracking_url ~ '^https://[^[:space:]]+$' and length(manual_tracking_url) <= 500);

-- ---------- dispatch by hand (Porter) ----------

-- One transaction under the order row lock: the Porter booking happens outside this system,
-- so there is no courier call to fence and no op lease (same shape as online_order_mark_ready).
create or replace function public.online_order_dispatch_manual(p_order_id uuid, p_actor uuid, p_tracking_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_units jsonb := '[]'::jsonb;
  v_ship jsonb := '[]'::jsonb;
  v_avail int := 0;
  v_left int;
  v_refund uuid;
  v_all boolean;
  v_plan jsonb;
  v_bill int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  -- Retry after a lost response: only this function writes a plan with courier 'porter'.
  if o.process_plan ->> 'courier' = 'porter' and o.status <> 'paid' then
    return jsonb_build_object('status', o.status, 'bill_id', o.bill_id, 'refund_id', o.process_plan -> 'refund_id',
                              'all_unavailable', o.process_plan -> 'all_unavailable', 'changed', false,
                              'sr_order_id', null);
  end if;
  if o.fulfilment <> 'ship' then
    raise exception 'dispatch_manual: order % is not a ship order', o.order_ref;
  end if;
  if o.status <> 'paid' or o.op_action is not null or o.awb is not null then
    raise exception 'dispatch_manual: order must be paid with no action or courier booking in progress (status %, op %)',
      o.status, o.op_action;
  end if;
  if v_url is not null and (v_url !~ '^https://[^[:space:]]+$' or length(v_url) > 500) then
    raise exception 'tracking link must be an https:// link';
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
  v_plan := jsonb_build_object('courier', 'porter', 'shippable_items', v_ship, 'all_unavailable', v_all,
                               'refund_id', v_refund);

  if v_all then
    update public.orders set status = 'cancelled', process_plan = v_plan, updated_at = now() where id = o.id;
    perform public._online_event(o.id, 'cancelled', 'paid', 'cancelled', p_actor,
      jsonb_build_object('reason', 'no item available', 'refund_id', v_refund, 'courier', 'porter'));
    return jsonb_build_object('status', 'cancelled', 'bill_id', null, 'refund_id', v_refund, 'all_unavailable', true,
                              'changed', true, 'sr_order_id', o.sr_order_id);
  end if;

  -- As online_order_mark_packed: shipped_qty is what left the shop, which the bill and returns read.
  update public.order_items set shipped_qty = coalesce(available_qty, 0) where order_id = o.id;
  update public.order_items i set status = public._item_status(i) where i.order_id = o.id;
  update public.orders set process_plan = v_plan where id = o.id;
  v_bill := public.online_order_create_bos(o.id);
  -- Straight to shipped: no courier webhook will ever move a Porter order (it has no AWB).
  update public.orders set status = 'shipped', courier = 'porter', courier_name = 'Porter',
         manual_tracking_url = v_url, process_error = null, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'shipped', 'paid', 'shipped', p_actor,
    jsonb_build_object('courier', 'porter', 'tracking_url', v_url, 'bill_id', v_bill, 'refund_id', v_refund));
  -- Own ref: a rebooked order may already hold the '' email_shipped job of its first shipment.
  perform public._enqueue_job(o.id, 'email_shipped', 'porter');
  return jsonb_build_object('status', 'shipped', 'bill_id', v_bill, 'refund_id', v_refund, 'all_unavailable', false,
                            'changed', true, 'sr_order_id', o.sr_order_id);
end;
$$;

-- ---------- mark delivered: reason optional for Porter ----------

-- Superadmin-only for Shiprocket orders is still enforced in the Edge Function; any admin may
-- mark a Porter order delivered (no courier webhook will), so the reason may be left empty.
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

-- ---------- public order JSON (lookup, my orders) ----------
create or replace function public._order_public_json(o public.orders)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_ref', o.order_ref, 'status', o.status, 'fulfilment', o.fulfilment, 'courier', o.courier,
    'created_at', o.created_at, 'paid_at', o.paid_at,
    'subtotal', o.subtotal, 'promo_discount', o.promo_discount, 'shipping', o.shipping,
    'voucher_applied', o.voucher_applied, 'credit_applied', o.credit_applied,
    'gateway_amount', o.gateway_amount, 'courier_name', o.courier_name, 'awb', o.awb,
    'tracking_label', o.tracking_label,
    'tracking_url', case when o.awb is not null then 'https://shiprocket.co/tracking/' || o.awb
                         when o.courier = 'porter' then o.manual_tracking_url end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.product_name, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'status', i.status, 'refunded_qty', i.refunded_qty)
        order by i.line_no) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
$$;

-- ---------- claim: Porter orders ----------
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

  -- Store pickup never goes through Shiprocket, and a Porter order left with Porter (no
  -- Shiprocket shipment to send back or rebook): only cancel may claim either.
  if (o.fulfilment = 'pickup' or o.courier = 'porter') and p_action <> 'cancel' then
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

  -- A pickup order waiting at the counter can still be cancelled (restock + refund).
  if not (o.status = 'paid' or (p_action = 'cancel' and o.status = 'ready_for_pickup')) then
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
    'public.online_order_dispatch_manual(uuid, uuid, text)',
    'public.online_order_mark_delivered(uuid, uuid, timestamptz, text)',
    'public.online_order_claim(uuid, text, uuid, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
revoke all on function public._order_public_json(public.orders) from public, anon, authenticated;
