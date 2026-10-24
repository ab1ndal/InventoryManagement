-- Tests for schema/migration_online_orders_refunds.sql (refunds slice).
-- Fixture helpers below are copied from schema/test_online_orders.sql (pg_temp, session-only).
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql schema/migration_online_orders.sql \
--     schema/migration_online_orders_refunds.sql schema/test_online_orders_refunds.sql
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

-- A guest order of 2 units at ₹1000 (+₹99 shipping), paid, then 1 unit marked
-- unavailable and processed: refund of ₹1000 gateway money awaiting choice.
create function pg_temp.guest_refund() returns uuid language plpgsql as $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  plan jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)), '{"phone":"+919877777777"}');
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 1, null);
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  plan := public.online_order_prepare_process(r.order_id, null);
  return (plan ->> 'refund_id')::uuid;
end $$;

-- grants
begin;
do $$
begin
  assert has_function_privilege('anon', 'public.online_refund_preview(text)', 'execute'), 'anon previews';
  assert not has_function_privilege('anon', 'public.online_refund_notice(uuid)', 'execute'), 'notice is service only';
  assert not has_function_privilege('anon', 'public.online_refund_legs_due(interval,interval)', 'execute'), 'legs_due service only';
  assert not has_function_privilege('anon', 'public.online_refund_open_legs(uuid)', 'execute'), 'open_legs service only';
  assert not has_function_privilege('anon', 'public.online_refund_rate_limited(text)', 'execute'), 'rate check service only';
  assert not has_function_privilege('authenticated', 'public.online_refund_record_failure(text)', 'execute'), 'record service only';
  assert has_function_privilege('service_role', 'public.online_refund_notice(uuid)', 'execute'), 'service notice';
end $$;
rollback;

-- preview: exact contract shape, guest, items; unknown/empty token → null
begin;
do $$
declare
  rid uuid := pg_temp.guest_refund();
  tok text := (select token from public.order_refunds where id = rid);
  p jsonb;
begin
  set local role anon;
  p := public.online_refund_preview(tok);
  reset role;
  assert (select array_agg(k order by k) from jsonb_object_keys(p) k)
       = array['amount', 'creditPart', 'expiresAt', 'gatewayPart', 'isGuest', 'items', 'orderRef', 'status'],
    'exact keys: ' || p::text;
  assert p ->> 'status' = 'awaiting_choice', 'status';
  assert (p ->> 'amount')::numeric = 1000 and (p ->> 'gatewayPart')::numeric = 1000
     and (p ->> 'creditPart')::numeric = 0, 'money: ' || p::text;
  assert (p ->> 'isGuest')::boolean, 'guest';
  assert p ->> 'orderRef' like 'WEB-%', 'order ref';
  assert jsonb_array_length(p -> 'items') = 1, 'one item';
  assert (select array_agg(k order by k) from jsonb_object_keys(p #> '{items,0}') k)
       = array['color', 'name', 'size', 'units'], 'item keys (no PII): ' || (p -> 'items')::text;
  assert (p #>> '{items,0,units}')::int = 1 and p #>> '{items,0,size}' = 'M' and p #>> '{items,0,color}' = 'Red', 'item';
  assert (p ->> 'expiresAt')::timestamptz > now() + interval '47 hours', 'expires in 48 h';
  assert public.online_refund_preview('nonsense') is null, 'unknown token';
  assert public.online_refund_preview('') is null and public.online_refund_preview(null) is null, 'empty token';
end $$;
rollback;

-- preview: registered customer, credit part and gateway part; status after choice
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(600, '+919888888888');
  r record;
  plan jsonb;
  tok text;
  p jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 600));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 1, null);
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  plan := public.online_order_prepare_process(r.order_id, null);
  select token into tok from public.order_refunds where id = (plan ->> 'refund_id')::uuid;
  p := public.online_refund_preview(tok);
  assert not (p ->> 'isGuest')::boolean, 'registered';
  assert (p ->> 'creditPart')::numeric = 300 and (p ->> 'gatewayPart')::numeric = 700
     and (p ->> 'amount')::numeric = 1000, 'split: ' || p::text;
  perform public.online_refund_choose(tok, 'original');
  assert public.online_refund_preview(tok) ->> 'status' = 'processing', 'status after choice';
end $$;
rollback;

-- rate limit: 10 failures per hour per ip hash; null hash never limited
begin;
do $$
begin
  for i in 1..9 loop perform public.online_refund_record_failure('h1'); end loop;
  assert not public.online_refund_rate_limited('h1'), '9 failures ok';
  perform public.online_refund_record_failure('h1');
  assert public.online_refund_rate_limited('h1'), '10 failures limited';
  assert not public.online_refund_rate_limited('h2'), 'other ip ok';
  update public.code_attempts set created_at = now() - interval '61 minutes' where key = 'ip:h1';
  assert not public.online_refund_rate_limited('h1'), 'window is one hour';
  perform public.online_refund_record_failure(null);
  assert not public.online_refund_rate_limited(null), 'null hash';
  assert not exists (select 1 from public.code_attempts where key is null or key = 'ip:'), 'null hash not recorded';
end $$;
rollback;

