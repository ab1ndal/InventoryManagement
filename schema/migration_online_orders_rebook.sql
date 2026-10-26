-- Online orders: bill-offset helper for refunds made after a Bill of Supply exists.
-- Spec: docs/superpowers/specs/2026-10-26-online-order-unstick-rebook-design.md
-- ("Changes from the adversarial review" item 4).
-- Requires: schema/migration_online_orders.sql (and _r7/_refunds/_ship).
-- Idempotent: safe to apply twice. No BEGIN/COMMIT (exec_sql runs it in one txn).
--
-- ============================== CONTRACT ==============================
-- SECURITY DEFINER, search_path = public, execute granted to service_role only.
--
-- exchanges.order_refund_id uuid, exchanges.order_item_id uuid
--   Which online refund / order item an offset row belongs to. Unique per
--   (order_refund_id, order_item_id) for item rows; unique per order_refund_id for the
--   shipping row (order_item_id null), so the helper is idempotent under any race.
-- _online_bill_offset(p_refund uuid, p_reason text, p_include_shipping boolean) returns void
--   No-op when the order has no bill. Writes one exchanges row per order_refund_items row
--   (reason = p_reason, new_billid = the online bill so in-store billing never offers it as
--   unused credit), links order_refund_items.exchange_id, and when p_include_shipping and the
--   refund has shipping_gateway/shipping_credit legs, one row against the bill's Shipping
--   line worth their sum. Serialised per refund by a row lock; safe to call repeatedly.
-- online_order_rto_received(p_order_id uuid, p_actor uuid) returns uuid
--   Unchanged behaviour; offsets via _online_bill_offset(refund, 'RTO', false).
--
-- Operation fencing (adversarial review items 1-2): an expired lease doesn't prove the
-- worker stopped, so every write made on behalf of an operation checks its op key.
-- orders.op_action in ('process', 'cancel', 'send_back', 'rebook').
-- online_order_claim(p_order_id uuid, p_action text, p_actor uuid, p_op_key text) returns jsonb
--   process/cancel unchanged, except a same-key resume must also be the same action.
--   send_back: from 'processing' with op_action 'process' and an expired lease; status
--   stays 'processing', op_key replaced by a new key (fences out the old worker),
--   op_action 'send_back'. rebook: from packed/shipped/out_for_delivery, status unchanged,
--   op_action 'rebook'. For both: same key → resumed (lease renewed); other key while
--   the lease is live → {claimed:false, reason:'busy'}; expired lease → take over.
-- online_order_checkpoint(p_order_id uuid, p_step text, p_data jsonb, p_op_key text default null)
--   Steps sr_update/awb/pickup/manifest/label/sr_cancelled raise 'stale operation' unless
--   p_op_key is given and = orders.op_key. Steps error/sr_create/sr_create_failed do the
--   same when p_op_key is given (Process); keyless (job/webhook) calls are unchanged,
--   except a keyless sr_create/sr_create_failed during send_back/rebook is skipped.
--   sr_cancelled {awb?, sr_order_id?} (default: the order's): only while op_action is
--   send_back/rebook; sets orders.sr_cancelled_op_key = p_op_key (exposed by
--   _order_ops_json, so in claim results); event data {step, op_key, data:{at, awb,
--   sr_order_id}}; skipped when this op already recorded it.
-- online_order_mark_packed(p_order_id uuid, p_shipment jsonb, p_actor uuid, p_op_key text) returns int
--   Fenced like the Process checkpoints; a repeat on an already-packed order still
--   returns the bill id (retried Process whose first call succeeded).
-- online_order_apply_tracking(p_awb text, p_status text, p_payload jsonb) returns jsonb
--   While op_action = 'rebook': raw tracking fields stored, event 'tracking_held',
--   status untouched → {matched:true, changed:false, held:true, status}.
-- =====================================================================

alter table public.exchanges add column if not exists order_refund_id uuid;
alter table public.exchanges add column if not exists order_item_id uuid;

create unique index if not exists exchanges_refund_item_uidx
  on public.exchanges (order_refund_id, order_item_id) where order_item_id is not null;
create unique index if not exists exchanges_refund_shipping_uidx
  on public.exchanges (order_refund_id) where order_refund_id is not null and order_item_id is null;

create or replace function public._online_bill_offset(p_refund uuid, p_reason text, p_include_shipping boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  ri record;
  v_voucher text;
  v_ship numeric;
  v_ship_item integer;
  v_ex integer;
begin
  -- Row lock serialises concurrent callers for the same refund.
  perform 1 from public.order_refunds where id = p_refund for update;
  if not found then raise exception 'refund % not found', p_refund; end if;
  select o2.* into o from public.orders o2 join public.order_refunds r on r.order_id = o2.id where r.id = p_refund;
  if o.bill_id is null then return; end if;

  select l.voucher_id into v_voucher from public.order_refund_legs l
   where l.refund_id = p_refund and l.voucher_id is not null order by l.created_at limit 1;

  for ri in select x.item_id, x.units, x.credit_amount + x.gateway_amount as value, i.bill_item_id,
                   i.product_name, i.productid
              from public.order_refund_items x join public.order_items i on i.id = x.item_id
             where x.refund_id = p_refund loop
    v_ex := null;
    insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount,
                                  voucher_id, new_billid, product_name, product_code,
                                  order_refund_id, order_item_id)
    values (ri.bill_item_id, ri.units, p_reason, o.customerid, ri.value, v_voucher, o.bill_id,
            ri.product_name, ri.productid, p_refund, ri.item_id)
    on conflict do nothing
    returning exchangeid into v_ex;
    if v_ex is null then
      select e.exchangeid into v_ex from public.exchanges e
       where e.order_refund_id = p_refund and e.order_item_id = ri.item_id;
    end if;
    update public.order_refund_items set exchange_id = v_ex where refund_id = p_refund and item_id = ri.item_id;
  end loop;

  if p_include_shipping then
    select coalesce(sum(l.amount), 0) into v_ship from public.order_refund_legs l
     where l.refund_id = p_refund and l.source in ('shipping_gateway', 'shipping_credit');
    if v_ship > 0 then
      select bi.bill_item_id into v_ship_item from public.bill_items bi
       where bi.billid = o.bill_id and bi.product_name = 'Shipping' and bi.variantid is null
       order by bi.bill_item_id limit 1;
      if v_ship_item is not null then
        insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount,
                                      voucher_id, new_billid, product_name, product_code,
                                      order_refund_id, order_item_id)
        values (v_ship_item, 1, p_reason, o.customerid, v_ship, v_voucher, o.bill_id,
                'Shipping', null, p_refund, null)
        on conflict do nothing;
      end if;
    end if;
  end if;
