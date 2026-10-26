-- Tests for schema/migration_online_orders_rebook.sql (_online_bill_offset, op-key fencing, send_back/rebook claims and finalize).
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
  perform public.online_order_checkpoint(p_order, 'awb', jsonb_build_object('awb', 'AWB' || left(p_order::text, 8), 'courier_id', 7, 'courier_name', 'Test Courier'), 'op-pack');
  perform public.online_order_checkpoint(p_order, 'label', '{"label_url":"https://x/label.pdf"}', 'op-pack');
  return public.online_order_mark_packed(p_order, '{}'::jsonb, null, 'op-pack');
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

-- ===================================================================
-- Operation fencing and admin-op claims (Task 2)
-- ===================================================================

-- Pays a 1-unit order, marks it available and claims Process with p_key. Returns order id.
create function pg_temp.mk_claimed(p_key text) returns uuid language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 5), 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform public.online_order_claim(r.order_id, 'process', null, p_key);
  perform public.online_order_prepare_process(r.order_id, null);
  return r.order_id;
end $$;

-- grants on the re-defined functions: service role only
do $$
declare
  f text;
begin
  foreach f in array array['public.online_order_claim(uuid,text,uuid,text)',
    'public.online_order_checkpoint(uuid,text,jsonb,text)', 'public.online_order_mark_packed(uuid,jsonb,uuid,text)',
    'public.online_order_apply_tracking(text,text,jsonb)'] loop
    assert has_function_privilege('service_role', f, 'execute'), 'service runs ' || f;
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      'clients cannot run ' || f;
  end loop;
end $$;

-- old worker checkpoint after send_back claim → stale operation
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op-old');
  c jsonb;
  cp jsonb;
  ev jsonb;
begin
  update public.orders set sr_order_id = '111', sr_shipment_id = '222' where id = o;
  perform public.online_order_checkpoint(o, 'awb', '{"awb":"AWBOLD","courier_id":7,"courier_name":"T"}', 'op-old');
  update public.orders set op_lease_until = now() - interval '1 minute' where id = o;
  c := public.online_order_claim(o, 'send_back', null, 'op-sb');
  assert (c ->> 'claimed')::boolean and not (c ->> 'resumed')::boolean, 'send_back claimed: ' || c::text;
  assert c ->> 'op_action' = 'send_back' and c ->> 'status' = 'processing', 'status stays processing';
  assert (select op_key from public.orders where id = o) = 'op-sb', 'new key replaces old';
  begin
    perform public.online_order_checkpoint(o, 'label', '{"label_url":"https://x/l.pdf"}', 'op-old');
    assert false, 'old worker label refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  begin
    perform public.online_order_checkpoint(o, 'pickup', '{}');
    assert false, 'fenced step without key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  assert (select label_url is null and pickup_requested_at is null from public.orders where id = o), 'nothing written';
  c := public.online_order_claim(o, 'process', null, 'op-old');
  assert not (c ->> 'claimed')::boolean, 'old worker renewal refused';
  c := public.online_order_claim(o, 'send_back', null, 'op-sb');
  assert (c ->> 'claimed')::boolean and (c ->> 'resumed')::boolean, 'same key resumes send_back';
  -- sr_cancelled: fenced, idempotent per op, records the cancelled shipment
  begin
    perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-old');
    assert false, 'sr_cancelled with old key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  cp := public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-sb');
  assert not (cp ->> 'skipped')::boolean, 'sr_cancelled recorded';
  assert (select sr_cancelled_op_key from public.orders where id = o) = 'op-sb', 'sr_cancelled_op_key set';
  c := public.online_order_claim(o, 'send_back', null, 'op-sb');
  assert c #>> '{order,sr_cancelled_op_key}' = 'op-sb', 'claim result exposes sr_cancelled_op_key: ' || c::text;
  cp := public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-sb');
  assert (cp ->> 'skipped')::boolean, 'sr_cancelled idempotent';
  select data into ev from public.order_events where order_id = o and kind = 'checkpoint' and data ->> 'step' = 'sr_cancelled';
  assert ev #>> '{data,awb}' = 'AWBOLD' and ev #>> '{data,sr_order_id}' = '111' and ev #>> '{data,at}' is not null
     and ev ->> 'op_key' = 'op-sb', 'event: ' || ev::text;
end $$;
rollback;

