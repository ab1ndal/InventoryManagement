-- Tests for schema/migration_online_orders_customer_tracking.sql (step times, delivery city and
-- pincode, item photos, grants). Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_any_state.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/migration_online_orders_pickup.sql schema/migration_online_orders_porter.sql \
--     schema/migration_online_orders_holds.sql schema/migration_online_orders_hold_cap.sql \
--     schema/migration_online_orders_manual_stages.sql \
--     schema/migration_online_orders_customer_tracking.sql schema/test_online_orders_customer_tracking.sql
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

-- A paid ship order, shelf checked and processed by hand.
create function pg_temp.processed(p_v uuid, p_qty int, p_avail int, p_courier text default 'porter')
returns uuid language plpgsql as $$
declare
  p uuid := pg_temp.paid_ship(p_v, p_qty, p_avail);
begin
  perform public.online_order_manual_process(p, null, p_courier);
  return p;
end $$;

create function pg_temp.bills(p_order uuid) returns bigint language sql as $$
  select count(*) from public.bills b join public.orders o on b.notes = 'Online order ' || o.order_ref where o.id = p_order
$$;

create function pg_temp.shipped_jobs(p_order uuid) returns bigint language sql as $$
  select count(*) from public.order_jobs where order_id = p_order and kind = 'email_shipped'
$$;

create function pg_temp.events(p_order uuid, p_kind text) returns bigint language sql as $$
  select count(*) from public.order_events where order_id = p_order and kind = p_kind
$$;

create function pg_temp.status(p_order uuid) returns text language sql as $$
  select status from public.orders where id = p_order
$$;

create function pg_temp.refunded(p_order uuid) returns numeric language sql as $$
  select coalesce(sum(total_amount), 0) from public.order_refunds where order_id = p_order
$$;

create function pg_temp.shipping_legs(p_order uuid) returns bigint language sql as $$
  select count(*) from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
   where r.order_id = p_order and l.source in ('shipping_credit', 'shipping_gateway')
$$;

create function pg_temp.cancel(p_order uuid) returns uuid language plpgsql as $$
declare
  c jsonb := public.online_order_claim(p_order, 'cancel', null, 'k-cancel');
begin
  assert (c ->> 'claimed')::boolean, 'cancel claim refused: ' || c::text;
  assert c ->> 'status' = 'cancelling', 'claim moves it to cancelling';
  return public.online_order_cancel(p_order, null, 'customer asked');
end $$;

-- A Shiprocket order packed and billed, sent back to paid by a rebook (bill kept, attempt 2).
create function pg_temp.rebooked(p_v uuid, p_qty int) returns uuid language plpgsql as $$
declare
  p uuid := pg_temp.paid_ship(p_v, p_qty, p_qty);
begin
  perform public.online_order_claim(p, 'process', null, 'op-pack');
  perform public.online_order_prepare_process(p, null);
  perform public.online_order_checkpoint(p, 'awb', jsonb_build_object('awb', 'AWB' || left(p::text, 8), 'courier_id', 7, 'courier_name', 'Test Courier'), 'op-pack');
  perform public.online_order_checkpoint(p, 'label', '{"label_url":"https://x/label.pdf"}', 'op-pack');
  perform public.online_order_mark_packed(p, '{}'::jsonb, null, 'op-pack');
  perform public.online_order_apply_tracking((select awb from public.orders where id = p), 'shipped',
    '{"shipment_status_id":6,"shipment_status":"SHIPPED"}');
  perform public.online_order_claim(p, 'rebook', null, 'op-rb');
  perform public.online_order_checkpoint(p, 'sr_cancelled', '{}', 'op-rb');
  perform public.online_order_rebook(p, null, 'op-rb', false, 'box back from courier');
  return p;
end $$;

-- Status times, read back from the order's public JSON.
create function pg_temp.times(p_order uuid) returns jsonb language sql as $$
  select public._order_public_json(o) -> 'status_times' from public.orders o where o.id = p_order
$$;

