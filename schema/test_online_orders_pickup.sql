-- Tests for schema/migration_online_orders_pickup.sql (store pickup: create, confirm, claim, ready,
-- collected, cancel). Each test is `begin; do $$ ... assert ... $$; rollback;`.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_any_state.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/migration_online_orders_pickup.sql schema/test_online_orders_pickup.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- fixture helpers (pg_temp: vanish with the session) ----------
create function pg_temp.go_live() returns void language sql as $$
  update public.storefront_settings set checkout_live = true where id = 1;
$$;

create function pg_temp.mk_variant(p_price numeric, p_stock numeric, p_cat text default 'Kurti')
returns uuid language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  pid text := 'T' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  insert into public.categories (categoryid, name) values (left(p_cat, 10), p_cat) on conflict do nothing;
  insert into public.products (productid, name, categoryid, purchaseprice, retailprice)
  values (pid, 'Test ' || p_cat, left(p_cat, 10), p_price / 2, p_price);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values (pid, 'M', 'Red', p_stock, v);
  return v;
end $$;

-- Builds a quote the way the edge function would (greedy shares, which satisfy the
-- same invariants) and calls online_order_create.
-- p_lines: [{v: variant uuid, qty}]; p_opt: {phone, promo_code, voucher_code, credit, shipping,
-- attempt_key, token_hash, fulfilment, address}. Pickup defaults to ₹0 shipping and a contact-only address.
create function pg_temp.mk_order(p_lines jsonb, p_opt jsonb default '{}'::jsonb)
returns table (order_id uuid, order_ref text, created boolean) language plpgsql as $$
declare
  l record;
  d public.discounts;
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0; v_promo numeric := 0; v_ship numeric; v_due numeric; v_goods numeric;
  v_vouch numeric := 0; v_credit numeric := coalesce((p_opt ->> 'credit')::numeric, 0);
  v_rem_p numeric; v_rem_c numeric; v_p numeric; v_c numeric; v_val numeric;
begin
  for l in select (e ->> 'v')::uuid as v, (e ->> 'qty')::int as q, p.retailprice as price
             from jsonb_array_elements(p_lines) e
             join public.productsizecolors psc on psc.variantid = (e ->> 'v')::uuid
             join public.products p on p.productid = psc.productid loop
    v_sub := v_sub + l.price * l.q;
  end loop;
  if p_opt ? 'promo_code' then
    select * into d from public.discounts where code = p_opt ->> 'promo_code';
    v_promo := public._promo_value(d, v_sub);
  end if;
  v_goods := v_sub - v_promo;
  v_ship := coalesce((p_opt ->> 'shipping')::numeric,
                     case when v_goods >= 5000 or p_opt ->> 'fulfilment' = 'pickup' then 0 else 99 end);
  v_due := v_goods + v_ship;
  if p_opt ? 'voucher_code' then
    select least(value, v_due) into v_vouch from public.vouchers where voucher_id = p_opt ->> 'voucher_code';
  end if;
  if p_opt ? 'voucher_applied' then v_vouch := (p_opt ->> 'voucher_applied')::numeric; end if;
  v_rem_p := v_promo;
  v_rem_c := least(v_vouch + v_credit, v_goods);
  for l in select (e ->> 'v')::uuid as v, (e ->> 'qty')::int as q, p.retailprice as price
             from jsonb_array_elements(p_lines) e
             join public.productsizecolors psc on psc.variantid = (e ->> 'v')::uuid
             join public.products p on p.productid = psc.productid loop
    v_val := l.price * l.q;
    v_p := least(v_rem_p, v_val); v_rem_p := v_rem_p - v_p;
    v_c := least(v_rem_c, v_val - v_p); v_rem_c := v_rem_c - v_c;
    v_items := v_items || jsonb_build_object('variant_id', l.v, 'qty', l.q, 'unit_price', l.price,
                                             'promo_share', v_p, 'credit_part', v_c);
  end loop;
  return query select * from public.online_order_create(
    jsonb_build_object(
      'attempt_key', p_opt ->> 'attempt_key',
      'contact', jsonb_build_object('name', 'Test Shopper', 'phone', coalesce(p_opt ->> 'phone', '+919800000001'),
                                    'email', 'shopper@example.com'),
      'address', coalesce(p_opt -> 'address', case when p_opt ->> 'fulfilment' = 'pickup'
        then jsonb_build_object('name', 'Test Shopper', 'phone', '+919800000001')
        else jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001') end),
      'fulfilment', p_opt ->> 'fulfilment',
      'promo_code', p_opt ->> 'promo_code', 'voucher_code', p_opt ->> 'voucher_code',
      'subtotal', v_sub, 'promo_discount', v_promo, 'shipping', v_ship, 'voucher_applied', v_vouch,
      'credit_applied', v_credit, 'gateway_amount', v_due - v_vouch - v_credit,
      'access_token_hash', p_opt ->> 'token_hash'),
    v_items, (p_opt ->> 'auth_user')::uuid);
end $$;

create function pg_temp.gw(p_ref text) returns numeric language sql as $$
  select gateway_amount from public.orders where order_ref = p_ref
$$;

create function pg_temp.pay(p_ref text) returns jsonb language sql as $$
  select public.online_order_confirm_payment(p_ref, 'cfpay_' || p_ref, pg_temp.gw(p_ref), 'INR')
$$;

create function pg_temp.stock(p_v uuid) returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = p_v
$$;


-- A paid pickup order of one variant; p_avail (when given) is set as the shelf check.
create function pg_temp.paid_pickup(p_v uuid, p_qty int, p_avail int default null) returns uuid language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', p_v, 'qty', p_qty)),
                                         '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  if p_avail is not null then
    perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), p_avail, null);
  end if;
  return r.order_id;
