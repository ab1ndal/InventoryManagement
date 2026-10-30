-- Tests for schema/migration_online_orders_holds.sql (15-minute cart hold, order holds, confirm
-- takes only stock not held by others). Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_any_state.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/migration_online_orders_pickup.sql schema/migration_online_orders_porter.sql \
--     schema/migration_online_orders_holds.sql schema/test_online_orders_holds.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- fixture helpers (pg_temp: vanish with the session) ----------
create function pg_temp.go_live() returns void language sql as $$
  update public.storefront_settings set checkout_live = true where id = 1;
$$;

create function pg_temp.mk_variant(p_price numeric, p_stock numeric)
returns uuid language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  pid text := 'T' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  insert into public.products (productid, name, purchaseprice, retailprice) values (pid, 'Test hold', p_price / 2, p_price);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values (pid, 'M', 'Red', p_stock, v);
  return v;
end $$;

create function pg_temp.key(p text) returns text language sql as $$
  select p || ':' || gen_random_uuid()::text
$$;

-- p_lines: [{v, qty}]; ₹99 shipping (all test goods < 5000), no codes.
create function pg_temp.mk_order(p_lines jsonb, p_holder text default null, p_phone text default '+919800000001')
returns table (order_id uuid, order_ref text, created boolean) language plpgsql as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  l record;
begin
  for l in select (e ->> 'v')::uuid as v, (e ->> 'qty')::int as q, p.retailprice as price
             from jsonb_array_elements(p_lines) e
             join public.productsizecolors psc on psc.variantid = (e ->> 'v')::uuid
             join public.products p on p.productid = psc.productid loop
    v_sub := v_sub + l.price * l.q;
    v_items := v_items || jsonb_build_object('variant_id', l.v, 'qty', l.q, 'unit_price', l.price);
  end loop;
  return query select * from public.online_order_create(
    jsonb_build_object(
      'contact', jsonb_build_object('name', 'Hold Shopper', 'phone', p_phone),
      'address', jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001'),
      'subtotal', v_sub, 'shipping', 99, 'gateway_amount', v_sub + 99, 'holder_key', p_holder),
    v_items, null);
end $$;

create function pg_temp.pay(p_ref text) returns jsonb language sql as $$
  select public.online_order_confirm_payment(p_ref, 'cfpay_' || p_ref,
    (select gateway_amount from public.orders where order_ref = p_ref), 'INR')
$$;

create function pg_temp.hold(p_holder text, p_v uuid, p_qty int, p_ip text default null) returns jsonb language sql as $$
  select public.stock_hold_set(p_holder, jsonb_build_array(jsonb_build_object('variant_id', p_v, 'qty', p_qty)), p_ip, false)
$$;

create function pg_temp.held(p_res jsonb) returns int language sql as $$
  select (p_res -> 'items' -> 0 ->> 'held')::int
$$;

create function pg_temp.stock(p_v uuid) returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = p_v
$$;

create function pg_temp.avail(p_v uuid, p_holder text) returns jsonb language sql as $$
  select to_jsonb(x) from public.variant_availability(array[p_v], p_holder) x
$$;

-- ---------- holder cap (5 units across variants) and IP cap (10 active units) ----------
begin;
do $$
declare
  a uuid := pg_temp.mk_variant(500, 20);
  b uuid := pg_temp.mk_variant(500, 20);
  g text := pg_temp.key('g');
  res jsonb;
begin
  assert pg_temp.held(pg_temp.hold(g, a, 4)) = 4, 'first variant held';
  res := pg_temp.hold(g, b, 3);
  assert pg_temp.held(res) = 1 and res -> 'items' -> 0 ->> 'reason' = 'holder_cap', 'holder cap: 5 - 4 = 1 more';
  assert (res -> 'items' -> 0 ->> 'available')::int = 20, 'cap does not change availability';
  -- re-setting the same variant doesn't count its own hold against the cap
  assert pg_temp.held(pg_temp.hold(g, a, 4)) = 4, 'renewing a variant at its qty is within the cap';

  -- IP cap: three holders on one IP; the third gets 10 - 8 = 2
  assert pg_temp.held(pg_temp.hold(pg_temp.key('g'), a, 4, 'ip1')) = 4, 'ip holder 1';
  assert pg_temp.held(pg_temp.hold(pg_temp.key('g'), b, 4, 'ip1')) = 4, 'ip holder 2';
  res := pg_temp.hold(pg_temp.key('u'), a, 4, 'ip1');
  assert pg_temp.held(res) = 2 and res -> 'items' -> 0 ->> 'reason' = 'ip_cap', 'ip cap';
  -- no IP hash (IP_HASH_SALT unset) → no IP cap
  assert pg_temp.held(pg_temp.hold(pg_temp.key('g'), b, 5)) = 5, 'no ip → no ip cap';
