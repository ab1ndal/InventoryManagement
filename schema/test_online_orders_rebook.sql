-- Tests for schema/migration_online_orders_rebook.sql (_online_bill_offset).
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/test_online_orders_rebook.sql
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


-- Packs a 2-unit order (shipping 99) and hand-builds a refund of 1 unit + shipping legs.
create function pg_temp.mk_refund_after_bill(p_v uuid, out o_order uuid, out o_refund uuid, out o_bill int)
language plpgsql as $$
declare
  r record;
  it uuid;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', p_v, 'qty', 2)),
                                         jsonb_build_object('shipping', 99));
  perform pg_temp.pay(r.order_ref);
  select id into it from public.order_items where order_id = r.order_id;
  perform public.online_order_set_availability(r.order_id, it, 2, null);
  o_bill := pg_temp.pack(r.order_id);
  o_order := r.order_id;
  insert into public.order_refunds (order_id, reason, units, total_amount, shipping_amount)
  values (r.order_id, 'cancel', 1, 1099, 99) returning id into o_refund;
  insert into public.order_refund_items (refund_id, item_id, units, gateway_amount) values (o_refund, it, 1, 1000);
  insert into public.order_refund_legs (refund_id, source, amount) values (o_refund, 'shipping_gateway', 99);
end $$;

-- ===================================================================
-- _online_bill_offset
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  f record;
  n int;
begin
  select * into f from pg_temp.mk_refund_after_bill(v);
  perform public._online_bill_offset(f.o_refund, 'cancel', true);
  select count(*) into n from public.exchanges where order_refund_id = f.o_refund;
  assert n = 2, 'one item row + one shipping row, got ' || n;
  perform public._online_bill_offset(f.o_refund, 'cancel', true);
  assert (select count(*) from public.exchanges where order_refund_id = f.o_refund) = n, 'second call adds nothing';
  assert (select count(*) from public.exchanges e join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
           where e.order_refund_id = f.o_refund and e.order_item_id is null and bi.product_name = 'Shipping'
             and e.credit_amount = 99 and e.new_billid = f.o_bill) = 1, 'shipping row on the Shipping line';
  assert (select exchange_id is not null from public.order_refund_items where refund_id = f.o_refund), 'exchange_id linked';
  assert (select e.credit_amount = 1000 and e.quantity = 1 and e.new_billid = f.o_bill
            from public.exchanges e where e.order_refund_id = f.o_refund and e.order_item_id is not null), 'item row';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  f record;
begin
  select * into f from pg_temp.mk_refund_after_bill(v);
  perform public._online_bill_offset(f.o_refund, 'RTO', false);
  assert (select count(*) from public.exchanges where order_refund_id = f.o_refund and order_item_id is null) = 0,
    'RTO writes no shipping offset row';
  assert (select count(*) from public.exchanges where order_refund_id = f.o_refund) = 1, 'item row only';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  insert into public.order_refunds (order_id, reason, units, total_amount) values (r.order_id, 'cancel', 1, 1000);
  perform public._online_bill_offset((select id from public.order_refunds where order_id = r.order_id), 'cancel', true);
  assert (select count(*) from public.exchanges where order_refund_id is not null) = 0, 'no bill → no-op';
end $$;
rollback;

select 'test_online_orders_rebook: all passed' as result;