-- Moves one event to a known instant; everything in a test transaction shares one now().
create function pg_temp.at(p_order uuid, p_kind text, p_at timestamptz) returns void language sql as $$
  update public.order_events set created_at = p_at where order_id = p_order and kind = p_kind
$$;

create function pg_temp.product_of(p_order uuid) returns text language sql as $$
  select productid from public.order_items where order_id = p_order order by line_no limit 1
$$;

create function pg_temp.photo(p_order uuid) returns text language sql as $$
  select public._order_public_json(o) -> 'items' -> 0 ->> 'image_url' from public.orders o where o.id = p_order
$$;

-- ===================================================================
-- step times
-- ===================================================================

-- The paid event is written by the real confirm path, so no paid_at fallback is needed.
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  t jsonb := pg_temp.times(p);
begin
  assert pg_temp.events(p, 'paid') = 1, 'confirm writes one paid event';
  assert (t ->> 'paid')::timestamptz = (select paid_at from public.orders where id = p), 'paid: ' || t::text;
  assert (select array_agg(k) from jsonb_object_keys(t) k) = array['paid'], 'only paid so far: ' || t::text;
end $$;
rollback;

-- Manual ladder: each stage keeps its own time, and pending_payment is never reported.
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
  t jsonb;
begin
  perform public.online_order_manual_advance(p, null, 'packed');
  perform public.online_order_manual_advance(p, null, 'shipped');
  perform public.online_order_manual_advance(p, null, 'out_for_delivery');
  perform pg_temp.at(p, 'paid', '2026-11-01 01:00+00');
  perform pg_temp.at(p, 'processed', '2026-11-01 02:00+00');
  perform pg_temp.at(p, 'packed', '2026-11-01 03:00+00');
  perform pg_temp.at(p, 'shipped', '2026-11-01 04:00+00');
  perform pg_temp.at(p, 'out_for_delivery', '2026-11-01 05:00+00');
  t := pg_temp.times(p);
  assert (t ->> 'paid')::timestamptz = '2026-11-01 01:00+00', t::text;
  assert (t ->> 'processed')::timestamptz = '2026-11-01 02:00+00', t::text;
  assert (t ->> 'packed')::timestamptz = '2026-11-01 03:00+00', t::text;
  assert (t ->> 'shipped')::timestamptz = '2026-11-01 04:00+00', t::text;
  assert (t ->> 'out_for_delivery')::timestamptz = '2026-11-01 05:00+00', t::text;
  assert not t ? 'pending_payment' and not t ? 'delivered', t::text;
end $$;
rollback;

-- A step the manual order jumped over has no time.
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
  t jsonb;
begin
  perform public.online_order_manual_advance(p, null, 'shipped');
  t := pg_temp.times(p);
  assert t ? 'shipped' and t ? 'processed', t::text;
  assert not t ? 'packed', 'packed was skipped: ' || t::text;
end $$;
rollback;

-- A repeated status takes its latest row; a row that did not move the order never counts.
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
  t jsonb;
begin
  perform public._online_event(p, 'test_a', 'processed', 'packed', null, '{}');
  perform public._online_event(p, 'test_b', 'processed', 'packed', null, '{}');
  perform public._online_event(p, 'test_c', 'packed', 'packed', null, '{}');
  perform pg_temp.at(p, 'test_a', '2026-11-01 03:00+00');
  perform pg_temp.at(p, 'test_b', '2026-11-02 03:00+00');
  perform pg_temp.at(p, 'test_c', '2026-11-03 03:00+00');
  t := pg_temp.times(p);
  assert (t ->> 'packed')::timestamptz = '2026-11-02 03:00+00', 'latest moving row: ' || t::text;
end $$;
rollback;

-- Real rebook: "Order placed" keeps the payment time, and the undone attempt's times are gone.
begin;
do $$
declare
  p uuid := pg_temp.rebooked(pg_temp.mk_variant(1000, 5), 1);
  t jsonb;