end $$;
rollback;

-- ---------- availability counts only others' active holds; expiry by time; release; replace ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(500, 2);
  w uuid := pg_temp.mk_variant(500, 3);
  g1 text := pg_temp.key('g');
  g2 text := pg_temp.key('g');
  res jsonb;
  av jsonb;
  v_exp timestamptz;
begin
  res := pg_temp.hold(g1, v, 2);
  assert pg_temp.held(res) = 2 and (res ->> 'expires_at')::timestamptz between now() + interval '14 minutes' and now() + interval '15 minutes',
    '15-minute hold';
  res := pg_temp.hold(g2, v, 1);
  assert pg_temp.held(res) = 0 and (res -> 'items' -> 0 ->> 'available')::int = 0
         and res -> 'items' -> 0 ->> 'reason' = 'unavailable', 'others hold every unit';
  assert not exists (select 1 from public.stock_holds where holder_key = g2), 'held 0 → no row';

  av := pg_temp.avail(v, g1);
  assert av @> '{"stock": 2, "held_by_others": 0, "available": 2, "my_held": 2}', 'own hold counts as available';
  av := pg_temp.avail(v, g2);
  assert av @> '{"stock": 2, "held_by_others": 2, "available": 0, "my_held": 0}', 'others hold it';
  assert (av ->> 'others_expire_at')::timestamptz > now() + interval '14 minutes', 'others expiry shown';
  av := pg_temp.avail(v, null);
  assert (av ->> 'available')::int = 0, 'anonymous: everything held is others';

  -- a hold past its expires_at no longer counts, without any sweeper
  update public.stock_holds set expires_at = now() - interval '1 second' where holder_key = g1;
  assert (pg_temp.avail(v, g2) ->> 'available')::int = 2, 'expired hold ignored';
  assert pg_temp.held(pg_temp.hold(g2, v, 1)) = 1, 'second shopper can hold after expiry';
  -- the first shopper's renew only gets what is left
  res := pg_temp.hold(g1, v, 2);
  assert pg_temp.held(res) = 1 and (res -> 'items' -> 0 ->> 'available')::int = 1, 'renew after expiry capped';

  -- every set renews; qty 0 releases
  update public.stock_holds set expires_at = now() + interval '1 minute' where holder_key = g2;
  perform pg_temp.hold(g2, v, 1);
  select expires_at into v_exp from public.stock_holds where holder_key = g2;
  assert v_exp > now() + interval '14 minutes', 'set renews';
  perform pg_temp.hold(g2, v, 0);
  assert not exists (select 1 from public.stock_holds where holder_key = g2), 'qty 0 releases';

  -- replace = sync the whole cart: unlisted variants released, listed renewed
  perform pg_temp.hold(g2, w, 2);
  res := public.stock_hold_set(g2, jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1)), null, true);
  assert pg_temp.held(res) = 1, 'sync holds listed';
  assert not exists (select 1 from public.stock_holds where holder_key = g2 and variant_id = w), 'sync released unlisted';
  res := public.stock_hold_set(g2, '[]'::jsonb, null, true);
  assert not exists (select 1 from public.stock_holds where holder_key = g2), 'empty sync releases all';
  assert res ->> 'expires_at' is null, 'no holds → no expiry';
end $$;
rollback;

-- ---------- rate limit, bad input ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(500, 5);
  g text := pg_temp.key('g');
  res jsonb;
begin
  perform pg_temp.hold(g, v, 1);
  insert into public.code_attempts (scope, key, success) select 'hold', g, true from generate_series(1, 29);
  res := pg_temp.hold(g, v, 3);
  assert (res ->> 'rate_limited')::boolean and jsonb_array_length(res -> 'items') = 0, 'rate limited';
  assert (select qty from public.stock_holds where holder_key = g) = 1, 'rate limited call changed nothing';
  assert res ->> 'expires_at' is not null, 'still reports the current expiry';
  update public.code_attempts set created_at = now() - interval '2 minutes' where scope = 'hold' and key = g;
  assert pg_temp.held(pg_temp.hold(g, v, 3)) = 3, 'window passes';

  begin
    perform pg_temp.hold('u:not-a-uuid', v, 1);
    assert false, 'bad holder key must raise';
  exception when raise_exception then null;
  end;
  begin
    perform pg_temp.hold('o:' || gen_random_uuid(), v, 1);
    assert false, 'order keys are not for carts';
  exception when raise_exception then null;
  end;
  begin
    perform pg_temp.hold(g, v, 21);
    assert false, 'qty over 20 must raise';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- ---------- sign-in: guest holds move to the user key (merged by max) ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(500, 3);
  w uuid := pg_temp.mk_variant(500, 3);
  g text := pg_temp.key('g');
  u text := pg_temp.key('u');
