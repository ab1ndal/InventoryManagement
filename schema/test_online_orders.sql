-- Tests for schema/migration_atomic_shared_writes.sql + schema/migration_online_orders.sql.
-- Each test is `begin; do $$ ... assert ... $$; rollback;` and seeds its own fixtures
-- through the pg_temp helpers below (session-only, never created in the real schema).
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/test_online_orders.sql
-- Concurrency (two real sessions): schema/test_harness/concurrency_test.sh
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

create function pg_temp.mk_customer(p_credit numeric, p_phone text, p_auth boolean default true)
returns int language plpgsql as $$
declare
  u uuid;
  c int;
begin
  if p_auth then
    insert into auth.users (id, email) values (gen_random_uuid(), 'u' || replace(gen_random_uuid()::text, '-', '') || '@t.in')
    returning id into u;
  end if;
  insert into public.customers (first_name, phone, customer_ulid, store_credit, auth_user_id)
  values ('Reg', p_phone, left(replace(gen_random_uuid()::text, '-', ''), 26), p_credit, u)
  returning customerid into c;
  return c;
end $$;

create function pg_temp.auth_of(p_customer int) returns uuid language sql as $$
  select auth_user_id from public.customers where customerid = p_customer
$$;

-- Builds a quote the way the edge function would (greedy shares, which satisfy the
-- same invariants) and calls online_order_create.
-- p_lines: [{v: variant uuid, qty}]; p_opt: {phone, auth_user, promo_code, voucher_code,
-- credit, shipping, attempt_key, token_hash}
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
  v_ship := coalesce((p_opt ->> 'shipping')::numeric, case when v_goods >= 5000 then 0 else 99 end);
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
      'address', jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001'),
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

create function pg_temp.credit(p_c int) returns numeric language sql as $$
  select round(store_credit::numeric, 2) from public.customers where customerid = p_c
$$;

-- Moves an order through claim/prepare/checkpoints/packed. Returns bill id.
create function pg_temp.pack(p_order uuid) returns int language plpgsql as $$
begin
  perform public.online_order_claim(p_order, 'process', null, 'op-pack');
  perform public.online_order_prepare_process(p_order, null);
  perform public.online_order_checkpoint(p_order, 'awb', jsonb_build_object('awb', 'AWB' || left(p_order::text, 8), 'courier_id', 7, 'courier_name', 'Test Courier'));
  perform public.online_order_checkpoint(p_order, 'label', '{"label_url":"https://x/label.pdf"}');
  return public.online_order_mark_packed(p_order, '{}'::jsonb, null);
end $$;

-- ===================================================================
-- R1: atomic shared writes
-- ===================================================================

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(100, '+919811111111');
begin
  assert public.stock_adjust(v, -2, 'sale', 'bill:1') = 3, 'stock_adjust returns new stock';
  assert public.stock_adjust(v, -4, 'sale', 'bill:2') = -1, 'in-store stock_adjust has no floor';
  assert public.store_credit_adjust(c, -40.004, 'bill_tender', '1') = 60, 'credit rounded to 2 dp';
  assert (select count(*) from public.store_credit_ledger where customerid = c and source = 'instore') = 1, 'instore ledger row';
  -- in-store rows are never deduplicated (re-finalisation repeats reason/ref)
  perform public.store_credit_adjust(c, -10, 'bill_tender', '1');
  assert pg_temp.credit(c) = 50, 'second in-store adjust applied';
  begin
    perform public.store_credit_adjust(c, -50.01, 'bill_tender', '2');
    assert false, 'negative balance must raise';
  exception when check_violation then null;
  end;
  -- online source is idempotent per (ref_type, ref, reason)
  perform public.store_credit_adjust(c, 25, 'refund_credit', 'leg-x', 'online', 'refund_leg');
  perform public.store_credit_adjust(c, 25, 'refund_credit', 'leg-x', 'online', 'refund_leg');
  assert pg_temp.credit(c) = 75, 'online adjust applied once';
end $$;
rollback;

begin;
do $$
declare
  c int := pg_temp.mk_customer(100, '+919811111112');
  u_admin uuid := gen_random_uuid();
  u_user uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (u_admin), (u_user);
  insert into public.profiles (id, email, role) values (u_admin, 'a@t.in', 'admin'), (u_user, 'b@t.in', 'user');
  update public.profiles set is_active = true where role in ('admin', 'superadmin');
  perform set_config('request.jwt.claims', json_build_object('sub', u_user, 'role', 'authenticated')::text, true);
  begin
    perform public.store_credit_adjust(c, -1, 'bill_tender', '9');
    assert false, 'non-admin must be refused';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  assert public.store_credit_adjust(c, -1, 'bill_tender', '9') = 99, 'admin may adjust';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  assert public.store_credit_adjust(c, -1, 'bill_tender', '9') = 98, 'service_role may adjust';
end $$;
rollback;