end $$;

create function pg_temp.jobs(p_order uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.order_jobs where order_id = p_order
$$;

-- ===================================================================
-- create
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  o public.orders;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  select * into o from public.orders where id = r.order_id;
  assert o.fulfilment = 'pickup', 'fulfilment stored';
  assert o.shipping = 0 and o.gateway_amount = 1000, 'free shipping below 5000 for pickup';
  assert o.address = '{"name": "Test Shopper", "phone": "+919800000001"}'::jsonb, 'contact-only address accepted';
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  assert (select fulfilment from public.orders where id = r.order_id) = 'ship', 'default is ship';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  l jsonb := jsonb_build_array(jsonb_build_object('v', v, 'qty', 1));
begin
  perform pg_temp.go_live();
  begin
    perform pg_temp.mk_order(l, '{"fulfilment":"pickup","shipping":99}');
    assert false, 'pickup with shipping should fail';
  exception when raise_exception then
    assert sqlerrm like 'shipping must be free for store pickup%', sqlerrm;
  end;
  begin
    perform pg_temp.mk_order(l, '{"shipping":0}');
    assert false, 'ship below 5000 with free shipping should fail';
  exception when raise_exception then
    assert sqlerrm like 'bad shipping amount%', sqlerrm;
  end;
  begin
    perform pg_temp.mk_order(l, '{"address":{"name":"X","phone":"+919800000001"}}');
    assert false, 'ship without pincode should fail';
  exception when raise_exception then
    assert sqlerrm like 'invalid pincode%', sqlerrm;
  end;
  begin
    perform pg_temp.mk_order(l, '{"fulfilment":"drone"}');
    assert false, 'unknown fulfilment should fail';
  exception when raise_exception then
    assert sqlerrm like 'bad fulfilment%', sqlerrm;
  end;
end $$;
rollback;

-- ===================================================================
-- confirm payment: no Shiprocket job for pickup
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 1);
  r record;
begin
  assert (select status from public.orders where id = p) = 'paid', 'pickup paid';
  assert pg_temp.jobs(p) = array['email_confirmed', 'email_shop'], 'pickup jobs: ' || pg_temp.jobs(p)::text;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  assert 'shiprocket_create' = any (pg_temp.jobs(r.order_id)), 'ship order still books Shiprocket';
  assert (public._order_public_json((select o from public.orders o where id = p))) ->> 'fulfilment' = 'pickup',
    'public json exposes fulfilment';