begin
  perform pg_temp.hold(g, v, 2);
  perform pg_temp.hold(g, w, 1);
  perform pg_temp.hold(u, v, 1);
  assert public.stock_hold_adopt(g, u) = 1, 'one non-colliding hold moved';
  assert not exists (select 1 from public.stock_holds where holder_key = g), 'guest key empty';
  assert (select qty from public.stock_holds where holder_key = u and variant_id = v) = 2, 'merged by max';
  assert (select qty from public.stock_holds where holder_key = u and variant_id = w) = 1, 'moved';
  assert (pg_temp.avail(v, u) ->> 'available')::int = 3, 'user sees own (former guest) holds as available';
  begin
    perform public.stock_hold_adopt(u, g);
    assert false, 'adopt only from guest to user';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- ---------- create attaches the holder's holds and extends them; others can't create ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 1);
  g1 text := pg_temp.key('g');
  g2 text := pg_temp.key('g');
  a record;
  h public.stock_holds;
begin
  perform pg_temp.go_live();
  perform pg_temp.hold(g1, v, 1);
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), g2);
    assert false, 'another holder must not order a held unit';
  exception when raise_exception then
    assert sqlerrm like 'out of stock%', 'out of stock: ' || sqlerrm;
  end;
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
    assert false, 'an order without a holder key must not take a held unit';
  exception when raise_exception then
    assert sqlerrm like 'out of stock%', 'out of stock (no key)';
  end;

  -- the holder's own hold counts as available
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), g1);
  select * into h from public.stock_holds where variant_id = v;
  assert (select count(*) from public.stock_holds where variant_id = v) = 1, 'cart hold replaced, not duplicated';
  assert h.order_id = a.order_id and h.holder_key = g1 and h.qty = 1, 'order hold';
  assert h.expires_at between now() + interval '44 minutes' and now() + interval '45 minutes', 'extended to 45 min';
  assert pg_temp.held(pg_temp.hold(g2, v, 1)) = 0, 'still held for the order';
  assert pg_temp.stock(v) = 1, 'create takes no stock';

  -- the same shopper retrying after abandoning payment is not blocked by their own pending order
  perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), g1, '+919800000002');
end $$;
rollback;

-- ---------- create without a holder key: order hold under 'o:<order id>' ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 2);
  a record;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)));
  assert (select holder_key from public.stock_holds where order_id = a.order_id) = 'o:' || a.order_id, 'o: key';
  assert (pg_temp.avail(v, null) ->> 'available')::int = 0, 'held for the order';
  begin
    perform public.online_order_create(jsonb_build_object('holder_key', 'u:bad'), '[]'::jsonb, null);
    assert false, 'bad holder key';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- ---------- confirm takes only stock not held by others, then drops the order's holds ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 3);
  g1 text := pg_temp.key('g');
  g2 text := pg_temp.key('g');
  a record;
  res jsonb;
begin
  perform pg_temp.go_live();
  perform pg_temp.hold(g1, v, 1);
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), g1);
  assert pg_temp.held(pg_temp.hold(g2, v, 2)) = 2, 'other shopper holds the other two';
  res := pg_temp.pay(a.order_ref);
  assert res ->> 'result' = 'confirmed' and jsonb_array_length(res -> 'race_units') = 0, 'held unit taken';
  assert pg_temp.stock(v) = 2, 'one unit taken';
  assert not exists (select 1 from public.stock_holds where order_id = a.order_id), 'order holds dropped';
  assert (select qty from public.stock_holds where holder_key = g2) = 2, 'other holds untouched';
end $$;
rollback;

-- ---------- a non-holder can't pay away a held unit (gets the race refund) ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 1);
  g1 text := pg_temp.key('g');
  b record;
  a record;
  res jsonb;