begin;
do $$
begin
  assert has_function_privilege('authenticated', 'public.stock_adjust(uuid,numeric,text,text)', 'execute'), 'authenticated runs stock_adjust';
  assert has_function_privilege('authenticated', 'public.store_credit_adjust(int,numeric,text,text,text,text)', 'execute'), 'authenticated runs store_credit_adjust';
  assert has_function_privilege('authenticated', 'public.voucher_redeem(text,int)', 'execute'), 'authenticated runs voucher_redeem';
  assert not has_function_privilege('anon', 'public.stock_adjust(uuid,numeric,text,text)', 'execute'), 'anon must not run stock_adjust';
  assert not has_function_privilege('anon', 'public.voucher_redeem(text,int)', 'execute'), 'anon must not run voucher_redeem';
  assert not has_function_privilege('anon', 'public.online_order_create(jsonb,jsonb,uuid)', 'execute'), 'anon must not create orders';
  assert not has_function_privilege('authenticated', 'public.online_order_confirm_payment(text,text,numeric,text)', 'execute'), 'authenticated must not confirm';
  assert not has_function_privilege('anon', 'public.online_code_check(text,text,uuid,text)', 'execute'), 'code check is service only';
  assert has_function_privilege('anon', 'public.online_refund_choose(text,text)', 'execute'), 'anon chooses refunds';
  assert has_function_privilege('anon', 'public.online_order_lookup(text,text)', 'execute'), 'anon looks up orders';
  assert has_function_privilege('authenticated', 'public.my_online_orders()', 'execute'), 'authenticated lists own orders';
  assert not has_function_privilege('anon', 'public.my_online_orders()', 'execute'), 'anon has no my_online_orders';
  assert has_function_privilege('service_role', 'public.online_order_claim(uuid,text,uuid,text)', 'execute'), 'service runs claim';
  assert has_table_privilege('anon', 'public.storefront_settings', 'select'), 'settings anon-readable';
  assert not has_table_privilege('anon', 'public.orders', 'select'), 'anon has no orders access';
  assert not has_table_privilege('authenticated', 'public.orders', 'insert'), 'no direct order writes';
  assert (select checkout_live from public.storefront_settings where id = 1) = false, 'checkout_live defaults false';
  assert (select count(*) from public.salesmethods where lower(methodname) = 'website') = 1, 'one Website sales method';
  assert (select relrowsecurity from pg_class where oid = 'public.orders'::regclass), 'RLS on orders';
  assert (select count(*) from pg_policies where tablename in ('orders', 'order_items', 'order_events',
          'order_refunds', 'order_refund_legs') and policyname like '%_admin_select') = 5, 'admin select policies';
end $$;
rollback;

-- R1 / R12: a voucher held by an online order cannot be redeemed in store
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('HELDVOUCHER00001', current_date + 30, 300, 'online_refund');
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"voucher_code":"HELDVOUCHER00001"}');
  assert (select held_order_id from public.vouchers where voucher_id = 'HELDVOUCHER00001') = r.order_id, 'voucher held';
  assert public.voucher_redeem('HELDVOUCHER00001', null) = false, 'held voucher not redeemable in store';
  insert into public.vouchers (voucher_id, expiry_date, value) values ('FREEVOUCHER', current_date + 1, 100);
  assert public.voucher_redeem('FREEVOUCHER', null) = true, 'free voucher redeems';
  assert public.voucher_redeem('FREEVOUCHER', null) = false, 'second redeem fails';
  insert into public.vouchers (voucher_id, expiry_date, value) values ('OLDVOUCHER', current_date - 1, 100);
  assert public.voucher_redeem('OLDVOUCHER', null) = false, 'expired voucher fails';
end $$;
rollback;

-- ===================================================================
-- Task 1: create / confirm
-- ===================================================================

-- live switch off → create raises
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
begin
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
    assert false, 'create must raise while checkout_live is false';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- create → confirm takes stock and converts the credit hold
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1200, 3);
  c int := pg_temp.mk_customer(500, '+919822222222');
  r record;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 300, 'phone', '+919822222222'));
  assert r.order_ref ~ '^WEB-\d{6}$', 'order ref format';
  assert (select status from public.orders where id = r.order_id) = 'pending_payment', 'pending';
  assert pg_temp.credit(c) = 200, 'credit held at create';
  assert pg_temp.stock(v) = 3, 'no stock taken at create';
  assert pg_temp.gw(r.order_ref) = 2400 + 99 - 300, 'gateway amount';
  res := pg_temp.pay(r.order_ref);
  assert res ->> 'result' = 'confirmed', 'confirmed: ' || res::text;
  assert pg_temp.stock(v) = 1, 'stock taken at confirm';
  assert pg_temp.credit(c) = 200, 'credit stays debited';
  assert (select count(*) from public.store_credit_ledger where customerid = c and reason = 'spent') = 1, 'spent ledger row';
  assert (select array_agg(kind order by kind) from public.order_jobs where order_id = r.order_id)
         = array['email_confirmed', 'email_shop', 'shiprocket_create'], 'jobs enqueued';
  assert (select identity_verified from public.orders where id = r.order_id), 'verified identity';
end $$;
rollback;

-- confirm twice → 'already', stock taken once, jobs once
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(800, 4);
  r record;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  res := pg_temp.pay(r.order_ref);
  assert res ->> 'result' = 'already', 'second confirm already: ' || res::text;
  assert pg_temp.stock(v) = 3, 'stock taken once';
  assert (select count(*) from public.order_jobs where order_id = r.order_id) = 3, 'jobs enqueued once';
  -- a different payment for a paid order must be refunded, not absorbed
  res := public.online_order_confirm_payment(r.order_ref, 'cfpay_other', pg_temp.gw(r.order_ref), 'INR');
  assert res ->> 'result' = 'refund_required' and res ->> 'reason' = 'duplicate_payment', 'duplicate payment';
end $$;
rollback;