-- sr_cancelled only while an admin op (send_back/rebook) holds the order
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op1');
begin
  begin
    perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op1');
    assert false, 'sr_cancelled refused for a process op';
  exception when raise_exception then null;
  end;
end $$;
rollback;

-- mark_packed with wrong key raises
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op1');
  bill int;
begin
  perform public.online_order_checkpoint(o, 'awb', '{"awb":"AWB1","courier_id":7,"courier_name":"T"}', 'op1');
  perform public.online_order_checkpoint(o, 'label', '{"label_url":"https://x/l.pdf"}', 'op1');
  begin
    perform public.online_order_mark_packed(o, '{}', null, 'op-x');
    assert false, 'wrong key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  assert (select status from public.orders where id = o) = 'processing', 'still processing';
  bill := public.online_order_mark_packed(o, '{}', null, 'op1');
  assert bill is not null and (select status from public.orders where id = o) = 'packed', 'right key packs';
  assert public.online_order_mark_packed(o, '{}', null, 'op1') = bill, 'repeat after packed returns bill';
end $$;
rollback;

-- send_back claim refused while lease live; only from processing
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op1');
  c jsonb;
  r record;
begin
  c := public.online_order_claim(o, 'send_back', null, 'op-sb');
  assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'busy', 'busy while lease live: ' || c::text;
  assert (select op_key = 'op1' and op_action = 'process' from public.orders where id = o), 'process op untouched';
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(500, 5), 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  c := public.online_order_claim(r.order_id, 'send_back', null, 'op-sb2');
  assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', 'send_back needs processing';
end $$;
rollback;

-- rebook claim from shipped keeps status; second admin busy; same key resumes
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  c jsonb;
  st text;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  c := public.online_order_claim(r.order_id, 'rebook', null, 'rb1');
  assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', 'rebook refused from paid';
  perform pg_temp.pack(r.order_id);
  perform public.online_order_apply_tracking((select awb from public.orders where id = r.order_id), 'shipped', '{"shipment_status_id":6}');
  c := public.online_order_claim(r.order_id, 'rebook', null, 'rb1');
  assert (c ->> 'claimed')::boolean and not (c ->> 'resumed')::boolean, 'rebook claimed: ' || c::text;
  select status into st from public.orders where id = r.order_id;
  assert st = 'shipped' and c ->> 'status' = 'shipped', 'status unchanged';
  assert (select op_key = 'rb1' and op_action = 'rebook' and op_lease_until > now() from public.orders where id = r.order_id), 'op set';
  c := public.online_order_claim(r.order_id, 'rebook', null, 'rb2');
  assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'busy', 'second admin busy';
  c := public.online_order_claim(r.order_id, 'rebook', null, 'rb1');
  assert (c ->> 'claimed')::boolean and (c ->> 'resumed')::boolean, 'same key resumes';
end $$;
rollback;

