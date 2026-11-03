-- Tests for schema/migration_online_orders_packed_photos.sql. Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally: the migrations listed in schema/test_online_orders_customer_tracking.sql, then
-- schema/migration_online_orders_packed_photos.sql, then this file.
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


create function pg_temp.jobs(p_order uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.order_jobs where order_id = p_order
$$;


-- A paid ship order of one variant (₹99 shipping below ₹5,000); p_avail (when given) is set as the shelf check.
create function pg_temp.paid_ship(p_v uuid, p_qty int, p_avail int default null) returns uuid language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', p_v, 'qty', p_qty)));
  perform pg_temp.pay(r.order_ref);
  if p_avail is not null then
    perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), p_avail, null);
  end if;
  return r.order_id;
end $$;

create function pg_temp.packed() returns uuid language plpgsql as $$
declare
  o uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
begin
  update public.orders set status = 'packed' where id = o;
  return o;
end $$;

create function pg_temp.refused(p_sql text, p_message text) returns void language plpgsql as $$
begin
  execute p_sql;
  assert false, 'expected refusal: ' || p_sql;
exception when raise_exception then
  assert sqlerrm like '%' || p_message || '%', sqlerrm;
end $$;

-- Paths are built by the server, and only for a packed-or-later order.
begin;
do $$
declare
  o uuid := pg_temp.packed();
  p text := public.online_packed_photo_path(o, 'JPG');
begin
  assert p ~ ('\A' || o || '/packed/[0-9a-f-]{36}\.jpg\Z'), p;
  perform pg_temp.refused(format('select public.online_packed_photo_path(%L, %L)', o, 'heic'), 'unsupported photo type');
  update public.orders set status = 'paid' where id = o;
  perform pg_temp.refused(format('select public.online_packed_photo_path(%L, %L)', o, 'jpg'), 'cannot take packed photos');
end $$;
rollback;

-- Add checks the path shape, refuses a replay, and stops at 4.
begin;
do $$
declare
  o uuid := pg_temp.packed();
  other uuid := pg_temp.packed();
  i int;
begin
  perform pg_temp.refused(format('select public.online_packed_photo_add(%L, %L, null)', o,
    other || '/packed/' || gen_random_uuid() || '.jpg'), 'invalid photo path');
  perform pg_temp.refused(format('select public.online_packed_photo_add(%L, %L, null)', o,
    public.online_packed_photo_path(o, 'jpg') || E'\n'), 'invalid photo path');
  for i in 1..4 loop
    perform public.online_packed_photo_add(o, public.online_packed_photo_path(o, 'webp'), null);
  end loop;
  perform pg_temp.refused(format('select public.online_packed_photo_add(%L, %L, null)', o,
    public.online_packed_photo_path(o, 'jpg')), 'at most 4');
end $$;
rollback;

begin;
do $$
declare
  o uuid := pg_temp.packed();
  p text := public.online_packed_photo_path(o, 'jpg');
begin
  perform public.online_packed_photo_add(o, p, null);
  begin
    perform public.online_packed_photo_add(o, p, null);
    assert false, 'replayed path must fail';
  exception when unique_violation then
    null;
  end;
end $$;
rollback;

-- Customers see photos from packed to delivered only; remove hands back the path once.
begin;
do $$
declare
  o uuid := pg_temp.packed();
  p text := public.online_packed_photo_path(o, 'jpg');
  id uuid := public.online_packed_photo_add(o, p, null);
  s text;
begin
  foreach s in array array['packed', 'shipped', 'out_for_delivery', 'delivered'] loop
    update public.orders set status = s where public.orders.id = o;
    assert public.online_order_packed_photo_paths(o) = array[p], 'visible at ' || s;
  end loop;
  foreach s in array array['paid', 'cancelled', 'rto', 'rto_received'] loop
    update public.orders set status = s where public.orders.id = o;
    assert public.online_order_packed_photo_paths(o) = '{}', 'hidden at ' || s;
  end loop;
  assert public.online_packed_photo_remove(id) = p, 'remove returns path';
  assert public.online_packed_photo_remove(id) is null, 'second remove finds nothing';
end $$;
rollback;

-- Phone check matches the stored number in any form the lookup accepts, and nothing else.
begin;
do $$
declare
  o uuid := pg_temp.packed();
  ref text;
  phone text;
begin
  select order_ref, contact_phone into ref, phone from public.orders where id = o;
  assert public.online_order_phone_ok(lower(ref), right(phone, 10)), 'right phone, lower-case ref';
  assert not public.online_order_phone_ok(ref, '9000000000'), 'wrong phone';
  assert not public.online_order_phone_ok(ref, null), 'no phone';
  assert not public.online_order_phone_ok('WEB-999999', phone), 'unknown order';
end $$;
rollback;

-- Grants: browsers call none of these, and admins cannot read a storage path.
begin;
-- The admin policy reads profiles; the local harness has no such grant.
grant select on public.profiles to authenticated;
set local role anon;
do $$
begin
  begin
    perform public.online_order_phone_ok('WEB-000001', '9812345678');
    assert false, 'anon must not call';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.online_order_packed_photo_paths(gen_random_uuid());
    assert false, 'authenticated must not call';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform path from public.order_packed_photos;
    assert false, 'authenticated must not read path';
  exception when insufficient_privilege then
    null;
  end;
  perform id from public.order_packed_photos;
end $$;
reset role;
rollback;