-- R4: amount / currency mismatch raises; cf_payment_id unique
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(800, 4);
  r record;
  r2 record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  begin
    perform public.online_order_confirm_payment(r.order_ref, 'cf1', pg_temp.gw(r.order_ref) - 1, 'INR');
    assert false, 'amount mismatch must raise';
  exception when raise_exception then
    assert sqlerrm like 'payment mismatch%', sqlerrm;
  end;
  begin
    perform public.online_order_confirm_payment(r.order_ref, 'cf1', pg_temp.gw(r.order_ref), 'USD');
    assert false, 'currency mismatch must raise';
  exception when raise_exception then
    assert sqlerrm like 'payment mismatch%', sqlerrm;
  end;
  begin
    perform public.online_order_confirm_payment(r.order_ref, 'NO_GATEWAY', 0, null);
    assert false, 'no-gateway confirm of a gateway order must raise';
  exception when raise_exception then null;
  end;
  assert (select status from public.orders where id = r.order_id) = 'pending_payment', 'still pending';
  perform public.online_order_confirm_payment(r.order_ref, 'cf1', pg_temp.gw(r.order_ref), 'inr');
  select * into r2 from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  begin
    perform public.online_order_confirm_payment(r2.order_ref, 'cf1', pg_temp.gw(r2.order_ref), 'INR');
    assert false, 'reused cf_payment_id must raise';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- concurrent last unit (sequential form): stock 1, two orders → second races
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 1);
  v2 uuid := pg_temp.mk_variant(700, 5);
  a record;
  b record;
  res jsonb;
  rf public.order_refunds;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919800000011"}');
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1),
                                                          jsonb_build_object('v', v2, 'qty', 1)), '{"phone":"+919800000012"}');
  assert (pg_temp.pay(a.order_ref)) ->> 'result' = 'confirmed', 'a confirmed';
  res := pg_temp.pay(b.order_ref);
  assert res ->> 'result' = 'confirmed', 'b confirmed';
  assert jsonb_array_length(res -> 'race_units') = 1 and (res -> 'race_units' -> 0 ->> 'units')::int = 1, 'b has race units';
  assert pg_temp.stock(v) = 0, 'stock never negative';
  assert pg_temp.stock(v2) = 4, 'other line took stock';
  select * into rf from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert rf.reason = 'stock_race' and rf.status = 'awaiting_choice', 'race refund awaiting choice';
  assert rf.gateway_amount = 1500 and rf.shipping_amount = 0, 'race refund = line paid value, no shipping';
  assert length(rf.token) = 64 and rf.token_expires_at > now() + interval '47 hours', 'refund token';
  assert (select status from public.orders where id = b.order_id) = 'paid', 'b still paid (one line left)';
  assert exists (select 1 from public.order_jobs where order_id = b.order_id and kind = 'refund_notify'
                 and ref_id = rf.id::text), 'refund_notify job';
end $$;
rollback;

-- every unit raced → order cancelled at confirm with shipping refunded
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1500, 0);
  a record;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  res := pg_temp.pay(a.order_ref);
  assert res ->> 'status' = 'cancelled', 'cancelled when nothing in stock';
  assert (select total_amount from public.order_refunds where id = (res ->> 'refund_id')::uuid) = 1599, 'full refund incl shipping';
  assert not exists (select 1 from public.order_jobs where order_id = a.order_id and kind = 'shiprocket_create'), 'no shiprocket job';
end $$;
rollback;

-- R2 + R1: stock_adjust interleaved with online confirm sums correctly
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(500, 10);
  a record;
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 3)));
  perform public.stock_adjust(v, -2, 'instore sale', 'bill:1');
  perform pg_temp.pay(a.order_ref);
  perform public.stock_adjust(v, 1, 'instore return', 'bill:2');
  assert pg_temp.stock(v) = 10 - 2 - 3 + 1, 'stock sums correctly';
end $$;
rollback;

-- late payment after expiry: credit re-takeable → confirmed; not → refund_required
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(400, '+919833333333');
  r record;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 300, 'phone', '+919833333333'));
  perform public.online_order_fail(r.order_ref, 'expired', 'timeout');
  assert (select status from public.orders where id = r.order_id) = 'expired', 'expired';
  assert pg_temp.credit(c) = 400, 'credit released';
  res := pg_temp.pay(r.order_ref);
  assert res ->> 'result' = 'confirmed', 'late pay confirmed: ' || res::text;
  assert pg_temp.credit(c) = 100, 'credit re-taken';
  assert pg_temp.stock(v) = 4, 'stock taken';
  -- fail after paid is a no-op
  perform public.online_order_fail(r.order_ref, 'expired', 'late job');
  assert (select status from public.orders where id = r.order_id) = 'paid', 'fail ignored after paid';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(400, '+919833333334');
  r record;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 300, 'phone', '+919833333334'));
  perform public.online_order_fail(r.order_ref, 'expired', 'timeout');
  perform public.store_credit_adjust(c, -350, 'bill_tender', '77');  -- spent in store meanwhile
  res := pg_temp.pay(r.order_ref);
  assert res ->> 'result' = 'refund_required' and (res ->> 'amount')::numeric = pg_temp.gw(r.order_ref), 'refund required: ' || res::text;
  assert pg_temp.credit(c) = 50, 'no partial re-take';
  assert pg_temp.stock(v) = 5, 'no stock taken';
  assert (select status from public.orders where id = r.order_id) = 'expired', 'stays expired';
  assert exists (select 1 from public.order_events where order_id = r.order_id and kind = 'refund_required'), 'event written';
  -- credit comes back, the same webhook retries: still refund_required, never confirmed
  perform public.store_credit_adjust(c, 350, 'bill_edit', '77');
  res := pg_temp.pay(r.order_ref);
  assert res ->> 'result' = 'refund_required', 'retried late payment stays refund_required: ' || res::text;
  assert pg_temp.credit(c) = 400 and pg_temp.stock(v) = 5, 'nothing taken on retry';
end $$;
rollback;

-- R6: repeat attempt_key returns the same order
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  a record;
  b record;
  k uuid := gen_random_uuid();
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), jsonb_build_object('attempt_key', k));
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), jsonb_build_object('attempt_key', k));
  assert a.created and not b.created and a.order_id = b.order_id, 'idempotent create';
end $$;
rollback;

-- create re-validates prices and totals
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
begin
  perform pg_temp.go_live();
  begin
    perform public.online_order_create(
      jsonb_build_object('contact', jsonb_build_object('name', 'X', 'phone', '9800000001'),
        'address', jsonb_build_object('pincode', '201001'), 'subtotal', 10, 'shipping', 99, 'gateway_amount', 109),
      jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 10)), null);
    assert false, 'client price must be rejected';
  exception when raise_exception then
    assert sqlerrm like '%price changed%', sqlerrm;
  end;
  begin
    perform public.online_order_create(
      jsonb_build_object('contact', jsonb_build_object('name', 'X', 'phone', '9800000001'),
        'address', jsonb_build_object('pincode', '263001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
      jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 1000)), null);
  exception when raise_exception then
    assert false, 'prefix 26 is accepted by the DB (Shiprocket check is the edge function''s job)';
  end;
  begin
    perform public.online_order_create(
      jsonb_build_object('contact', jsonb_build_object('name', 'X', 'phone', '9800000001'),
        'address', jsonb_build_object('pincode', '110001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
      jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 1000)), null);
    assert false, 'Delhi pincode must be rejected';
  exception when raise_exception then null;
  end;
  begin
    perform public.online_order_create(
      jsonb_build_object('contact', jsonb_build_object('name', 'X', 'phone', '9800000001'),
        'address', jsonb_build_object('pincode', '201001'), 'subtotal', 1000, 'shipping', 73, 'gateway_amount', 1073),
      jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 1000)), null);
    assert false, 'shipping must be rounded to 10 or flat 99';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- guest phone match is bookkeeping only (R8)
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(800, '+919844444444');
  r record;