-- tracking delivered during rebook claim → held, status shipped
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
  awb text;
  res jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform pg_temp.pack(r.order_id);
  select o.awb into awb from public.orders o where o.id = r.order_id;
  perform public.online_order_apply_tracking(awb, 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_claim(r.order_id, 'rebook', null, 'rb1');
  res := public.online_order_apply_tracking(awb, 'delivered', '{"shipment_status_id":7,"shipment_status":"DELIVERED"}');
  assert (res ->> 'matched')::boolean and not (res ->> 'changed')::boolean and (res ->> 'held')::boolean, res::text;
  assert (select status = 'shipped' and tracking_status_id = 7 and tracking_label = 'DELIVERED'
            from public.orders where id = r.order_id), 'status held, raw tracking stored';
  assert (select count(*) from public.order_events where order_id = r.order_id and kind = 'tracking_held') = 1, 'held event';
  assert (select count(*) from public.order_jobs where order_id = r.order_id and kind = 'email_delivered') = 0, 'no delivered email';
end $$;
rollback;

-- R2: stale worker's 'error' / 'sr_create' can't touch the new op; keyless job sr_create is skipped
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op-old');
  v_lease timestamptz;
  cp jsonb;
begin
  update public.orders set sr_order_id = null, sr_shipment_id = null, op_lease_until = now() - interval '1 minute' where id = o;
  perform public.online_order_claim(o, 'send_back', null, 'op-sb');
  select op_lease_until into v_lease from public.orders where id = o;
  begin
    perform public.online_order_checkpoint(o, 'error', '{"error":"courier timeout"}', 'op-old');
    assert false, 'stale error checkpoint refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  assert (select process_error is null and op_lease_until = v_lease from public.orders where id = o),
    'lease and process_error untouched';
  begin
    perform public.online_order_checkpoint(o, 'sr_create', '{"sr_order_id":"9","sr_shipment_id":"8"}', 'op-old');
    assert false, 'stale sr_create refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  cp := public.online_order_checkpoint(o, 'sr_create', '{"sr_order_id":"9","sr_shipment_id":"8"}');
  assert (cp ->> 'skipped')::boolean, 'keyless job sr_create skipped during send_back';
  cp := public.online_order_checkpoint(o, 'sr_create_failed', '{"error":"x"}');
  assert (cp ->> 'skipped')::boolean, 'keyless job sr_create_failed skipped during send_back';
  assert (select sr_order_id is null and sr_shipment_id is null and sr_sync_status is distinct from 'failed'
            from public.orders where id = o), 'no ids written';
  -- the owning op's own error checkpoint still works
  perform public.online_order_checkpoint(o, 'error', '{"error":"own"}', 'op-sb');
  assert (select process_error = 'own' from public.orders where id = o), 'owner records error';
end $$;
rollback;

-- R2/4: a keyless call never passes a fenced step, even when the order has no op key
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform public.online_order_claim(r.order_id, 'process', null, 'op1');
  perform public.online_order_prepare_process(r.order_id, null);
  perform public.online_order_checkpoint(r.order_id, 'awb', '{"awb":"AWBN"}', 'op1');
  perform public.online_order_checkpoint(r.order_id, 'label', '{"label_url":"https://x/l.pdf"}', 'op1');
  update public.orders set op_key = null, op_action = null where id = r.order_id;  -- invalid state on purpose
  begin
    perform public.online_order_checkpoint(r.order_id, 'pickup', '{}');
    assert false, 'keyless fenced step refused on null op_key';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  begin
    perform public.online_order_mark_packed(r.order_id, '{}', null, null);
    assert false, 'keyless mark_packed refused on null op_key';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  update public.orders set op_key = 'op1' where id = r.order_id;  -- key matches, op_action still null
  begin
    perform public.online_order_mark_packed(r.order_id, '{}', null, 'op1');
    assert false, 'mark_packed refused with null op_action';
  exception when raise_exception then
    assert sqlerrm like '%claimed for processing%', sqlerrm;
  end;
end $$;
rollback;

-- ---------- send back finalize ----------
-- Pays a 2-unit order, shelf check finds 1, Process claimed + prepared (1 unit refunded),
-- Shiprocket ids/awb set, lease expired, send_back claimed with key 'op-sb'. Returns order id.
create function pg_temp.mk_send_back(p_ids boolean default true) returns uuid language plpgsql as $$
declare
  r record;
  v uuid := pg_temp.mk_variant(1000, 5);
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 2)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, 1, null) from public.order_items i where i.order_id = r.order_id;
  perform public.online_order_claim(r.order_id, 'process', null, 'op-old');
  perform public.online_order_prepare_process(r.order_id, null);
  if p_ids then
    update public.orders set sr_order_id = '111', sr_shipment_id = '222', sr_sync_status = 'ok' where id = r.order_id;
    perform public.online_order_checkpoint(r.order_id, 'awb', '{"awb":"AWBOLD","courier_id":7,"courier_name":"T"}', 'op-old');
    perform public.online_order_checkpoint(r.order_id, 'pickup', '{}', 'op-old');
    update public.orders set manifest_url = 'https://x/m.pdf', label_url = 'https://x/l.pdf', sr_updated_at = now(),
           problem = 'Courier cancelled shipment — rebook or cancel' where id = r.order_id;
  end if;
  update public.orders set op_lease_until = now() - interval '1 minute' where id = r.order_id;
  perform public.online_order_claim(r.order_id, 'send_back', null, 'op-sb');
  return r.order_id;
end $$;

begin;
do $$
declare
  o uuid := pg_temp.mk_send_back();
begin
  begin
    perform public.online_order_send_back(o, null, 'op-sb');
    assert false, 'finalize refused without sr_cancelled';
  exception when raise_exception then
    assert sqlerrm like '%courier booking not cancelled yet%', sqlerrm;
  end;
  begin
    perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-sb');
    perform public.online_order_send_back(o, null, 'op-old');
    assert false, 'old key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  assert (select status from public.orders where id = o) = 'processing', 'unchanged after refusals';