end $$;
rollback;

-- ===================================================================
-- claim: only cancel for pickup
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_pickup(pg_temp.mk_variant(1000, 5), 1, 1);
  c jsonb;
  a text;
begin
  foreach a in array array['process', 'send_back', 'rebook'] loop
    c := public.online_order_claim(p, a, null, 'k-' || a);
    assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', a || ' refused: ' || c::text;
  end loop;
  assert (select status from public.orders where id = p) = 'paid' and (select op_action from public.orders where id = p) is null,
    'order untouched';
end $$;
rollback;

-- ===================================================================
-- mark ready
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 2);
  r record;
begin
  begin
    perform public.online_order_mark_ready(p, null);
    assert false, 'needs the shelf check';
  exception when raise_exception then
    assert sqlerrm = 'availability not set for every item', sqlerrm;
  end;
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  begin
    perform public.online_order_mark_ready(r.order_id, null);
    assert false, 'ship order refused';
  exception when raise_exception then
    assert sqlerrm like 'mark_ready: order % is not a store pickup', sqlerrm;
  end;
  begin
    perform public.online_order_mark_collected(p, null);
    assert false, 'collected needs ready_for_pickup';
  exception when raise_exception then
    assert sqlerrm like 'mark_collected: order must be ready for pickup%', sqlerrm;
  end;
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 2, 2);
  j jsonb;
  j2 jsonb;
  o public.orders;
begin
  j := public.online_order_mark_ready(p, null);
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'ready_for_pickup' and o.status = 'ready_for_pickup', 'ready: ' || j::text;
  assert o.bill_id is not null and (j ->> 'bill_id')::int = o.bill_id, 'bill created';
  assert j -> 'refund_id' = 'null'::jsonb, 'nothing refunded';
  assert (select shipped_qty from public.order_items where order_id = p) = 2, 'shipped_qty = handed over units';
  assert (select count(*) from public.bill_items where billid = o.bill_id) = 1, 'one goods line, no Shipping line';
  assert (select quantity from public.bill_items where billid = o.bill_id) = 2, 'bill qty';
  assert (select final_amount from public.bills where billid = o.bill_id) = 2000, 'bill total';
  assert 'email_ready_for_pickup' = any (pg_temp.jobs(p)), 'ready email queued';
  assert pg_temp.stock(v) = 3, 'stock stays taken';
  j2 := public.online_order_mark_ready(p, null);
  assert j2 = j, 'repeat returns the same result: ' || j2::text;
  assert (select count(*) from public.bills where notes = 'Online order ' || o.order_ref) = 1, 'one bill';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 2, 1);
  j jsonb;
  o public.orders;
begin
  j := public.online_order_mark_ready(p, null);
  select * into o from public.orders where id = p;
  assert o.status = 'ready_for_pickup', 'partial is still ready';
  assert (select reason = 'unavailable' and units = 1 and total_amount = 1000
            from public.order_refunds where id = (j ->> 'refund_id')::uuid), 'one unit refunded';
  assert (select quantity from public.bill_items where billid = o.bill_id) = 1, 'bill lists the available unit';
  assert (select final_amount from public.bills where billid = o.bill_id) = 1000, 'bill net of the refund';
  assert pg_temp.stock(v) = 3, 'the missing unit is not restocked (it was never on the shelf)';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 2, 0);
  j jsonb;
  o public.orders;
begin
  j := public.online_order_mark_ready(p, null);
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'cancelled' and o.status = 'cancelled' and (j ->> 'all_unavailable')::boolean, j::text;
  assert o.bill_id is null, 'no bill';
  assert (select total_amount from public.order_refunds where id = (j ->> 'refund_id')::uuid) = 2000, 'all refunded';
  assert not ('email_ready_for_pickup' = any (pg_temp.jobs(p))), 'no ready email';
  assert public.online_order_mark_ready(p, null) = j, 'repeat returns the stored result';