begin
  perform pg_temp.go_live();
  insert into public.vouchers (voucher_id, customerid, expiry_date, value, source)
  values ('OWNEDVOUCH', c, current_date + 30, 200, 'manual');
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919844444444","credit":100}');
    assert false, 'guest must not use store credit';
  exception when raise_exception then null;
  end;
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"9844444444","voucher_code":"OWNEDVOUCH"}');
    assert false, 'guest must not use the owner''s voucher';
  exception when raise_exception then
    assert sqlerrm = 'code not valid', sqlerrm;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"98444 44444"}');
  assert (select customerid from public.orders where id = r.order_id) = c, 'guest matched to customer row by phone';
  assert not (select identity_verified from public.orders where id = r.order_id), 'not verified';
  assert pg_temp.credit(c) = 800, 'credit untouched';
  -- the owner signed in may use both
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'voucher_code', 'OWNEDVOUCH'));
  assert (select voucher_applied from public.orders where id = r.order_id) = 200, 'owner uses own voucher';
end $$;
rollback;

-- new guest gets an is_guest customer row
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919855555555"}');
  assert (select is_guest and phone = '+919855555555' from public.customers c join public.orders o on o.customerid = c.customerid
          where o.id = r.order_id), 'guest row created';
end $$;
rollback;

-- promo maths + once-per-customer reservation (R12)
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(2000, 10);
  a record;
  b record;
  res jsonb;
begin
  perform pg_temp.go_live();
  insert into public.discounts (code, type, value, max_discount, once_per_customer, storefront_redeemable)
  values ('WEB10', 'percentage', 10, 300, true, true), ('INSTORE5', 'flat', 50, null, false, false);
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)),
    '{"phone":"+919866666666","promo_code":"WEB10"}');
  assert (select promo_discount from public.orders where id = a.order_id) = 300, 'percentage capped at max';
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919866666666","promo_code":"WEB10"}');
    assert false, 'second reservation for same phone must fail';
  exception when raise_exception then
    assert sqlerrm = 'code not valid', sqlerrm;
  end;
  res := public.online_code_check('WEB10', '+919866666666', null, 'iphash');
  assert res ->> 'status' = 'invalid', 'code check sees reservation';
  res := public.online_code_check('WEB10', '+919866666667', null, 'iphash');
  assert res ->> 'status' = 'ok' and res ->> 'kind' = 'promo', 'other phone ok';
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919866666668","promo_code":"INSTORE5"}');
    assert false, 'non-storefront promo rejected';
  exception when raise_exception then null;
  end;
  -- releasing on expiry frees the code; confirm marks used + discount_usage
  perform public.online_order_fail(a.order_ref, 'expired', 't');
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919866666666","promo_code":"WEB10"}');
  assert (pg_temp.pay(b.order_ref)) ->> 'result' = 'confirmed', 'b confirmed';
  assert (select status from public.promo_reservations where order_id = b.order_id) = 'used', 'reservation used';
  assert (select count(*) from public.discount_usage where code = 'WEB10') = 1, 'usage recorded';
  -- the expired order paying late cannot re-take the promo → refund_required
  res := pg_temp.pay(a.order_ref);
  assert res ->> 'result' = 'refund_required', 'late pay with promo gone: ' || res::text;
end $$;
rollback;

-- code check: voucher first, generic invalid, rate limit
begin;
do $$
declare
  res jsonb;
begin
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('ONLINEVOUCHER123', current_date + 10, 250, 'online_refund');
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('MANUALVOUCH', current_date + 10, 250, 'manual');
  res := public.online_code_check('ONLINEVOUCHER123', null, null, 'ip1');
  assert res ->> 'status' = 'ok' and res ->> 'kind' = 'voucher' and (res ->> 'value')::numeric = 250, 'online voucher ok';
  res := public.online_code_check('MANUALVOUCH', null, null, 'ip1');
  assert res = '{"status":"invalid"}'::jsonb, 'unowned manual voucher looks like not found';
  res := public.online_code_check('NOPE', null, null, 'ip1');
  assert res = '{"status":"invalid"}'::jsonb, 'not found';
  for i in 1..8 loop perform public.online_code_check('NOPE' || i, null, null, 'ip1'); end loop;
  res := public.online_code_check('ONLINEVOUCHER123', null, null, 'ip1');
  assert res ->> 'status' = 'rate_limited', 'rate limited after 10 failures: ' || res::text;
  res := public.online_code_check('ONLINEVOUCHER123', null, null, 'ip2');
  assert res ->> 'status' = 'ok', 'other ip fine';
end $$;
rollback;

-- voucher larger than due: fully covered, no gateway, leftover reissued
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  res jsonb;
  nv public.vouchers;
begin
  perform pg_temp.go_live();
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('BIGVOUCHER000001', current_date + 100, 1500, 'online_refund');
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"voucher_code":"BIGVOUCHER000001"}');
  assert pg_temp.gw(r.order_ref) = 0, 'no gateway';
  res := public.online_order_confirm_payment(r.order_ref, 'NO_GATEWAY', 0, null);
  assert res ->> 'result' = 'confirmed', 'confirmed without gateway';
  select * into nv from public.vouchers where voucher_id = res #>> '{leftover_voucher,code}';
  assert nv.value = 1500 - 1099 and nv.expiry_date = current_date + 100 and nv.source = 'online_refund', 'leftover voucher';
  assert length(nv.voucher_id) = 16, 'voucher code 16 chars';
  assert (select redeemed from public.vouchers where voucher_id = 'BIGVOUCHER000001'), 'original redeemed';
  assert (public.online_order_confirm_payment(r.order_ref, 'NO_GATEWAY', 0, null)) ->> 'result' = 'already', 'idempotent';