end $$;
rollback;

-- finalize needs the op to be send_back, not a plain process claim
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op-p');
begin
  begin
    perform public.online_order_send_back(o, null, 'op-p');
    assert false, 'process op cannot finalize send_back';
  exception when raise_exception then
    assert sqlerrm like '%send_back%', sqlerrm;
  end;
end $$;
rollback;

-- finalize clears shipment, keeps refund, sr_attempt 2
begin;
do $$
declare
  o uuid := pg_temp.mk_send_back();
  r jsonb;
  oo public.orders;
  it public.order_items;
  ev jsonb;
begin
  perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-sb');
  r := public.online_order_send_back(o, null, 'op-sb');
  assert r ->> 'status' = 'paid' and r ->> 'old_sr_order_id' = '111' and r ->> 'old_awb' = 'AWBOLD', r::text;
  select * into oo from public.orders where id = o;
  assert oo.status = 'paid' and oo.sr_attempt = 2, 'paid, attempt 2';
  assert oo.sr_order_id is null and oo.sr_shipment_id is null and oo.sr_updated_at is null and oo.sr_sync_status is null
     and oo.sr_last_error is null and oo.awb is null and oo.courier_id is null and oo.courier_name is null
     and oo.pickup_requested_at is null and oo.manifest_url is null and oo.label_url is null
     and oo.process_plan is null and oo.process_error is null and oo.problem is null, 'shipment cleared';
  assert oo.op_key is null and oo.op_action is null and oo.op_actor is null and oo.op_lease_until is null
     and oo.sr_cancelled_op_key is null and oo.manual_cancel_confirmed_by is null, 'op fields cleared';
  select * into it from public.order_items where order_id = o;
  assert it.refunded_qty = 1 and it.stock_taken = 1 and it.available_qty is null and it.shipped_qty = 0
     and it.status = 'ordered', 'item: ' || row_to_json(it)::text;
  assert (select count(*) from public.order_refunds where order_id = o and reason = 'unavailable') = 1, 'refund kept';
  select data into ev from public.order_events where order_id = o and kind = 'sent_back';
  assert ev ->> 'old_awb' = 'AWBOLD' and ev ->> 'old_sr_order_id' = '111' and ev ->> 'old_sr_shipment_id' = '222', 'event: ' || coalesce(ev::text, 'none');
  -- idempotent once paid with no op
  r := public.online_order_send_back(o, null, 'op-sb');
  assert r ->> 'status' = 'paid' and r ->> 'old_sr_order_id' = '111' and r ->> 'old_awb' = 'AWBOLD'
     and (select sr_attempt from public.orders where id = o) = 2, 'idempotent repeat returns original ids: ' || r::text;
  begin
    perform public.online_order_send_back(o, null, 'op-unknown');
    assert false, 'unknown key on a paid order refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  begin
    perform public.online_order_send_back(o, null, null);
    assert false, 'null key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
end $$;
rollback;

-- no Shiprocket ids at all: no cancel evidence needed
begin;
do $$
declare
  o uuid := pg_temp.mk_send_back(false);
  r jsonb;
begin
  r := public.online_order_send_back(o, null, 'op-sb');
  assert r ->> 'status' = 'paid' and r ->> 'old_awb' is null, r::text;
end $$;
rollback;

-- sr_order_id alone (no awb) still needs evidence
begin;
do $$
declare
  o uuid := pg_temp.mk_send_back(false);
begin
  update public.orders set sr_order_id = '999' where id = o;
  begin
    perform public.online_order_send_back(o, null, 'op-sb');
    assert false, 'sr_order_id alone needs evidence';
  exception when raise_exception then
    assert sqlerrm like '%not cancelled yet%', sqlerrm;
  end;
end $$;
rollback;

-- manual cancel confirmation (superadmin path, enforced by the edge function)
begin;
do $$
declare
  o uuid := pg_temp.mk_send_back();
  a uuid := gen_random_uuid();
  ev jsonb;
  r jsonb;
