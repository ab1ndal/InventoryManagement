-- Manual tracking number (owner request 2026-11-05). The shop delivers most orders itself (self
-- delivery, Porter) and often hands the parcel to India Post, DTDC and the like. Staff may type the
-- carrier and its tracking number at Process, at Picked up or any time later; the customer sees
-- them on /track and the order page, and in the shipped email when it is sent after they are set.
-- Optional: nothing waits on it, and the stages staff set by hand are unchanged.
-- Deploy order: this migration, then the edge functions (they select the new column), then the
-- frontend. Only adds a column, a function and a JSON field, so the old functions and frontend keep
-- working against it.
-- Run after migration_online_orders_customer_tracking.sql. Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- orders.manual_tracking_number text null: 1-40 chars, starts with a letter or digit, then letters,
--   digits, spaces, '/' and '-'. Shown to the shopper. Not orders.awb: an AWB means a Shiprocket
--   booking (tracking sweeper, cancel, rebook and the Shiprocket link all key on it).
-- online_order_set_manual_tracking(p_order_id uuid, p_actor uuid, p_carrier text, p_tracking_number text)
--   returns jsonb {changed, courier_name, tracking_number}. Manual ship order (courier porter or
--   self) in processed, packed, shipped, out_for_delivery or delivered, with no op. Both values are
--   trimmed; empty means none. carrier (1-40 chars: letters, digits, spaces and . & ' ( ) / -)
--   becomes orders.courier_name; none restores the default name ('Porter' | 'Bindal''s Creation').
--   tracking number none clears it. Same values as stored → changed=false, no writes. Otherwise one
--   event 'tracking_set' {carrier, tracking_number} (status unchanged).
-- _order_public_json: adds 'tracking_number' (online_order_lookup, my_online_orders). Existing
--   fields unchanged.
-- Admin-only is enforced in admin-order-action; execute granted to service_role only.
-- =====================================================================
set local lock_timeout = '3s';

alter table public.orders add column if not exists manual_tracking_number text;
alter table public.orders drop constraint if exists online_orders_manual_tracking_number_check;
alter table public.orders add constraint online_orders_manual_tracking_number_check
  check (manual_tracking_number ~ '^[A-Za-z0-9][A-Za-z0-9 /-]*$' and length(manual_tracking_number) <= 40);

create or replace function public.online_order_set_manual_tracking(
  p_order_id uuid, p_actor uuid, p_carrier text, p_tracking_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_number text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_name text;
begin
  if v_carrier is not null and (v_carrier !~ '^[A-Za-z0-9][A-Za-z0-9 .&''()/-]*$' or length(v_carrier) > 40) then
    raise exception 'carrier must be up to 40 letters, digits, spaces or . & '' ( ) / -';
  end if;
  if v_number is not null and (v_number !~ '^[A-Za-z0-9][A-Za-z0-9 /-]*$' or length(v_number) > 40) then
    raise exception 'tracking number must be up to 40 letters, digits, spaces, / or -';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if coalesce(o.courier, '') not in ('porter', 'self') or o.fulfilment <> 'ship' then
    raise exception 'set_manual_tracking: order % is not a manual delivery', o.order_ref;
  end if;
  if o.status not in ('processed', 'packed', 'shipped', 'out_for_delivery', 'delivered') then
    raise exception 'set_manual_tracking: order % cannot take a tracking number in status %', o.order_ref, o.status;
  end if;
  if o.op_action is not null then
    raise exception 'set_manual_tracking: order % has an operation in progress (%)', o.order_ref, o.op_action;
  end if;

  v_name := coalesce(v_carrier, case o.courier when 'porter' then 'Porter' else 'Bindal''s Creation' end);
  if o.courier_name is not distinct from v_name and o.manual_tracking_number is not distinct from v_number then
    return jsonb_build_object('changed', false, 'courier_name', o.courier_name, 'tracking_number', o.manual_tracking_number);
  end if;
  update public.orders set courier_name = v_name, manual_tracking_number = v_number, updated_at = now()
   where id = o.id;
  perform public._online_event(o.id, 'tracking_set', o.status, o.status, p_actor,
    jsonb_build_object('carrier', v_name, 'tracking_number', v_number));
  return jsonb_build_object('changed', true, 'courier_name', v_name, 'tracking_number', v_number);
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
    'tracking_number', o.manual_tracking_number,
    'tracking_label', o.tracking_label,
    'tracking_url', case when o.awb is not null then 'https://shiprocket.co/tracking/' || o.awb
                         when o.courier = 'porter' then o.manual_tracking_url end,
    'status_times', x.tracking -> 'status_times',
    'delivery_city', x.tracking ->> 'delivery_city',
    'delivery_pincode', x.tracking ->> 'delivery_pincode',
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.product_name, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'status', i.status, 'refunded_qty', i.refunded_qty,
        'image_url', x.tracking -> 'item_images' ->> i.line_no::text)
        order by i.line_no) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
    from (select public._order_tracking_json(o.id) as tracking) x
$$;

revoke all on function public.online_order_set_manual_tracking(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.online_order_set_manual_tracking(uuid, uuid, text, text) to service_role;
revoke all on function public._order_public_json(public.orders) from public, anon, authenticated;