end $$;
rollback;

-- ===================================================================
-- Fulfilment: availability, process, bill, cancel
-- ===================================================================

-- availability 1 of 2 → refund 1 unit's paid value, no shipping
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  it uuid;
  plan jsonb;
  rf public.order_refunds;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)));
  perform pg_temp.pay(r.order_ref);
  select id into it from public.order_items where order_id = r.order_id;
  begin
    perform public.online_order_set_availability(r.order_id, it, 3, null);
    assert false, 'more than taken must raise';
  exception when raise_exception then null;
  end;
  perform public.online_order_set_availability(r.order_id, it, 1, null);
  assert (select status from public.order_items where id = it) = 'partially_available', 'partially available';
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  plan := public.online_order_prepare_process(r.order_id, null);
  assert not (plan ->> 'all_unavailable')::boolean, 'not all unavailable';
  select * into rf from public.order_refunds where id = (plan ->> 'refund_id')::uuid;
  assert rf.total_amount = 1000 and rf.shipping_amount = 0 and rf.units = 1, 'one unit refunded, no shipping';
  assert (plan -> 'shippable_items' -> 0 ->> 'units')::int = 1 and (plan -> 'shippable_items' -> 0 ->> 'paid_value')::numeric = 1000, 'one unit ships';
  assert public.online_order_prepare_process(r.order_id, null) = plan, 'prepare idempotent';
  assert (select count(*) from public.order_refunds where order_id = r.order_id) = 1, 'one refund';
  assert pg_temp.stock(v) = 3, 'unavailable unit gets no stock back';
end $$;
rollback;

-- all unavailable → cancelled, refund includes shipping
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  plan jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 0, null);
  begin
    perform public.online_order_prepare_process(r.order_id, null);
    assert false, 'prepare needs a claim';
  exception when raise_exception then null;
  end;
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  plan := public.online_order_prepare_process(r.order_id, null);
  assert (plan ->> 'all_unavailable')::boolean, 'all unavailable';
  assert (select status from public.orders where id = r.order_id) = 'cancelled', 'cancelled';
  assert (select total_amount from public.order_refunds where id = (plan ->> 'refund_id')::uuid) = 2099, 'refund incl shipping';
end $$;
rollback;

-- R3: claim twice → second gets the existing op; same key resumes; error releases lease
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  c1 jsonb;
  c2 jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  c1 := public.online_order_claim(r.order_id, 'process', null, 'op-A');
  assert (c1 ->> 'claimed')::boolean and not (c1 ->> 'resumed')::boolean, 'first claim wins';
  c2 := public.online_order_claim(r.order_id, 'process', null, 'op-B');
  assert not (c2 ->> 'claimed')::boolean and c2 ->> 'op_key' = 'op-A' and c2 ->> 'reason' = 'busy', 'second sees existing op';
  c2 := public.online_order_claim(r.order_id, 'cancel', null, 'op-C');
  assert not (c2 ->> 'claimed')::boolean and c2 ->> 'reason' = 'other_action', 'cancel refused while processing';
  begin
    perform public.online_order_cancel(r.order_id, null, 'customer asked');
    assert false, 'cancel not allowed from processing';
  exception when raise_exception then null;
  end;
  c2 := public.online_order_claim(r.order_id, 'process', null, 'op-A');
  assert (c2 ->> 'claimed')::boolean and (c2 ->> 'resumed')::boolean, 'same key resumes';
  perform public.online_order_checkpoint(r.order_id, 'error', '{"error":"label failed"}');
  c2 := public.online_order_claim(r.order_id, 'process', null, 'op-B');
  assert (c2 ->> 'claimed')::boolean and (c2 ->> 'resumed')::boolean and c2 #>> '{order,process_error}' = 'label failed',
    'retry takes over after error';
end $$;
rollback;

-- R3: checkpoints are skipped when present; mark_packed creates the Bill of Supply
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1200, 5);
  v2 uuid := pg_temp.mk_variant(800, 5, 'Saree');
  r record;
  cp jsonb;
  bill int;
  b public.bills;
begin
  perform pg_temp.go_live();
  insert into public.discounts (code, type, value, storefront_redeemable) values ('FLAT100', 'flat', 100, true);
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1), jsonb_build_object('v', v2, 'qty', 2)),
    '{"promo_code":"FLAT100","shipping":80}');
  perform pg_temp.pay(r.order_ref);
  assert pg_temp.stock(v) = 4 and pg_temp.stock(v2) = 3, 'stock taken at pay';
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  perform public.online_order_prepare_process(r.order_id, null);
  cp := public.online_order_checkpoint(r.order_id, 'awb', '{"awb":"AWB123","courier_id":12,"courier_name":"Delhivery"}');
  assert not (cp ->> 'skipped')::boolean, 'awb stored';
  cp := public.online_order_checkpoint(r.order_id, 'awb', '{"awb":"AWB999"}');
  assert (cp ->> 'skipped')::boolean and (select awb from public.orders where id = r.order_id) = 'AWB123', 'awb checkpoint skipped';
  perform public.online_order_checkpoint(r.order_id, 'pickup', '{}');
  assert (public.online_order_checkpoint(r.order_id, 'pickup', '{}') ->> 'skipped')::boolean, 'pickup skipped';
  begin
    perform public.online_order_mark_packed(r.order_id, '{}', null);
    assert false, 'label required';
  exception when raise_exception then null;
  end;
  bill := public.online_order_mark_packed(r.order_id, '{"label_url":"https://x/l.pdf"}', null);
  select * into b from public.bills where billid = bill;
  assert b.document_type = 'bos' and b.finalized and b.bill_number ~ '^FY\d{2}-\d{6}$', 'bos numbered by trigger';
  assert b.totalamount = 2800 - 100 + 80 and b.gst_total = 0 and b.discount_total = 100, 'bill totals';
  assert b.salesmethodid = (select salesmethodid from public.salesmethods where methodname = 'Website'), 'online sales method';
  assert (select count(*) from public.bill_items where billid = bill and product_name = 'Shipping' and total = 80) = 1, 'shipping line';
  assert (select sum(total) from public.bill_items where billid = bill) = b.totalamount, 'items sum to bill';
  assert (select count(*) from public.bill_items where billid = bill and gst_amount <> 0) = 0, 'no GST';
  assert pg_temp.stock(v) = 4 and pg_temp.stock(v2) = 3, 'bill changes no stock';
  assert (select status from public.orders where id = r.order_id) = 'packed', 'packed';
  assert public.online_order_mark_packed(r.order_id, '{}', null) = bill, 'mark_packed idempotent';
  assert (select billid from public.discount_usage where code = 'FLAT100') = bill, 'usage linked to bill';