begin
  perform pg_temp.go_live();
  -- b: an order from before this migration (no holds), still pending
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), null, '+919800000003');
  delete from public.stock_holds where order_id = b.order_id;
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), g1);
  res := pg_temp.pay(b.order_ref);
  assert res ->> 'status' = 'cancelled' and (res -> 'race_units' -> 0 ->> 'units')::int = 1, 'b races: unit held for a';
  assert (select reason from public.order_refunds where id = (res ->> 'refund_id')::uuid) = 'stock_race', 'race refund';
  assert pg_temp.stock(v) = 1, 'b took nothing';
  res := pg_temp.pay(a.order_ref);
  assert res ->> 'status' = 'paid' and jsonb_array_length(res -> 'race_units') = 0, 'holder takes it';
  assert pg_temp.stock(v) = 0, 'sold once';
end $$;
rollback;

-- ---------- a shop sale oversold the holds: the first holder to pay wins, the next races ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 2);
  a record;
  b record;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), pg_temp.key('g'));
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), pg_temp.key('g'), '+919800000004');
  perform public.stock_adjust(v, -1, 'instore sale', 'bill:hold');
  assert (pg_temp.pay(b.order_ref)) ->> 'status' = 'paid', 'b holds and pays first';
  res := pg_temp.pay(a.order_ref);
  assert res ->> 'status' = 'cancelled', 'a races';
  assert pg_temp.stock(v) = 0, 'never negative';
end $$;
rollback;

-- ---------- an expired order hold still belongs to its order at confirm ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 1);
  a record;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), pg_temp.key('g'));
  update public.stock_holds set expires_at = now() - interval '1 minute' where order_id = a.order_id;
  assert (pg_temp.pay(a.order_ref)) ->> 'status' = 'paid', 'own expired hold still counts';
  assert pg_temp.stock(v) = 0, 'taken';
end $$;
rollback;

-- ---------- fail / expiry release the order's holds ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 1);
  a record;
  b record;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), pg_temp.key('g'));
  perform public.online_order_fail(a.order_ref, 'payment_failed', 'test');
  assert not exists (select 1 from public.stock_holds where order_id = a.order_id), 'payment_failed releases';
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), pg_temp.key('g'), '+919800000005');
  perform public.online_order_fail(b.order_ref, 'expired', 'test');
  assert not exists (select 1 from public.stock_holds where order_id = b.order_id), 'expired releases';
  assert (pg_temp.avail(v, null) ->> 'available')::int = 1, 'unit open again';
  -- a late payment on the expired order still takes the free unit (old behaviour)
  assert (pg_temp.pay(b.order_ref)) ->> 'status' = 'paid', 'late payment confirmed';
end $$;
rollback;

-- ---------- purge: expired over a day ago only ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(500, 5);
  g text := pg_temp.key('g');
begin
  insert into public.stock_holds (variant_id, holder_key, qty, expires_at) values
    (v, pg_temp.key('g'), 1, now() - interval '2 days'),
    (v, pg_temp.key('g'), 1, now() - interval '1 hour');
  perform pg_temp.hold(g, v, 1);
  insert into public.code_attempts (scope, key, success, created_at) values ('hold', g, true, now() - interval '2 days');
  assert public.stock_holds_purge() = 2, 'one old hold + one old attempt';
  assert (select count(*) from public.stock_holds where variant_id = v) = 2, 'recent rows kept';
end $$;
rollback;

-- ---------- grants ----------
begin;
do $$
declare
  f text;
begin
  foreach f in array array['public.stock_hold_set(text, jsonb, text, boolean)', 'public.stock_hold_adopt(text, text)',
      'public.stock_holds_purge()', 'public._stock_held_by_others(uuid, text)',
      'public.online_order_create(jsonb, jsonb, uuid)', 'public.online_order_confirm_payment(text, text, numeric, text)'] loop
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      f || ': anon/authenticated must not execute';
  end loop;
  assert has_function_privilege('service_role', 'public.stock_hold_set(text, jsonb, text, boolean)', 'execute'), 'service role';
  assert has_function_privilege('anon', 'public.variant_availability(uuid[], text)', 'execute'), 'anon availability';
  assert has_function_privilege('authenticated', 'public.variant_availability(uuid[], text)', 'execute'), 'auth availability';
  assert not has_table_privilege('anon', 'public.stock_holds', 'select')
     and not has_table_privilege('authenticated', 'public.stock_holds', 'select'), 'holds table private';
end $$;
rollback;

select 'test_online_orders_holds: all passed' as result;