begin
  begin
    perform public.online_order_confirm_manual_cancel(o, a, 'op-old');
    assert false, 'old key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  perform public.online_order_confirm_manual_cancel(o, a, 'op-sb');
  assert (select manual_cancel_confirmed_by from public.orders where id = o) = a, 'confirmed by recorded';
  select data into ev from public.order_events where order_id = o and kind = 'manual_cancel_confirmed';
  assert ev ->> 'awb' = 'AWBOLD' and ev ->> 'sr_order_id' = '111', 'event: ' || coalesce(ev::text, 'none');
  r := public.online_order_send_back(o, a, 'op-sb');
  assert r ->> 'status' = 'paid', 'finalizes on manual confirmation';
  assert (select manual_cancel_confirmed_by is null from public.orders where id = o), 'confirmation cleared';
end $$;
rollback;

-- manual confirmation only while a send_back / rebook op holds the order
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op-p');
begin
  begin
    perform public.online_order_confirm_manual_cancel(o, gen_random_uuid(), 'op-p');
    assert false, 'process op refused';
  exception when raise_exception then
    assert sqlerrm like '%send_back%', sqlerrm;
  end;
end $$;
rollback;

-- send back then cancel: only the held unit goes back to stock
begin;
do $$
declare
  o uuid := pg_temp.mk_send_back();
  v uuid;
  s0 numeric;
begin
  select variantid into v from public.order_items where order_id = o;
  perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-sb');
  perform public.online_order_send_back(o, null, 'op-sb');
  s0 := pg_temp.stock(v);
  perform public.online_order_cancel(o, null, 'customer asked');
  assert pg_temp.stock(v) = s0 + 1, 'one unit back, got ' || (pg_temp.stock(v) - s0)::text;
  assert (select status from public.orders where id = o) = 'cancelled', 'cancelled';
end $$;
rollback;

-- send back then second check: refunds only newly missing; all missing -> cancelled with shipping
begin;
do $$
declare
  o uuid := pg_temp.mk_send_back();
  p jsonb;
  tot numeric;
begin
  perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-sb');
  perform public.online_order_send_back(o, null, 'op-sb');
  perform public.online_order_set_availability(o, i.id, 0, null) from public.order_items i where i.order_id = o;
  perform public.online_order_claim(o, 'process', null, 'op-new');
  p := public.online_order_prepare_process(o, null);
  assert (p ->> 'all_unavailable')::boolean, 'all missing: ' || p::text;
  assert (select status from public.orders where id = o) = 'cancelled', 'cancelled';
  assert (select refunded_qty from public.order_items where order_id = o) = 2, 'both units refunded, once each';
  assert (select count(*) from public.order_refunds where order_id = o and reason = 'unavailable') = 2, 'two unavailable refunds';
  assert (select sum(shipping_amount) from public.order_refunds where order_id = o) = (select shipping from public.orders where id = o)
     and (select count(*) from public.order_refunds where order_id = o and shipping_amount > 0) = 1,
     'shipping refunded once, with the last refund';
  select sum(total_amount) into tot from public.order_refunds where order_id = o;
  assert tot = (select subtotal - promo_discount + shipping from public.orders where id = o), 'refunds total the order: ' || tot::text;
end $$;
rollback;