end $$;
rollback;

-- cancel: stock back except unavailable units, refund includes shipping, repeat → same id
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  it uuid;
  rf1 uuid;
  rf2 uuid;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 3)));
  perform pg_temp.pay(r.order_ref);
  assert pg_temp.stock(v) = 2, 'took 3';
  select id into it from public.order_items where order_id = r.order_id;
  perform public.online_order_set_availability(r.order_id, it, 2, null);
  begin
    perform public.online_order_cancel(r.order_id, null, '');
    assert false, 'reason required';
  exception when raise_exception then null;
  end;
  rf1 := public.online_order_cancel(r.order_id, null, 'customer asked');
  assert pg_temp.stock(v) = 4, 'stock back for the 2 available units only';
  assert (select total_amount from public.order_refunds where id = rf1) = 3099, 'everything refunded incl shipping';
  rf2 := public.online_order_cancel(r.order_id, null, 'again');
  assert rf1 = rf2 and pg_temp.stock(v) = 4, 'cancel idempotent';
end $$;
rollback;

-- tracking forward only; raw status stored; problem and courier-cancel set problem (R15)
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  res jsonb;
  o public.orders;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 1, null);
  perform pg_temp.pack(r.order_id);
  select * into o from public.orders where id = r.order_id;
  res := public.online_order_apply_tracking(o.awb, 'shipped', '{"shipment_status_id":6,"shipment_status":"SHIPPED"}');
  assert (res ->> 'changed')::boolean, 'shipped';
  assert exists (select 1 from public.order_jobs where order_id = o.id and kind = 'email_shipped'), 'shipped email job';
  res := public.online_order_apply_tracking(o.awb, 'problem', '{"shipment_status_id":21,"shipment_status":"UNDELIVERED"}');
  select * into o from public.orders where id = r.order_id;
  assert o.status = 'shipped' and o.problem like 'Courier: UNDELIVERED%' and o.tracking_status_id = 21, 'problem without status change';
  perform public.online_order_apply_tracking(o.awb, 'delivered', '{"shipment_status_id":7,"shipment_status":"DELIVERED"}');
  res := public.online_order_apply_tracking(o.awb, 'shipped', '{"shipment_status_id":6}');
  select * into o from public.orders where id = r.order_id;
  assert o.status = 'delivered' and not (res ->> 'changed')::boolean, 'stays delivered';
  assert o.tracking_status_id = 6, 'raw status still recorded';
  assert exists (select 1 from public.order_jobs where order_id = o.id and kind = 'email_delivered'), 'delivered email job';
  res := public.online_order_apply_tracking('NOSUCHAWB', 'shipped', '{}');
  assert not (res ->> 'matched')::boolean, 'unknown awb';
end $$;
rollback;

-- ===================================================================
-- Refunds
-- ===================================================================