-- open legs, legs_due grace and poll age
begin;
do $$
declare
  rid uuid := pg_temp.guest_refund();
  tok text := (select token from public.order_refunds where id = rid);
  leg uuid;
  n int;
begin
  assert (select count(*) from public.online_refund_open_legs(rid)) = 0, 'no open legs before choice';
  perform public.online_refund_choose(tok, 'original');
  select leg_id into leg from public.online_refund_open_legs(rid);
  assert leg is not null and (select amount from public.online_refund_open_legs(rid)) = 1000, 'one open leg of 1000';
  assert (select count(*) from public.online_refund_legs_due()) = 0, 'fresh choice is inside the submit grace';
  update public.order_refund_legs set updated_at = now() - interval '11 minutes' where id = leg;
  assert (select action from public.online_refund_legs_due() where leg_id = leg) = 'submit', 'stale unsubmitted leg';
  perform public.online_refund_set_status(leg, 'processing', 'cf_1', null);
  assert (select count(*) from public.online_refund_open_legs(rid)) = 0, 'submitted leg not open';
  assert (select count(*) from public.online_refund_legs_due()) = 0, 'just submitted: not polled yet';
  update public.order_refund_legs set updated_at = now() - interval '61 minutes' where id = leg;
  assert (select action || '/' || cf_refund_id from public.online_refund_legs_due() where leg_id = leg) = 'poll/cf_1', 'poll after 1 h';
  perform public.online_refund_set_status(leg, 'completed', 'cf_1', 'SUCCESS');
  select count(*) into n from public.online_refund_legs_due();
  assert n = 0, 'completed leg not due';
end $$;
rollback;

-- completed job: guest store credit → one ':completed' job; original completes → job
begin;
do $$
declare
  rid uuid := pg_temp.guest_refund();
  tok text := (select token from public.order_refunds where id = rid);
  o uuid := (select order_id from public.order_refunds where id = rid);
  n jsonb;
begin
  assert not exists (select 1 from public.order_jobs where order_id = o and ref_id = rid::text || ':completed'), 'none before';
  perform public.online_refund_choose(tok, 'store_credit');
  assert (select count(*) from public.order_jobs where order_id = o and kind = 'refund_notify'
          and ref_id = rid::text || ':completed') = 1, 'completed job';
  perform public._online_refund_recompute(rid);
  assert (select count(*) from public.order_jobs where order_id = o and ref_id like '%:completed') = 1, 'recompute does not re-enqueue';
  n := public.online_refund_notice(rid);
  assert n ->> 'status' = 'completed' and n ->> 'choice' = 'store_credit', 'notice status';
  assert n ->> 'email' = 'shopper@example.com' and n ->> 'token' = tok, 'notice email + token';
  assert length(n #>> '{legs,0,voucher,code}') = 16 and (n #>> '{legs,0,voucher,value}')::numeric = 1000, 'voucher in notice: ' || n::text;
  assert n #>> '{items,0,categoryId}' = 'Kurti', 'category for similar pieces';
  assert public.online_refund_notice(gen_random_uuid()) is null, 'unknown refund';
end $$;
rollback;

begin;
do $$
declare
  rid uuid := pg_temp.guest_refund();
  o uuid := (select order_id from public.order_refunds where id = rid);
  leg uuid;
begin
  perform public.online_refund_choose((select token from public.order_refunds where id = rid), 'original');
  select leg_id into leg from public.online_refund_open_legs(rid);
  perform public.online_refund_set_status(leg, 'processing', 'cf_9', null);
  assert not exists (select 1 from public.order_jobs where order_id = o and ref_id like '%:completed'), 'processing: no job';
  perform public.online_refund_set_status(leg, 'completed', 'cf_9', 'SUCCESS');
  assert exists (select 1 from public.order_jobs where order_id = o and ref_id = rid::text || ':completed'), 'job on completion';
end $$;
rollback;

-- credit-only refund (registered, fully paid with credit): completed at creation, no choice, no ':completed' job
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  c int := pg_temp.mk_customer(5000, '+919811112222');
  r record;
  rid uuid;
  n jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)),
    jsonb_build_object('auth_user', pg_temp.auth_of(c), 'credit', 1099));
  assert pg_temp.gw(r.order_ref) = 0, 'fully covered';
  perform public.online_order_confirm_payment(r.order_ref, 'NO_GATEWAY', 0, 'INR');
  rid := public.online_order_cancel(r.order_id, null, 'test');
  n := public.online_refund_notice(rid);
  assert n ->> 'status' = 'completed' and n ->> 'choice' is null and n ->> 'token' is null, 'credit-only: ' || n::text;
  assert (n ->> 'gatewayPart')::numeric = 0 and (n ->> 'creditPart')::numeric = 1099, 'credit part incl shipping';
  assert not (n ->> 'isGuest')::boolean, 'registered';
  assert exists (select 1 from public.order_jobs where order_id = r.order_id and kind = 'refund_notify' and ref_id = rid::text), 'first notice job';
  assert not exists (select 1 from public.order_jobs where order_id = r.order_id and ref_id like '%:completed'), 'no completed job';
end $$;
rollback;

\echo 'test_online_orders_refunds: all passed'