end;
$$;

create or replace function public.online_order_rto_received(p_order_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_n int;
  v_refund uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status = 'rto_received' then
    return (select r.id from public.order_refunds r where r.order_id = o.id and r.reason = 'rto');
  end if;
  if o.status <> 'rto' then raise exception 'parcel received back is only for RTO orders (now %)', o.status; end if;

  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    v_n := least(it.shipped_qty - it.rto_qty, it.qty - it.refunded_qty);
    if v_n > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', v_n);
      perform public._stock_apply(it.variantid, v_n);
      update public.order_items set rto_qty = rto_qty + v_n where id = it.id;
    end if;
  end loop;

  v_refund := public._online_refund_create(o.id, 'rto', v_units, false, p_actor);

  if v_refund is not null then
    perform public._online_bill_offset(v_refund, 'RTO', false);
  end if;

  update public.orders set status = 'rto_received', updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'rto_received', 'rto', 'rto_received', p_actor,
    jsonb_build_object('refund_id', v_refund, 'units', v_units));
  return v_refund;
end;
$$;

-- ---------- operation fencing and admin-op claims ----------

-- Which op recorded checkpoint sr_cancelled (finalize checks it equals the op key).
alter table public.orders add column if not exists sr_cancelled_op_key text;

create or replace function public._order_ops_json(o public.orders)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('id', o.id, 'order_ref', o.order_ref, 'status', o.status,
    'quoted_courier_id', o.quoted_courier_id, 'sr_order_id', o.sr_order_id, 'sr_shipment_id', o.sr_shipment_id,
    'sr_updated_at', o.sr_updated_at, 'awb', o.awb, 'courier_id', o.courier_id, 'courier_name', o.courier_name,
    'pickup_requested_at', o.pickup_requested_at, 'manifest_url', o.manifest_url, 'label_url', o.label_url,
    'bill_id', o.bill_id, 'process_plan', o.process_plan, 'process_error', o.process_error,
    'sr_cancelled_op_key', o.sr_cancelled_op_key)