begin
  perform pg_temp.at(p, 'paid', '2026-11-01 01:00+00');
  perform pg_temp.at(p, 'rebooked', '2026-11-05 01:00+00');
  t := pg_temp.times(p);
  assert pg_temp.status(p) = 'paid', 'rebook put it back to paid';
  assert (select count(*) from public.order_events where order_id = p and to_status = 'paid' and from_status <> 'paid') = 2,
    'confirm and rebook both moved the order to paid';
  assert (t ->> 'paid')::timestamptz = '2026-11-01 01:00+00', 'paid stays at payment: ' || t::text;
  assert not t ? 'processing' and not t ? 'packed' and not t ? 'shipped', 'old attempt dropped: ' || t::text;

  -- Next attempt by hand, jumping straight to shipped: packed must not reappear from attempt one.
  perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 1, null);
  perform public.online_order_manual_process(p, null, 'self');
  perform public.online_order_manual_advance(p, null, 'shipped');
  t := pg_temp.times(p);
  assert t ? 'processed' and t ? 'shipped', t::text;
  assert not t ? 'packed' and not t ? 'processing', 'only this attempt: ' || t::text;
end $$;
rollback;

-- Backdated manual delivery: the time the parcel arrived, not the time staff clicked.
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
  v_at timestamptz := now() - interval '1 minute';
  t jsonb;
begin
  perform public.online_order_manual_advance(p, null, 'shipped');
  update public.orders set paid_at = now() - interval '3 days' where id = p;
  perform public.online_order_mark_delivered(p, null, v_at, '');
  perform pg_temp.at(p, 'delivered', now() + interval '1 day');
  t := pg_temp.times(p);
  assert (t ->> 'delivered')::timestamptz = v_at, 'delivered_at wins: ' || t::text;
end $$;
rollback;

-- ===================================================================
-- destination and privacy
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  j jsonb;
  t jsonb;
  s text;
  leak text;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('phone', '+919800000042', 'address', jsonb_build_object(
      'name', 'Secret Receiver', 'phone', '+919800000043',
      'line1', '12 Hidden Street', 'line2', 'Private Block', 'landmark', 'Behind Quiet Temple',
      'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001')));
  select public._order_public_json(o) into j from public.orders o where o.id = r.order_id;
  t := public._order_tracking_json(r.order_id);
  assert j ->> 'delivery_city' = 'Ghaziabad' and j ->> 'delivery_pincode' = '201001', j::text;
  assert t ->> 'delivery_city' = 'Ghaziabad' and t ->> 'delivery_pincode' = '201001', t::text;
  s := j::text || t::text;
  foreach leak in array array['Secret Receiver', 'Test Shopper', 'Hidden Street', 'Private Block', 'Quiet Temple',
                              'Uttar Pradesh', '9800000042', '9800000043', 'shopper@example.com'] loop
    assert position(leak in s) = 0, 'leaked ' || leak || ': ' || s;
  end loop;
  assert not j ? 'address' and not j ? 'contact_name' and not j ? 'contact_phone', j::text;
end $$;
rollback;

-- Pickup: no destination even if the address somehow holds one, and its three steps have times.
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  p uuid;
  j jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    '{"fulfilment":"pickup","address":{"name":"Test Shopper","phone":"+919800000001","city":"Ghaziabad","pincode":"201001"}}'::jsonb);
  p := r.order_id;
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 1, null);
  perform public.online_order_mark_ready(p, null);
  perform public.online_order_mark_collected(p, null);
  select public._order_public_json(o) into j from public.orders o where o.id = p;
  assert j -> 'delivery_city' = 'null'::jsonb and j -> 'delivery_pincode' = 'null'::jsonb, j::text;
  assert j -> 'status_times' ? 'paid' and j -> 'status_times' ? 'ready_for_pickup' and j -> 'status_times' ? 'delivered', j::text;
end $$;
rollback;

-- A ship address without the fields gives nulls, and an unknown order gives null.
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  j jsonb;
begin
  update public.orders set address = address - 'city' || '{"pincode":"  "}' where id = p;
  select public._order_public_json(o) into j from public.orders o where o.id = p;
  assert j -> 'delivery_city' = 'null'::jsonb and j -> 'delivery_pincode' = 'null'::jsonb, j::text;
  assert public._order_tracking_json(gen_random_uuid()) is null, 'unknown order';