-- ---------- rebook finalize (Task 4) ----------
-- Pays a p_qty-unit order (shipping 99) from a variant with p_stock, packs all units, marks
-- it shipped, claims rebook 'op-rb' and records sr_cancelled. Returns order id.
create function pg_temp.mk_rebook(p_stock numeric default 5, p_qty int default 2, p_cancelled boolean default true)
returns uuid language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, p_stock), 'qty', p_qty)),
                                         jsonb_build_object('shipping', 99));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform pg_temp.pack(r.order_id);
  update public.orders set sr_order_id = '777', sr_shipment_id = '778' where id = r.order_id;
  perform public.online_order_apply_tracking((select awb from public.orders where id = r.order_id), 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_claim(r.order_id, 'rebook', null, 'op-rb');
  if p_cancelled then
    perform public.online_order_checkpoint(r.order_id, 'sr_cancelled', '{}', 'op-rb');
  end if;
  return r.order_id;
end $$;

-- grants: service role only
do $$
begin
  assert has_function_privilege('service_role', 'public.online_order_rebook(uuid,uuid,text,boolean,text)', 'execute'), 'service runs rebook';
  assert not has_function_privilege('anon', 'public.online_order_rebook(uuid,uuid,text,boolean,text)', 'execute')
     and not has_function_privilege('authenticated', 'public.online_order_rebook(uuid,uuid,text,boolean,text)', 'execute'),
     'clients cannot run rebook';
end $$;

-- rebook still at shop: paid, stock unchanged, one bill after re-pack
begin;
do $$
declare
  o uuid;
  oo public.orders;
  it public.order_items;
  v uuid;
  s0 numeric;
  b0 int;
  res jsonb;
  ev jsonb;
begin
  o := pg_temp.mk_rebook(5, 2, false);
  select variantid into v from public.order_items where order_id = o;
  s0 := pg_temp.stock(v);
  select bill_id, awb into oo.bill_id, oo.awb from public.orders where id = o;
  b0 := oo.bill_id;
  begin
    perform public.online_order_rebook(o, null, 'op-rb', false, 'box back from courier');
    assert false, 'needs cancel evidence';
  exception when raise_exception then
    assert sqlerrm like '%courier booking not cancelled yet%', sqlerrm;
  end;
  perform public.online_order_checkpoint(o, 'sr_cancelled', '{}', 'op-rb');
  begin
    perform public.online_order_rebook(o, null, 'op-other', false, 'box back from courier');
    assert false, 'stale key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  res := public.online_order_rebook(o, null, 'op-rb', false, 'box back from courier');
  assert res ->> 'status' = 'paid' and res ->> 'refund_id' is null and res ->> 'old_sr_order_id' = '777'
     and res ->> 'old_awb' = oo.awb, res::text;
  select * into oo from public.orders where id = o;
  assert oo.status = 'paid' and oo.sr_attempt = 2 and oo.bill_id = b0, 'paid, attempt 2, bill kept';
  assert oo.awb is null and oo.sr_order_id is null and oo.sr_shipment_id is null and oo.label_url is null
     and oo.problem is null and oo.op_key is null and oo.op_action is null and oo.sr_cancelled_op_key is null,
     'shipment and op cleared';
  select * into it from public.order_items where order_id = o;
  assert it.stock_taken = 2 and it.available_qty is null and it.shipped_qty = 0 and it.lost_qty = 0
     and it.refunded_qty = 0 and it.status = 'ordered', 'item: ' || row_to_json(it)::text;
  assert pg_temp.stock(v) = s0, 'stock unchanged';
  select data into ev from public.order_events where order_id = o and kind = 'rebooked';
  assert ev ->> 'op_key' = 'op-rb' and not (ev ->> 'parcel_lost')::boolean and ev ->> 'note' = 'box back from courier'
     and ev ->> 'old_awb' = res ->> 'old_awb' and ev ->> 'old_sr_order_id' = '777' and ev ? 'refund_id',
     'event: ' || coalesce(ev::text, 'none');
  -- idempotent repeat for the finalizing key only
  res := public.online_order_rebook(o, null, 'op-rb', false, 'box back from courier');
  assert res ->> 'status' = 'paid' and res ->> 'old_sr_order_id' = '777'
     and (select sr_attempt from public.orders where id = o) = 2, 'repeat: ' || res::text;
  begin
    perform public.online_order_rebook(o, null, 'op-unknown', false, 'x');
    assert false, 'unknown key refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  -- re-pack: same bill, still one bill for the order
  perform public.online_order_set_availability(o, i.id, 2, null) from public.order_items i where i.order_id = o;
  assert pg_temp.pack(o) = b0, 're-pack keeps the bill';
  assert (select count(*) from public.bills where notes = 'Online order ' || (select order_ref from public.orders where id = o)) = 1, 'one bill';
  assert (select status from public.orders where id = o) = 'packed', 'packed again';
  assert pg_temp.stock(v) = s0, 'stock still unchanged';
end $$;
rollback;

-- rebook lost with stock: replacement taken, lost_qty
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(5, 2);
  v uuid;
  s0 numeric;
  it public.order_items;
  res jsonb;
begin
  select variantid into v from public.order_items where order_id = o;
  s0 := pg_temp.stock(v);
  res := public.online_order_rebook(o, null, 'op-rb', true, 'parcel lost in transit');
  assert res ->> 'status' = 'paid' and res ->> 'refund_id' is null, res::text;
  assert pg_temp.stock(v) = s0 - 2, 'two replacements taken, stock ' || pg_temp.stock(v)::text;
  select * into it from public.order_items where order_id = o;
  assert it.lost_qty = 2 and it.stock_taken = 2 and it.refunded_qty = 0 and it.shipped_qty = 0
     and it.available_qty is null, 'item: ' || row_to_json(it)::text;
  assert (select count(*) from public.order_refunds where order_id = o) = 0, 'no refund';
  assert (select (data ->> 'parcel_lost')::boolean from public.order_events where order_id = o and kind = 'rebooked'), 'event parcel_lost';
end $$;
rollback;

-- rebook lost with partial stock: one replaced, one refunded, no shipping refund
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(3, 2);
  v uuid;
  res jsonb;
  it public.order_items;
begin
  select variantid into v from public.order_items where order_id = o;
  assert pg_temp.stock(v) = 1, 'one left on the shelf';
  res := public.online_order_rebook(o, null, 'op-rb', true, 'lost');
  assert res ->> 'status' = 'paid' and res ->> 'refund_id' is not null, res::text;
  assert pg_temp.stock(v) = 0, 'last unit taken';
  select * into it from public.order_items where order_id = o;
  assert it.lost_qty = 2 and it.stock_taken = 1 and it.refunded_qty = 1, 'item: ' || row_to_json(it)::text;
  assert (select units = 1 and shipping_amount = 0 and reason = 'unavailable' from public.order_refunds
           where id = (res ->> 'refund_id')::uuid), 'one unit, no shipping';
  assert (select count(*) from public.exchanges where order_refund_id = (res ->> 'refund_id')::uuid and order_item_id is not null
            and reason = 'Rebook: not re-sent') = 1
     and (select count(*) from public.exchanges where order_refund_id = (res ->> 'refund_id')::uuid and order_item_id is null) = 0,
     'item offset only';
end $$;
rollback;

-- rebook lost without stock: cancelled, refund incl shipping, item + shipping offsets
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(2, 2);
  v uuid;
  res jsonb;
  rf public.order_refunds;
  oo public.orders;
  it public.order_items;
begin
  select variantid into v from public.order_items where order_id = o;
  assert pg_temp.stock(v) = 0, 'shelf empty';
  res := public.online_order_rebook(o, null, 'op-rb', true, 'lost');
  assert res ->> 'status' = 'cancelled' and res ->> 'refund_id' is not null, res::text;
  select * into oo from public.orders where id = o;
  assert oo.status = 'cancelled' and oo.op_action is null and oo.awb is null, 'cancelled and cleared';
  assert pg_temp.stock(v) = 0, 'stock untouched';
  select * into rf from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert rf.reason = 'unavailable' and rf.units = 2 and rf.shipping_amount = 99
     and rf.total_amount = oo.subtotal - oo.promo_discount + oo.shipping, 'full refund: ' || row_to_json(rf)::text;
  select * into it from public.order_items where order_id = o;
  assert it.lost_qty = 2 and it.stock_taken = 0 and it.refunded_qty = 2 and it.status = 'refunded', 'item: ' || row_to_json(it)::text;
  assert (select count(*) from public.exchanges where order_refund_id = rf.id and order_item_id is not null
            and reason = 'Rebook: not re-sent' and new_billid = oo.bill_id) = 1, 'item offset';
  assert (select credit_amount from public.exchanges where order_refund_id = rf.id and order_item_id is null) = 99, 'shipping offset';
  assert (select count(*) from public.order_events where order_id = o and kind = 'rebooked'
            and from_status = 'shipped' and to_status = 'cancelled') = 1, 'rebooked event to cancelled';
end $$;
rollback;

-- cancel after lost rebook: stock back = replacement only, bill offset incl shipping
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(5, 2);
  v uuid;
  s0 numeric;
  rf uuid;
  b int;
begin
  select variantid into v from public.order_items where order_id = o;
  s0 := pg_temp.stock(v);
  perform public.online_order_rebook(o, null, 'op-rb', true, 'lost');
  assert pg_temp.stock(v) = s0 - 2, 'replacements taken';
  rf := public.online_order_cancel(o, null, 'customer gave up');
  assert pg_temp.stock(v) = s0, 'replacements back, lost units not';
  select bill_id into b from public.orders where id = o;
  assert (select count(*) from public.exchanges where order_refund_id = rf and order_item_id is not null
            and reason = 'Cancel after rebook' and quantity = 2 and new_billid = b) = 1, 'item offset';
  assert (select credit_amount from public.exchanges where order_refund_id = rf and order_item_id is null) = 99, 'shipping offset';
  assert (select shipping_amount from public.order_refunds where id = rf) = 99, 'shipping refunded';
end $$;
rollback;

-- cancel of a paid order without a bill: no offsets (unchanged behaviour)
begin;
do $$
declare
  r record;
  rf uuid;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 5), 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  rf := public.online_order_cancel(r.order_id, null, 'changed mind');
  assert rf is not null and (select count(*) from public.exchanges where order_refund_id = rf) = 0, 'no bill, no offset';