end $$;
rollback;

-- ===================================================================
-- collected → delivered; returns open as for a delivered parcel
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_pickup(pg_temp.mk_variant(1000, 5), 2, 2);
  it uuid;
  j jsonb;
  o public.orders;
begin
  perform public.online_order_mark_ready(p, null);
  j := public.online_order_mark_collected(p, null);
  select * into o from public.orders where id = p;
  assert o.status = 'delivered' and o.delivered_at is not null, 'collected = delivered';
  assert (j ->> 'delivered_at')::timestamptz = o.delivered_at, 'returns delivered_at';
  assert 'email_delivered' = any (pg_temp.jobs(p)), 'delivered email queued';
  assert (select data ->> 'collected' from public.order_events where order_id = p and kind = 'delivered') = 'true', 'event';
  assert public.online_order_mark_collected(p, null) = j, 'repeat is a no-op';
  select id into it from public.order_items where order_id = p;
  assert (select units from public.online_return_returnable(p) where item_id = it) = 2, 'both units returnable';
  perform public.online_return_open(p, null, false, 'change_of_mind', now(),
    jsonb_build_array(jsonb_build_object('item_id', it, 'units', 1)), 'customer called', null, null);
end $$;
rollback;

-- ===================================================================
-- cancel: from paid and from ready_for_pickup
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 2);
  c jsonb;
  rf uuid;
begin
  c := public.online_order_claim(p, 'cancel', null, 'k-cancel');
  assert (c ->> 'claimed')::boolean, 'cancel claim on a paid pickup order';
  rf := public.online_order_cancel(p, null, 'customer changed mind');
  assert (select status from public.orders where id = p) = 'cancelled', 'cancelled';
  assert (select total_amount from public.order_refunds where id = rf) = 2000, 'full refund';
  assert pg_temp.stock(v) = 5, 'restocked';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_pickup(v, 3, 2);
  c jsonb;
  rf uuid;
  b int;
begin
  perform public.online_order_mark_ready(p, null);
  b := (select bill_id from public.orders where id = p);
  begin
    perform public.online_order_cancel(p, null, 'no claim');
    assert false, 'cancel needs the claim';
  exception when raise_exception then
    assert sqlerrm like 'cancel is only allowed for paid orders%', sqlerrm;
  end;
  c := public.online_order_claim(p, 'cancel', null, 'k-cancel');
  assert (c ->> 'claimed')::boolean and c ->> 'status' = 'cancelling', 'claim from ready_for_pickup: ' || c::text;
  rf := public.online_order_cancel(p, null, 'not collected');
  assert (select status from public.orders where id = p) = 'cancelled', 'cancelled';
  assert (select units = 2 and total_amount = 2000 and reason = 'cancel' from public.order_refunds where id = rf),
    'refunds the 2 units still owed';
  assert pg_temp.stock(v) = 4, 'the 2 held units go back on the shelf (the missing one never was): ' || pg_temp.stock(v);
  assert (select count(*) from public.exchanges where order_refund_id = rf and reason = 'Pickup cancelled'
            and new_billid = b and credit_amount = 2000) = 1, 'bill offset with the pickup reason';
  begin
    perform public.online_order_mark_collected(p, null);
    assert false, 'cancelled order cannot be collected';
  exception when raise_exception then
    assert sqlerrm like 'mark_collected: order must be ready for pickup%', sqlerrm;
  end;
end $$;
rollback;

-- ===================================================================
-- grants
-- ===================================================================
begin;
do $$
declare
  f text;
begin
  foreach f in array array['public.online_order_mark_ready(uuid, uuid)', 'public.online_order_mark_collected(uuid, uuid)',
                           'public.online_order_create(jsonb, jsonb, uuid)', 'public.online_order_claim(uuid, text, uuid, text)'] loop
    assert has_function_privilege('service_role', f, 'execute'), f || ': service_role';
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      f || ': anon/authenticated must not execute';
  end loop;
  assert (select count(*) from pg_proc where proname = 'online_order_create') = 1, 'no overload';
end $$;
rollback;