-- guest chooses store credit → 16-char voucher, expiry +1 year; choose twice raises
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  plan jsonb;
  tok text;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)), '{"phone":"+919877777777"}');
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 1, null);
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  plan := public.online_order_prepare_process(r.order_id, null);
  select token into tok from public.order_refunds where id = (plan ->> 'refund_id')::uuid;
  set local role anon;
  res := public.online_refund_choose(tok, 'store_credit');
  reset role;
  assert res ->> 'status' = 'completed', 'credit choice completes: ' || res::text;
  assert length(res #>> '{vouchers,0,code}') = 16 and res #>> '{vouchers,0,code}' ~ '^[A-HJ-NP-Z2-9]{16}$', 'voucher code alphabet';
  assert (res #>> '{vouchers,0,expiry}')::date = (current_date + interval '1 year')::date, 'expiry +1 year';
  assert (res #>> '{vouchers,0,value}')::numeric = 1000, 'voucher value = unit paid value';
  begin
    perform public.online_refund_choose(tok, 'original');
    assert false, 'second choice must raise';
  exception when raise_exception then
    assert sqlerrm = 'refund choice already made', sqlerrm;
  end;
  begin
    perform public.online_refund_choose('nonsense', 'original');
    assert false, 'bad token must raise';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- registered: credit-paid part returns as store credit at once; original → legs processing
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(600, '+919888888888');
  r record;
  plan jsonb;
  rf public.order_refunds;
  res jsonb;
  leg uuid;
begin
  perform pg_temp.go_live();
  -- credit 600 covers 600 of goods (2000); line credit_part 600, gateway 1400
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 600));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 1, null);
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  plan := public.online_order_prepare_process(r.order_id, null);
  select * into rf from public.order_refunds where id = (plan ->> 'refund_id')::uuid;
  assert rf.credit_amount = 300 and rf.gateway_amount = 700, 'per-unit split of credit and gateway';
  assert pg_temp.credit(c) = 300, 'credit leg back as store credit immediately';
  assert rf.status = 'awaiting_choice', 'gateway part awaits choice';
  res := public.online_refund_choose(rf.token, 'original');
  assert res ->> 'status' = 'processing' and jsonb_array_length(res -> 'gateway_legs') = 1, 'original → processing';
  leg := (res #>> '{gateway_legs,0,leg_id}')::uuid;
  perform public.online_refund_set_status(leg, 'processing', 'cf_rf_1', null);
  perform public.online_refund_set_status(leg, 'completed', 'cf_rf_1', 'SUCCESS');
  perform public.online_refund_set_status(leg, 'failed', null, 'late webhook');
  assert (select status from public.order_refund_legs where id = leg) = 'completed', 'completed is terminal';
  assert (select status from public.order_refunds where id = rf.id) = 'completed', 'header completed';
  assert pg_temp.credit(c) = 300, 'original refund adds no credit';
end $$;
rollback;

-- R13: completing a credit leg twice credits once; legs capped per source
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(0, '+919899999999');
  r record;
  rid uuid;
  leg uuid;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c)));
  perform pg_temp.pay(r.order_ref);
  rid := public.online_order_cancel(r.order_id, null, 'test');
  select id into leg from public.order_refund_legs where refund_id = rid and source = 'gateway';
  perform public.online_refund_choose((select token from public.order_refunds where id = rid), 'store_credit');
  perform public._online_leg_complete_credit(leg);
  update public.order_refund_legs set status = 'pending' where id = leg;  -- simulate a lost status write
  perform public._online_leg_complete_credit(leg);
  assert (select count(*) from public.store_credit_ledger where ref_type = 'refund_leg' and ref_id = leg::text) = 1, 'one ledger row per leg';
  assert pg_temp.credit(c) = 1099, 'credited once (goods + shipping)';
  begin
    insert into public.order_refund_legs (refund_id, source, amount)
    values ((select id from public.order_refunds where id = rid), 'shipping_credit', 1);
    assert false, 'leg beyond paid must raise';
  exception when check_violation or unique_violation then null;
  end;
  begin
    perform public._online_refund_create(r.order_id, 'unavailable',
      jsonb_build_array(jsonb_build_object('item_id', (select id from public.order_items where order_id = r.order_id), 'units', 1)), false, null);
    assert false, 'refunding more units than ordered must raise';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- per-unit split is exact in paise across separate refunds
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(333.33, 10);
  c int := pg_temp.mk_customer(100, '+919811110000');
  r record;
  it public.order_items;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 3)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 100));
  perform pg_temp.pay(r.order_ref);
  select * into it from public.order_items where order_id = r.order_id;
  perform public._online_refund_create(r.order_id, 'unavailable', jsonb_build_array(jsonb_build_object('item_id', it.id, 'units', 1)), false, null);
  perform public._online_refund_create(r.order_id, 'unavailable', jsonb_build_array(jsonb_build_object('item_id', it.id, 'units', 2)), false, null);
  assert (select sum(credit_amount) from public.order_refund_items where item_id = it.id) = it.credit_part, 'credit exact';
  assert (select sum(gateway_amount) from public.order_refund_items where item_id = it.id) = it.gateway_part, 'gateway exact';
end $$;
rollback;

-- default after 48 h flips only expired rows
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  a record;
  b record;
  ra uuid;
  rb uuid;
  flipped uuid[];
begin
  perform pg_temp.go_live();
  select * into a from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  select * into b from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(a.order_ref);
  perform pg_temp.pay(b.order_ref);
  ra := public.online_order_cancel(a.order_id, null, 'x');
  rb := public.online_order_cancel(b.order_id, null, 'x');
  update public.order_refunds set token_expires_at = now() - interval '1 minute' where id = ra;
  select array_agg(x) into flipped from public.online_refund_default_expired() x;
  assert flipped = array[ra], 'only the expired one';
  assert (select choice || '/' || status from public.order_refunds where id = ra) = 'original/processing', 'defaulted to original';
  assert (select status from public.order_refunds where id = rb) = 'awaiting_choice', 'fresh untouched';
  assert (select count(*) from public.online_refund_default_expired()) = 0, 'second run no-op';
end $$;
rollback;