$$;
revoke all on function public._order_ops_json(public.orders) from public, anon, authenticated;

alter table public.orders drop constraint if exists online_orders_op_action_check;
alter table public.orders add constraint online_orders_op_action_check
  check (op_action is null or op_action in ('process', 'cancel', 'send_back', 'rebook'));

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

  if o.status <> 'paid' then
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

-- Signature change (adds p_op_key): drop the old overload so calls aren't ambiguous.
drop function if exists public.online_order_checkpoint(uuid, text, jsonb);

create or replace function public.online_order_checkpoint(
  p_order_id uuid, p_step text, p_data jsonb, p_op_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_skip boolean := false;
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_event jsonb;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;

  -- Operation steps always need the owning key; shared steps are fenced when a key is given
  -- (Process passes its key; the shiprocket_create job and webhooks pass none).
  if (p_step in ('sr_update', 'awb', 'pickup', 'manifest', 'label', 'sr_cancelled')
      and (p_op_key is null or o.op_key is distinct from p_op_key))
     or (p_step in ('error', 'sr_create', 'sr_create_failed')
      and p_op_key is not null and o.op_key is distinct from p_op_key) then
    raise exception 'checkpoint %: stale operation', p_step;
  end if;
  v_event := jsonb_build_object('step', p_step, 'data', d);

  if p_step = 'cf_order' then
    if o.status <> 'pending_payment' then raise exception 'checkpoint cf_order: order is %', o.status; end if;
    v_skip := o.cf_order_id is not null;
    if not v_skip then
      update public.orders set cf_order_id = d ->> 'cf_order_id', updated_at = now() where id = o.id;
    end if;
  elsif p_step in ('sr_create', 'sr_create_failed') then
    if o.status not in ('paid', 'processing', 'cancelling') then
      raise exception 'checkpoint %: order is %', p_step, o.status;
    end if;
    -- A keyless (job) create landing during send back / rebook must not write ids that the
    -- op is about to clear; skipping lets the job settle.
    v_skip := o.sr_order_id is not null or coalesce(o.op_action, '') in ('send_back', 'rebook');
    if not v_skip and p_step = 'sr_create' then
      update public.orders set sr_order_id = d ->> 'sr_order_id', sr_shipment_id = d ->> 'sr_shipment_id',
             sr_sync_status = 'ok', sr_last_error = null, updated_at = now() where id = o.id;
    elsif not v_skip then
      update public.orders set sr_sync_status = 'failed', sr_last_error = d ->> 'error', updated_at = now() where id = o.id;
    end if;
  elsif p_step = 'error' then
    if o.status not in ('paid', 'processing', 'cancelling') then
      raise exception 'checkpoint error: order is %', o.status;
    end if;
    update public.orders set process_error = d ->> 'error', op_lease_until = now(), updated_at = now() where id = o.id;
  elsif p_step = 'sr_cancelled' then
    if coalesce(o.op_action, '') not in ('send_back', 'rebook') then
      raise exception 'checkpoint sr_cancelled: no send back / rebook in progress (op %)', o.op_action;
    end if;
    -- Recorded once per op, so a retry with the same key never cancels twice.
    v_skip := o.sr_cancelled_op_key is not distinct from p_op_key;
    v_event := jsonb_build_object('step', p_step, 'op_key', p_op_key, 'data', jsonb_build_object(
      'at', now(), 'awb', coalesce(nullif(d ->> 'awb', ''), o.awb),
      'sr_order_id', coalesce(nullif(d ->> 'sr_order_id', ''), o.sr_order_id)));
    if not v_skip then
      update public.orders set sr_cancelled_op_key = p_op_key, updated_at = now() where id = o.id;
    end if;
  elsif p_step in ('sr_update', 'awb', 'pickup', 'manifest', 'label') then
    if o.status <> 'processing' then raise exception 'checkpoint %: order is %', p_step, o.status; end if;
    if p_step = 'sr_update' then
      v_skip := o.sr_updated_at is not null;
      if not v_skip then update public.orders set sr_updated_at = now() where id = o.id; end if;
    elsif p_step = 'awb' then
      v_skip := o.awb is not null;
      if not v_skip then
        if coalesce(d ->> 'awb', '') = '' then raise exception 'checkpoint awb: awb required'; end if;
        update public.orders set awb = d ->> 'awb', courier_id = nullif(d ->> 'courier_id', '')::int,
               courier_name = d ->> 'courier_name' where id = o.id;
      end if;
    elsif p_step = 'pickup' then
      v_skip := o.pickup_requested_at is not null;
      if not v_skip then update public.orders set pickup_requested_at = now() where id = o.id; end if;
    elsif p_step = 'manifest' then
      v_skip := o.manifest_url is not null;
      if not v_skip then
        if coalesce(d ->> 'manifest_url', '') = '' then raise exception 'checkpoint manifest: manifest_url required'; end if;
        update public.orders set manifest_url = d ->> 'manifest_url' where id = o.id;
      end if;
    else
      v_skip := o.label_url is not null;
      if not v_skip then
        if coalesce(d ->> 'label_url', '') = '' then raise exception 'checkpoint label: label_url required'; end if;
        update public.orders set label_url = d ->> 'label_url' where id = o.id;
      end if;
    end if;
    update public.orders set updated_at = now() where id = o.id;
  else
    raise exception 'online_order_checkpoint: unknown step %', p_step;
  end if;

  if not v_skip then
    perform public._online_event(o.id, 'checkpoint', o.status, o.status, null, v_event);
  end if;
  return jsonb_build_object('step', p_step, 'skipped', v_skip);
end;
$$;

-- Signature change (adds p_op_key).
drop function if exists public.online_order_mark_packed(uuid, jsonb, uuid);

create or replace function public.online_order_mark_packed(
  p_order_id uuid, p_shipment jsonb, p_actor uuid, p_op_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  d jsonb := coalesce(p_shipment, '{}'::jsonb);
  v_bill int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status in ('packed', 'shipped', 'out_for_delivery', 'delivered') and o.bill_id is not null then
    return o.bill_id;
  end if;
  if p_op_key is null or o.op_key is distinct from p_op_key then
    raise exception 'mark_packed: stale operation';
  end if;
  if o.status <> 'processing' or coalesce(o.op_action, '') <> 'process' then
    raise exception 'mark_packed: order must be claimed for processing (now %)', o.status;
  end if;
  if o.process_plan is null or coalesce((o.process_plan ->> 'all_unavailable')::boolean, false) then
    raise exception 'mark_packed: run prepare_process first';
  end if;
  update public.orders set
    awb = coalesce(awb, nullif(d ->> 'awb', '')),
    courier_id = coalesce(courier_id, nullif(d ->> 'courier_id', '')::int),
    courier_name = coalesce(courier_name, nullif(d ->> 'courier_name', '')),
    label_url = coalesce(label_url, nullif(d ->> 'label_url', '')),
    manifest_url = coalesce(manifest_url, nullif(d ->> 'manifest_url', '')),
    sr_shipment_id = coalesce(sr_shipment_id, nullif(d ->> 'sr_shipment_id', ''))
   where id = o.id returning * into o;
  if o.awb is null or o.label_url is null then
    raise exception 'mark_packed: awb and label_url are required';
  end if;

  update public.order_items set shipped_qty = coalesce(available_qty, 0) where order_id = o.id;
  update public.order_items i set status = public._item_status(i) where i.order_id = o.id;
  v_bill := public.online_order_create_bos(o.id);
  update public.orders set status = 'packed', op_key = null, op_action = null, op_actor = null,
         op_lease_until = null, process_error = null, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'packed', 'processing', 'packed', p_actor,
    jsonb_build_object('awb', o.awb, 'bill_id', v_bill));
  return v_bill;
end;
$$;

create or replace function public.online_order_apply_tracking(p_awb text, p_status text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  d jsonb := coalesce(p_payload, '{}'::jsonb);
  v_rank_old int;
  v_rank_new int;
  v_label text := coalesce(d ->> 'shipment_status', d ->> 'current_status', d ->> 'status');
  v_sid int := case when (d ->> 'shipment_status_id') ~ '^\d+$' then (d ->> 'shipment_status_id')::int end;
  v_from text;
begin
  select * into o from public.orders where awb = p_awb for update;
  if not found then
    return jsonb_build_object('matched', false, 'changed', false);
  end if;
  v_from := o.status;
  -- R15: raw courier status kept on every update
  update public.orders set tracking_status_id = coalesce(v_sid, tracking_status_id),
         tracking_label = coalesce(v_label, tracking_label), tracking_updated_at = now(), updated_at = now()
   where id = o.id;

  -- Rebook in progress: the old shipment is being cancelled, so its updates must not move the order.
  if o.op_action = 'rebook' then
    perform public._online_event(o.id, 'tracking_held', o.status, o.status, null,
      jsonb_build_object('mapped_status', p_status, 'payload', d));
    return jsonb_build_object('matched', true, 'changed', false, 'held', true, 'status', o.status);
  end if;

  if p_status = 'problem' then
    update public.orders set problem = 'Courier: ' || coalesce(v_label, 'status ' || v_sid::text, 'exception')
     where id = o.id;
    perform public._online_event(o.id, 'courier_problem', o.status, o.status, null, d);
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;
  if p_status = 'cancelled' then
    if o.status in ('packed', 'shipped', 'out_for_delivery') then
      update public.orders set problem = 'Courier cancelled shipment — rebook or cancel' where id = o.id;
      perform public._online_event(o.id, 'courier_cancelled', o.status, o.status, null, d);
    end if;
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;

  v_rank_old := case o.status when 'packed' then 1 when 'shipped' then 2 when 'out_for_delivery' then 3
                              when 'delivered' then 4 when 'rto' then 5 when 'rto_received' then 6 else 0 end;
  v_rank_new := case p_status when 'shipped' then 2 when 'out_for_delivery' then 3 when 'delivered' then 4
                              when 'rto' then 5 else null end;
  if v_rank_new is null or v_rank_old = 0 or v_rank_old >= 4 or v_rank_new <= v_rank_old
     or (p_status = 'rto' and v_rank_old < 2) then
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;

  update public.orders set status = p_status, updated_at = now() where id = o.id;
  perform public._online_event(o.id, p_status, v_from, p_status, null, d);
  if p_status in ('shipped', 'out_for_delivery', 'delivered') and v_rank_old < 2 then
    perform public._enqueue_job(o.id, 'email_shipped');
  end if;
  if p_status = 'delivered' then
    perform public._enqueue_job(o.id, 'email_delivered');
  end if;
  return jsonb_build_object('matched', true, 'changed', true, 'status', p_status);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._online_bill_offset(uuid, text, boolean)',
    'public.online_order_rto_received(uuid, uuid)',
    'public.online_order_claim(uuid, text, uuid, text)',
    'public.online_order_checkpoint(uuid, text, jsonb, text)',
    'public.online_order_mark_packed(uuid, jsonb, uuid, text)',
    'public.online_order_apply_tracking(text, text, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