end $$;
rollback;

-- ===================================================================
-- item photo
-- ===================================================================

-- The item's colour wins over a lower displayorder; lowest displayorder within it.
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  pid text := pg_temp.product_of(p);
begin
  insert into public.productimages (productid, imageurl, productcolor, displayorder) values
    (pid, 'https://img.test/blue-0.webp', 'Blue', 0),
    (pid, 'https://img.test/red-7.webp', 'Red', 7),
    (pid, 'https://img.test/red-5.webp', 'Red', 5);
  assert pg_temp.photo(p) = 'https://img.test/red-5.webp', pg_temp.photo(p);
  assert public._order_tracking_json(p) -> 'item_images' ->> '1' = 'https://img.test/red-5.webp', 'helper agrees';
end $$;
rollback;

-- No image in the colour: the product's first; a tie on displayorder goes to the lower imageid.
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  pid text := pg_temp.product_of(p);
begin
  insert into public.productimages (productid, imageurl, productcolor, displayorder) values
    (pid, 'https://img.test/blue-3.webp', 'Blue', 3),
    (pid, 'https://img.test/green-1a.webp', 'Green', 1),
    (pid, 'https://img.test/green-1b.webp', null, 1);
  assert pg_temp.photo(p) = 'https://img.test/green-1a.webp', pg_temp.photo(p);
end $$;
rollback;

-- No image at all: null, and the row is still returned. Another product's image never leaks in.
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  other uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
begin
  insert into public.productimages (productid, imageurl, productcolor, displayorder)
  values (pg_temp.product_of(other), 'https://img.test/other.webp', 'Red', 0);
  assert pg_temp.photo(p) is null, pg_temp.photo(p);
  assert (select jsonb_array_length(public._order_public_json(o) -> 'items') from public.orders o where o.id = p) = 1, 'row kept';
  assert public._order_tracking_json(p) -> 'item_images' = '{}'::jsonb, 'helper has no image';
end $$;
rollback;

-- ===================================================================
-- old fields kept (old frontend and old handler keep working)
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  j jsonb;
  k text;
begin
  select public._order_public_json(o) into j from public.orders o where o.id = p;
  foreach k in array array['order_ref', 'status', 'fulfilment', 'courier', 'created_at', 'paid_at', 'subtotal',
                           'promo_discount', 'shipping', 'voucher_applied', 'credit_applied', 'gateway_amount',
                           'courier_name', 'awb', 'tracking_label', 'tracking_url', 'items'] loop
    assert j ? k, 'lost ' || k;
  end loop;
  foreach k in array array['name', 'size', 'color', 'qty', 'unit_price', 'status', 'refunded_qty'] loop
    assert j -> 'items' -> 0 ? k, 'lost item ' || k;
  end loop;
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
  assert has_function_privilege('service_role', 'public._order_tracking_json(uuid)', 'execute'), 'service_role';
  foreach f in array array['public._order_tracking_json(uuid)', 'public._order_public_json(public.orders)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      f || ': anon/authenticated must not execute';
  end loop;
end $$;
rollback;

-- Anon really is refused, yet the public lookup still returns the fields through the definer chain.
begin;
create temp table tracking_case on commit drop as
  select pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1) as id;
grant select on tracking_case to anon;
select set_config('test.order_id', (select id::text from tracking_case), true),
       set_config('test.order_ref', (select o.order_ref from public.orders o join tracking_case c on c.id = o.id), true) \g /dev/null
set local role anon;
do $$
declare
  j jsonb;
begin
  begin
    perform public._order_tracking_json(current_setting('test.order_id')::uuid);
    assert false, 'anon must not call the helper';
  exception when insufficient_privilege then
    null;
  end;
  j := public.online_order_lookup(current_setting('test.order_ref'), '+919800000001');
  assert j -> 'status_times' ? 'paid' and j ->> 'delivery_city' = 'Ghaziabad', 'lookup: ' || coalesce(j::text, 'null');
end $$;
reset role;
rollback;