-- ===================================================================
-- R14: RTO
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  it uuid;
  rf_unavail uuid;
  rf1 uuid;
  rf2 uuid;
  awb text;
  bill int;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 3)));
  perform pg_temp.pay(r.order_ref);
  select id into it from public.order_items where order_id = r.order_id;
  perform public.online_order_set_availability(r.order_id, it, 2, null);
  bill := pg_temp.pack(r.order_id);
  rf_unavail := (select (process_plan ->> 'refund_id')::uuid from public.orders where id = r.order_id);
  perform public.online_refund_choose((select token from public.order_refunds where id = rf_unavail), 'original');
  assert (select status from public.order_refunds where id = rf_unavail) = 'processing', 'earlier refund still processing';
  begin
    perform public.online_order_rto_received(r.order_id, null);
    assert false, 'rto_received needs rto';
  exception when raise_exception then null;
  end;
  select o.awb into awb from public.orders o where id = r.order_id;
  perform public.online_order_apply_tracking(awb, 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_apply_tracking(awb, 'rto', '{"shipment_status_id":9}');
  assert pg_temp.stock(v) = 2, 'stock before RTO';
  rf1 := public.online_order_rto_received(r.order_id, null);
  assert (select units from public.order_refunds where id = rf1) = 2, 'only the 2 shipped units refunded';
  assert (select total_amount from public.order_refunds where id = rf1) = 2000 and
         (select shipping_amount from public.order_refunds where id = rf1) = 0, 'item value, no shipping';
  assert pg_temp.stock(v) = 4, 'stock back for shipped units';
  assert (select count(*) from public.exchanges e join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
          where bi.billid = bill and e.reason = 'RTO' and e.quantity = 2 and e.credit_amount = 2000
            and e.new_billid = bill) = 1, 'exchanges row offsets the bill';
  rf2 := public.online_order_rto_received(r.order_id, null);
  assert rf1 = rf2 and pg_temp.stock(v) = 4, 'second RTO call is a no-op';
  assert (select count(*) from public.exchanges where reason = 'RTO') = 1, 'no duplicate exchanges';
  -- guest RTO refund chosen as credit → voucher linked on the exchange row
  perform public.online_refund_choose((select token from public.order_refunds where id = rf1), 'store_credit');
  assert (select voucher_id is not null from public.exchanges where reason = 'RTO'), 'voucher linked to exchange';
  assert (select sum(l.amount) from public.order_refund_legs l join public.order_refunds x on x.id = l.refund_id
           where x.order_id = r.order_id and l.source = 'gateway')
         <= (select sum(gateway_part) from public.order_items where order_id = r.order_id), 'Σ gateway legs ≤ paid';
end $$;
rollback;

-- ===================================================================
-- Access, lookup, jobs
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(0, '+919812345678');
  r record;
  res jsonb;
  n int;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('phone', '+919812345678', 'auth_user', pg_temp.auth_of(c),
                       'token_hash', encode(sha256('secret-token'::bytea), 'hex')));
  assert public.online_order_access_ok(r.order_ref, encode(sha256('secret-token'::bytea), 'hex')), 'token ok';
  assert not public.online_order_access_ok(r.order_ref, encode(sha256('wrong'::bytea), 'hex')), 'wrong token';
  assert not public.online_order_access_ok('WEB-999999', 'x'), 'unknown order';
  perform pg_temp.pay(r.order_ref);
  set local role anon;
  assert public.online_order_lookup(r.order_ref, '+919800000000') is null, 'wrong phone → null';
  res := public.online_order_lookup(lower(r.order_ref), '98123 45678');
  reset role;
  assert res ->> 'status' = 'paid' and jsonb_array_length(res -> 'items') = 1, 'lookup returns order';
  assert not (res ? 'contact_phone') and not (res ? 'address'), 'no contact data in lookup';
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.auth_of(c), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.my_online_orders();
  reset role;
  assert n = 1, 'my_online_orders lists own order';
  for i in 1..10 loop perform public.online_order_lookup(r.order_ref, '+919800000000'); end loop;
  assert public.online_order_lookup(r.order_ref, '+919812345678') is null, 'rate limited after failures';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  j public.order_jobs;
  n int;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  select count(*) into n from public.online_jobs_claim(10);
  assert n = 3, 'claims 3 jobs';
  assert (select count(*) from public.online_jobs_claim(10)) = 0, 'running jobs not re-claimed within lease';
  select * into j from public.order_jobs where order_id = r.order_id and kind = 'email_shop';
  perform public.online_job_finish(j.id, false, 'smtp down');
  select * into j from public.order_jobs where id = j.id;
  assert j.status = 'pending' and j.run_after > now() and j.last_error = 'smtp down', 'backoff';
  update public.order_jobs set attempts = 10 where id = j.id;
  perform public.online_job_finish(j.id, false, 'smtp down');
  assert (select status from public.order_jobs where id = j.id) = 'failed', 'gives up after 10';
  assert (select problem from public.orders where id = r.order_id) like 'Job email_shop failed%', 'order flagged';
  select * into j from public.order_jobs where order_id = r.order_id and kind = 'email_confirmed';
  perform public.online_job_finish(j.id, true, null);
  assert (select status from public.order_jobs where id = j.id) = 'done', 'done';
end $$;
rollback;

-- R5: failed attempts are only logged; stale list for the expiry job
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform public.online_order_log_event(r.order_ref, 'payment_attempt_failed', '{"cf_payment_id":"x"}');
  assert (select status from public.orders where id = r.order_id) = 'pending_payment', 'still pending';
  assert (select count(*) from public.online_order_list_stale()) = 0, 'fresh order not stale';
  update public.orders set created_at = now() - interval '46 minutes' where id = r.order_id;
  assert (select order_ref from public.online_order_list_stale()) = r.order_ref, 'stale order listed';
  perform public.online_order_checkpoint(r.order_id, 'cf_order', '{"cf_order_id":"cf_o_1"}');
  assert (select cf_order_id from public.online_order_list_stale()) = 'cf_o_1', 'cf order id stored';
end $$;
rollback;

select 'online orders: all assertions passed' as result;

-- Review B1: a held voucher spent elsewhere (old in-store code path ignored the hold)
-- must not let the online order confirm or mint a leftover voucher.
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  res jsonb;
begin
  perform pg_temp.go_live();
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('SPENTVOUCHER0001', current_date + 30, 2000, 'online_refund');
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"voucher_code":"SPENTVOUCHER0001"}');
  update public.vouchers set redeemed = true, redeemed_at = now() where voucher_id = 'SPENTVOUCHER0001';
  res := public.online_order_confirm_payment(r.order_ref, 'NO_GATEWAY', 0, 'INR');
  assert res ->> 'result' = 'refund_required' and res ->> 'reason' = 'holds_unavailable', 'spent voucher → refund_required, got ' || res::text;
  assert (select status from public.orders where id = r.order_id) = 'payment_failed', 'order failed';
  assert (select stock from public.productsizecolors where variantid = v) = 5, 'no stock taken';
  assert (select count(*) from public.vouchers where note like 'Balance of voucher SPENTVOUCHER0001%') = 0, 'no leftover voucher minted';
  res := public.online_order_confirm_payment(r.order_ref, 'NO_GATEWAY', 0, 'INR');
  assert res ->> 'result' = 'refund_required', 'retry stays refund_required';
end $$;
rollback;

-- R7: a voucher that leaves 0 < due - voucher < ₹1 is applied ₹1 short so Cashfree's
-- ₹1 minimum holds; the exact least(value, due) amount stays rejected.
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('NEARLYALL0000001', current_date + 30, 1098.50, 'online_refund');
  begin
    perform pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"voucher_code":"NEARLYALL0000001"}');
    assert false, 'gateway 0.50 must be rejected';
  exception when raise_exception then null;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    '{"voucher_code":"NEARLYALL0000001","voucher_applied":1098}');
  assert pg_temp.gw(r.order_ref) = 1.00, 'gateway is the ₹1 minimum';
  assert (select voucher_applied from public.orders where id = r.order_id) = 1098, 'voucher applied ₹1 short';
end $$;
rollback;