end $$;
rollback;

-- second shelf check after rebook: offset item, no shipping
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(5, 2);
  p jsonb;
  rf uuid;
begin
  perform public.online_order_rebook(o, null, 'op-rb', false, 'at shop');
  perform public.online_order_set_availability(o, i.id, 1, null) from public.order_items i where i.order_id = o;
  perform public.online_order_claim(o, 'process', null, 'op-p2');
  p := public.online_order_prepare_process(o, null);
  rf := (p ->> 'refund_id')::uuid;
  assert rf is not null and not (p ->> 'all_unavailable')::boolean, p::text;
  assert (select count(*) from public.exchanges where order_refund_id = rf and order_item_id is not null
            and reason = 'Rebook: unavailable' and quantity = 1) = 1, 'item offset';
  assert (select count(*) from public.exchanges where order_refund_id = rf and order_item_id is null) = 0, 'no shipping offset';
end $$;
rollback;

-- second shelf check after rebook finds nothing: cancelled, item + shipping offsets
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(5, 2);
  p jsonb;
  rf uuid;
begin
  perform public.online_order_rebook(o, null, 'op-rb', false, 'at shop');
  perform public.online_order_set_availability(o, i.id, 0, null) from public.order_items i where i.order_id = o;
  perform public.online_order_claim(o, 'process', null, 'op-p2');
  p := public.online_order_prepare_process(o, null);
  rf := (p ->> 'refund_id')::uuid;
  assert (p ->> 'all_unavailable')::boolean, p::text;
  assert (select count(*) from public.exchanges where order_refund_id = rf and order_item_id is not null) = 1, 'item offset';
  assert (select credit_amount from public.exchanges where order_refund_id = rf and order_item_id is null) = 99, 'shipping offset';
end $$;
rollback;

-- old AWB ignored after rebook
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(5, 1);
  awb text;
  res jsonb;
begin
  select o2.awb into awb from public.orders o2 where o2.id = o;
  perform public.online_order_rebook(o, null, 'op-rb', false, 'at shop');
  res := public.online_order_apply_tracking(awb, 'delivered', '{"shipment_status_id":7}');
  assert not (res ->> 'matched')::boolean, res::text;
  assert (select status from public.orders where id = o) = 'paid', 'still paid';
end $$;
rollback;

-- rebook from delivered raises
begin;
do $$
declare
  r record;
  c jsonb;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 5), 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform pg_temp.pack(r.order_id);
  perform public.online_order_apply_tracking((select awb from public.orders where id = r.order_id), 'delivered', '{"shipment_status_id":7}');
  c := public.online_order_claim(r.order_id, 'rebook', null, 'op-rb');
  assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', c::text;
  begin
    perform public.online_order_rebook(r.order_id, null, 'op-rb', false, 'too late');
    assert false, 'rebook of delivered refused';
  exception when raise_exception then
    assert sqlerrm like '%stale operation%', sqlerrm;
  end;
  assert (select status from public.orders where id = r.order_id) = 'delivered', 'still delivered';
end $$;
rollback;

-- finalize needs a rebook op (process op with the same key refused)
begin;
do $$
declare
  o uuid := pg_temp.mk_claimed('op-p');
begin
  begin
    perform public.online_order_rebook(o, null, 'op-p', false, 'x');
    assert false, 'process op cannot finalize rebook';
  exception when raise_exception then
    assert sqlerrm like '%no rebook in progress%', sqlerrm;
  end;
end $$;
rollback;

-- blank note raises
begin;
do $$
declare
  o uuid := pg_temp.mk_rebook(5, 1);
begin
  begin
    perform public.online_order_rebook(o, null, 'op-rb', false, '   ');
    assert false, 'blank note refused';
  exception when raise_exception then
    assert sqlerrm like '%rebook: note required%', sqlerrm;
  end;
  begin
    perform public.online_order_rebook(o, null, 'op-rb', false, null);
    assert false, 'null note refused';
  exception when raise_exception then
    assert sqlerrm like '%rebook: note required%', sqlerrm;
  end;
  assert (select status from public.orders where id = o) = 'shipped', 'unchanged';
end $$;
rollback;

select 'test_online_orders_rebook: all passed' as result;
