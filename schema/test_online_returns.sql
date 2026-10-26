-- Tests for schema/migration_online_returns.sql (delivered_at, mark delivered, return open/cancel).
-- Each test is `begin; do $$ ... assert ... $$; rollback;` seeded via the pg_temp helpers below.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/test_online_returns.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

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

-- shipped order helper: returns order id and awb
create function pg_temp.shipped_order(out o_id uuid, out o_awb text) language plpgsql as $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform pg_temp.pack(r.order_id);
  o_id := r.order_id;
  select o.awb into o_awb from public.orders o where o.id = r.order_id;
  perform public.online_order_apply_tracking(o_awb, 'shipped', '{"shipment_status_id":6}');
  -- now() is frozen per transaction, so backdate payment to leave room for past delivery dates
  update public.orders set paid_at = now() - interval '20 days' where id = o_id;
end $$;

-- ===================================================================
-- tracking delivered sets delivered_at once
-- ===================================================================
begin;
do $$
declare
  s record := pg_temp.shipped_order();
  d1 timestamptz;
begin
  assert (select delivered_at from public.orders where id = s.o_id) is null, 'null before delivery';
  perform public.online_order_apply_tracking(s.o_awb, 'delivered', '{"shipment_status_id":7}');
  d1 := (select delivered_at from public.orders where id = s.o_id);
  assert d1 is not null and abs(extract(epoch from now() - d1)) < 5, 'delivered_at = now() when payload has no date';
  perform public.online_order_apply_tracking(s.o_awb, 'delivered', '{"shipment_status_id":7,"delivered_date":"2020-01-01 10:00:00"}');
  assert (select delivered_at from public.orders where id = s.o_id) = d1, 'second delivered update keeps the first value';
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  perform public.online_order_apply_tracking(s.o_awb, 'delivered', '{"shipment_status_id":7,"delivered_date":"2026-03-04 15:30:00+05:30"}');
  assert (select delivered_at from public.orders where id = s.o_id) = '2026-03-04 15:30:00+05:30'::timestamptz,
    'payload delivered_date used when parseable';
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  perform public.online_order_apply_tracking(s.o_awb, 'delivered', '{"shipment_status_id":7,"delivered_date":"not a date"}');
  assert (select status = 'delivered' and abs(extract(epoch from now() - delivered_at)) < 5
            from public.orders where id = s.o_id), 'unparseable delivered_date falls back to now()';
end $$;
rollback;

-- ===================================================================
-- mark delivered
-- ===================================================================
begin;
do $$
declare
  s record := pg_temp.shipped_order();
  res jsonb;
  t timestamptz := now() - interval '1 hour';
begin
  res := public.online_order_mark_delivered(s.o_id, null, t, 'Courier confirmed by phone');
  assert (res ->> 'changed')::boolean, res::text;
  assert (select status = 'delivered' and delivered_at = t from public.orders where id = s.o_id), 'status and delivered_at set';
  assert exists (select 1 from public.order_events where order_id = s.o_id and kind = 'delivered'
                   and data ->> 'manual' = 'true' and data ->> 'reason' = 'Courier confirmed by phone'), 'manual event with reason';
  assert exists (select 1 from public.order_jobs where order_id = s.o_id and kind = 'email_delivered'), 'delivered email job';
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
  r2 record;
  v uuid := pg_temp.mk_variant(1000, 5);
begin
  select * into r2 from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"phone":"+919800000002"}');
  perform pg_temp.pay(r2.order_ref);
  perform public.online_order_set_availability(r2.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r2.order_id;
  perform pg_temp.pack(r2.order_id);
  begin
    perform public.online_order_mark_delivered(r2.order_id, null, now(), 'r');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%shipped%', 'packed raises: ' || sqlerrm;
  end;
  assert (select status from public.orders where id = r2.order_id) = 'packed', 'packed unchanged';
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  begin
    perform public.online_order_mark_delivered(s.o_id, null, now() + interval '1 hour', 'r');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%future%', 'future date raises: ' || sqlerrm;
  end;
  assert (select status from public.orders where id = s.o_id) = 'shipped', 'unchanged';
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  -- paid long ago so only the 30-day rule can fire
  update public.orders set paid_at = now() - interval '90 days' where id = s.o_id;
  begin
    perform public.online_order_mark_delivered(s.o_id, null, now() - interval '31 days', 'r');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%30 days%', '31 days back raises: ' || sqlerrm;
  end;
  perform public.online_order_mark_delivered(s.o_id, null, now() - interval '29 days', 'r');
  assert (select status from public.orders where id = s.o_id) = 'delivered', '29 days back allowed';
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  begin
    perform public.online_order_mark_delivered(s.o_id, null, now() - interval '25 days', 'r');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%before the order was paid%', 'before paid_at raises: ' || sqlerrm;
  end;
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  begin
    perform public.online_order_mark_delivered(s.o_id, null, now(), '   ');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%reason%', 'blank reason raises: ' || sqlerrm;
  end;
  begin
    perform public.online_order_mark_delivered(s.o_id, null, now(), null);
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%reason%', 'null reason raises: ' || sqlerrm;
  end;
end $$;
rollback;

begin;
do $$
declare
  s record := pg_temp.shipped_order();
begin
  perform public.online_order_apply_tracking(s.o_awb, 'delivered', '{"shipment_status_id":7}');
  begin
    perform public.online_order_mark_delivered(s.o_id, null, now(), 'r');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%shipped%' or sqlerrm like '%already%', 'already delivered raises: ' || sqlerrm;
  end;
end $$;
rollback;

-- ===================================================================
-- backfill
-- ===================================================================
begin;
do $$
declare
  s record := pg_temp.shipped_order();
  t timestamptz := now() - interval '3 days';
begin
  insert into public.order_events (order_id, kind, to_status, created_at) values
    (s.o_id, 'delivered', 'delivered', t), (s.o_id, 'delivered', 'delivered', t + interval '1 day');
  assert (select delivered_at from public.orders where id = s.o_id) is null, 'precondition';
  update public.orders o set delivered_at = e.first_at
    from (select order_id, min(created_at) as first_at from public.order_events where kind = 'delivered' group by order_id) e
   where e.order_id = o.id and o.delivered_at is null;
  assert (select delivered_at from public.orders where id = s.o_id) = t, 'backfilled from earliest delivered event';
end $$;
rollback;

-- ===================================================================
-- privileges
-- ===================================================================
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.online_order_mark_delivered(uuid,uuid,timestamptz,text)', 'execute'), 'anon';
  assert not has_function_privilege('authenticated', 'public.online_order_mark_delivered(uuid,uuid,timestamptz,text)', 'execute'), 'authenticated';
  assert has_function_privilege('service_role', 'public.online_order_mark_delivered(uuid,uuid,timestamptz,text)', 'execute'), 'service_role';
end $$;
rollback;

-- ===================================================================
-- Task 2: returnable units, open / cancel
-- ===================================================================
-- Delivered order with one line of p_qty units, delivered p_ago in the past.
create function pg_temp.delivered_order(p_qty int default 3, p_ago interval default interval '3 days',
                                        out o_id uuid, out i_id uuid) language plpgsql as $$
declare
  v uuid := pg_temp.mk_variant(1000, 10);
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', p_qty)));
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform pg_temp.pack(r.order_id);
  o_id := r.order_id;
  update public.orders set paid_at = now() - interval '20 days' where id = o_id;
  perform public.online_order_apply_tracking((select awb from public.orders where id = o_id), 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_mark_delivered(o_id, null, now() - p_ago, 'test');
  select id into i_id from public.order_items where order_id = o_id;
end $$;

create function pg_temp.returnable(p_order uuid) returns int language sql as $$
  select coalesce(sum(units), 0)::int from public.online_return_returnable(p_order)
$$;

create function pg_temp.open_ret(p_order uuid, p_item uuid, p_units int, p_reason text default 'change_of_mind',
                                 p_contacted timestamptz default now()) returns uuid language sql as $$
  select public.online_return_open(p_order, null, false, p_reason, p_contacted,
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'units', p_units)), 'customer called', null, null)
$$;

begin;
do $$
declare s record := pg_temp.delivered_order(3);
begin
  assert pg_temp.returnable(s.o_id) = 3, 'returnable = shipped: ' || pg_temp.returnable(s.o_id);
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3); rid uuid;
begin
  rid := pg_temp.open_ret(s.o_id, s.i_id, 2);
  assert pg_temp.returnable(s.o_id) = 1, 'minus open return';
  assert (select status from public.order_returns where id = rid) = 'open';
  assert exists (select 1 from public.order_events where order_id = s.o_id and kind = 'return_opened'
                   and data ->> 'return_id' = rid::text), 'return_opened event';
  assert (select status from public.orders where id = s.o_id) = 'delivered', 'order stays delivered';
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3); rid uuid;
begin
  -- refunded return: received units are gone, rejected-by-warehouse units are not
  rid := pg_temp.open_ret(s.o_id, s.i_id, 2);
  update public.order_returns set status = 'refunded' where id = rid;
  update public.order_return_items set received_units = 1, restock_units = 1 where return_id = rid;
  assert pg_temp.returnable(s.o_id) = 2, 'refunded return subtracts received units only: ' || pg_temp.returnable(s.o_id);
  -- rejected / cancelled returns free their units
  update public.order_returns set status = 'rejected' where id = rid;
  assert pg_temp.returnable(s.o_id) = 3, 'rejected frees units';
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3); b int;
begin
  select bill_item_id into b from public.order_items where id = s.i_id;
  assert b is not null, 'bill item linked';
  insert into public.exchanges (original_bill_item_id, quantity, reason) values (b, 1, 'In-store exchange');
  assert pg_temp.returnable(s.o_id) = 2, 'minus in-store exchange: ' || pg_temp.returnable(s.o_id);
  -- exchange written by an online refund does not count
  insert into public.order_refunds (order_id, reason) values (s.o_id, 'cancel');
  insert into public.exchanges (original_bill_item_id, quantity, reason, order_refund_id)
    values (b, 1, 'Online', (select id from public.order_refunds where order_id = s.o_id));
  assert pg_temp.returnable(s.o_id) = 2, 'online refund exchange excluded';
  -- never below zero
  insert into public.exchanges (original_bill_item_id, quantity, reason) values (b, 5, 'In-store exchange');
  assert pg_temp.returnable(s.o_id) = 0, 'floored at 0';
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3, interval '3 days'); rid uuid;
begin
  -- opened late, but contacted 40h after delivery: inside the 48h window
  rid := pg_temp.open_ret(s.o_id, s.i_id, 1, 'damaged_wrong',
    (select delivered_at + interval '40 hours' from public.orders where id = s.o_id));
  assert (select override_reason from public.order_returns where id = rid) is null, 'no override recorded';
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3, interval '6 days');
begin
  begin
    perform pg_temp.open_ret(s.o_id, s.i_id, 1, 'damaged_wrong',
      (select delivered_at + interval '49 hours' from public.orders where id = s.o_id));
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like 'return window closed%', 'admin outside window: ' || sqlerrm;
  end;
  -- admin with an override reason is still refused
  begin
    perform public.online_return_open(s.o_id, null, false, 'damaged_wrong', now(),
      jsonb_build_array(jsonb_build_object('item_id', s.i_id, 'units', 1)), 'n', null, 'owner approved');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like 'return window closed%', 'non-superadmin override refused: ' || sqlerrm;
  end;
  -- change_of_mind: 7 days; 6 days after delivery is fine
  perform pg_temp.open_ret(s.o_id, s.i_id, 1, 'change_of_mind', now());
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3, interval '10 days'); rid uuid;
begin
  begin
    perform public.online_return_open(s.o_id, null, true, 'change_of_mind', now(),
      jsonb_build_array(jsonb_build_object('item_id', s.i_id, 'units', 1)), 'n', null, '  ');
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like 'return window closed%', 'blank override refused: ' || sqlerrm;
  end;
  rid := public.online_return_open(s.o_id, null, true, 'change_of_mind', now(),
    jsonb_build_array(jsonb_build_object('item_id', s.i_id, 'units', 1)), 'n', null, 'owner approved');
  assert (select override_reason from public.order_returns where id = rid) = 'owner approved', 'override recorded';
  assert (select data ->> 'override_reason' from public.order_events where kind = 'return_opened' and order_id = s.o_id) = 'owner approved';
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3);
begin
  begin
    perform pg_temp.open_ret(s.o_id, s.i_id, 4);
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%returnable%', 'above returnable: ' || sqlerrm;
  end;
  assert not exists (select 1 from public.order_returns where order_id = s.o_id), 'nothing persisted by the failed open? (subtransaction rolled back)';
  perform pg_temp.open_ret(s.o_id, s.i_id, 2);
  begin
    perform pg_temp.open_ret(s.o_id, s.i_id, 2);
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm like '%returnable%', 'second return above remaining: ' || sqlerrm;
  end;
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3);
begin
  begin
    perform public.online_return_open(s.o_id, null, false, 'change_of_mind', now() + interval '1 hour',
      jsonb_build_array(jsonb_build_object('item_id', s.i_id, 'units', 1)), 'n', null, null);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%future%', 'future contact: ' || sqlerrm; end;
  begin
    perform pg_temp.open_ret(s.o_id, s.i_id, 1, 'change_of_mind', now() - interval '10 days');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%before delivery%', 'contact before delivery: ' || sqlerrm; end;
  begin
    perform public.online_return_open(s.o_id, null, false, 'change_of_mind', now(),
      jsonb_build_array(jsonb_build_object('item_id', s.i_id, 'units', 1)), '  ', null, null);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%note%', 'note required: ' || sqlerrm; end;
  begin
    perform public.online_return_open(s.o_id, null, false, 'bogus', now(),
      jsonb_build_array(jsonb_build_object('item_id', s.i_id, 'units', 1)), 'n', null, null);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%reason%', 'bad reason: ' || sqlerrm; end;
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.shipped_order();
begin
  begin
    perform pg_temp.open_ret(s.o_id, (select id from public.order_items where order_id = s.o_id), 1);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%not delivered%', 'undelivered order: ' || sqlerrm; end;
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3); rid uuid;
begin
  rid := pg_temp.open_ret(s.o_id, s.i_id, 3);
  assert pg_temp.returnable(s.o_id) = 0, 'all units tied up';
  begin
    perform public.online_return_cancel(rid, null, ' ');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%note%', 'cancel note required: ' || sqlerrm; end;
  perform public.online_return_cancel(rid, null, 'customer changed mind');
  assert (select status from public.order_returns where id = rid) = 'cancelled', 'cancelled';
  assert pg_temp.returnable(s.o_id) = 3, 'units returnable again';
  assert exists (select 1 from public.order_events where order_id = s.o_id and kind = 'return_cancelled'), 'event';
  begin
    perform public.online_return_cancel(rid, null, 'again');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%cannot be cancelled%', 'cancel twice: ' || sqlerrm; end;
end $$;
rollback;

begin;
do $$
declare s record := pg_temp.delivered_order(3); rid uuid;
begin
  rid := pg_temp.open_ret(s.o_id, s.i_id, 1);
  update public.order_returns set status = 'refunded' where id = rid;
  begin
    perform public.online_return_cancel(rid, null, 'n');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%cannot be cancelled%', 'cancel refunded: ' || sqlerrm; end;
end $$;
rollback;

-- constraints, RLS, privileges
begin;
do $$
declare s record := pg_temp.delivered_order(3); rid uuid;
begin
  insert into public.order_refunds (order_id, reason) values (s.o_id, 'return');  -- accepted now
  rid := pg_temp.open_ret(s.o_id, s.i_id, 2);
  begin
    update public.order_return_items set received_units = 3 where return_id = rid;
    assert false, 'should have raised';
  exception when check_violation then null; end;
  assert (select relrowsecurity from pg_class where oid = 'public.order_returns'::regclass), 'rls returns';
  assert (select relrowsecurity from pg_class where oid = 'public.order_return_items'::regclass), 'rls items';
  assert (select relrowsecurity from pg_class where oid = 'public.order_return_photos'::regclass), 'rls photos';
  assert not exists (select 1 from pg_policies where tablename in ('order_returns', 'order_return_items', 'order_return_photos')), 'no policies';
  assert not has_function_privilege('anon', 'public.online_return_open(uuid,uuid,boolean,text,timestamptz,jsonb,text,text,text)', 'execute'), 'anon open';
  assert not has_function_privilege('authenticated', 'public.online_return_cancel(uuid,uuid,text)', 'execute'), 'authenticated cancel';
  assert not has_function_privilege('anon', 'public.online_return_returnable(uuid)', 'execute'), 'anon returnable';
  assert has_function_privilege('service_role', 'public.online_return_open(uuid,uuid,boolean,text,timestamptz,jsonb,text,text,text)', 'execute'), 'service open';
  assert has_function_privilege('service_role', 'public.online_return_cancel(uuid,uuid,text)', 'execute'), 'service cancel';
end $$;
rollback;

-- ===================================================================
-- Task 3: receive and refund, preview
-- ===================================================================
-- Delivered order from p_lines/p_opt (see mk_order); 2 days ago. Gateway 0 → paid without gateway.
create function pg_temp.delivered_multi(p_lines jsonb, p_opt jsonb default '{}'::jsonb) returns uuid
language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(p_lines, p_opt);
  perform public.online_order_confirm_payment(r.order_ref,
    case when pg_temp.gw(r.order_ref) = 0 then 'NO_GATEWAY' else 'cfpay_' || r.order_ref end, pg_temp.gw(r.order_ref), 'INR');
  perform public.online_order_set_availability(r.order_id, i.id, i.qty, null) from public.order_items i where i.order_id = r.order_id;
  perform pg_temp.pack(r.order_id);
  update public.orders set paid_at = now() - interval '20 days' where id = r.order_id;
  perform public.online_order_apply_tracking((select awb from public.orders where id = r.order_id), 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_mark_delivered(r.order_id, null, now() - interval '2 days', 'test');
  return r.order_id;
end $$;

create function pg_temp.item_of(p_order uuid) returns uuid language sql as $$
  select id from public.order_items where order_id = p_order order by line_no limit 1
$$;

create function pg_temp.variant_of(p_item uuid) returns uuid language sql as $$
  select variantid from public.order_items where id = p_item
$$;

create function pg_temp.recv_items(p_item uuid, p_received int, p_restock int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'received_units', p_received, 'restock_units', p_restock))
$$;

create function pg_temp.recv(p_ret uuid, p_item uuid, p_received int, p_restock int, p_note text default null)
returns jsonb language sql as $$
  select public.online_return_receive(p_ret, null, pg_temp.recv_items(p_item, p_received, p_restock), p_note)
$$;

create function pg_temp.photo(p_ret uuid) returns void language sql as $$
  insert into public.order_return_photos (return_id, path)
  select p_ret, r.order_id || '/' || p_ret || '/' || gen_random_uuid() || '.jpg' from public.order_returns r where r.id = p_ret
$$;

-- preview equals receive amounts on an order with an earlier partial refund and mixed voucher/gateway payment
begin;
do $$
declare
  o uuid; i uuid; r1 uuid; r2 uuid; p jsonb; res jsonb; ref public.order_refunds; n_ref int;
begin
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('RETVOUCHER000001', current_date + 30, 1000, 'online_refund');
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 3)),
                               '{"voucher_code":"RETVOUCHER000001"}');
  i := pg_temp.item_of(o);
  assert (select credit_part = 1000 and gateway_part = 2000 from public.order_items where id = i), 'mixed payment fixture';
  r1 := pg_temp.open_ret(o, i, 1);
  res := pg_temp.recv(r1, i, 1, 1);
  assert res ->> 'status' = 'refunded', 'earlier partial refund: ' || res::text;
  assert (res #>> '{refund,credit_part}')::numeric = 333.34 and (res #>> '{refund,gateway_part}')::numeric = 666.67,
    'first unit carries the paise remainder: ' || res::text;
  r2 := pg_temp.open_ret(o, i, 1);
  select count(*) into n_ref from public.order_refunds where order_id = o;
  p := public.online_return_preview(r2, pg_temp.recv_items(i, 1, 1));
  assert (select count(*) from public.order_refunds where order_id = o) = n_ref, 'preview writes nothing';
  assert (select refunded_qty from public.order_items where id = i) = 1, 'preview leaves refunded_qty';
  assert (select status from public.order_returns where id = r2) = 'open', 'preview leaves return open';
  res := pg_temp.recv(r2, i, 1, 1);
  select * into ref from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert (p ->> 'credit_part')::numeric = ref.credit_amount and (p ->> 'gateway_part')::numeric = ref.gateway_amount
     and (p ->> 'shipping')::numeric = ref.shipping_amount and (p ->> 'total')::numeric = ref.total_amount,
    'preview ' || p::text || ' = refund ' || row_to_json(ref)::text;
  assert (p ->> 'credit_part')::numeric = 333.33 and (p ->> 'gateway_part')::numeric = 666.67 and (p ->> 'shipping')::numeric = 0, p::text;
  assert res -> 'refund' = p, 'receive returns the same amounts: ' || res::text;
end $$;
rollback;

-- change of mind: product value only, no shipping, stock +restock
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; s0 numeric; ref public.order_refunds;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  s0 := pg_temp.stock(pg_temp.variant_of(i));
  rid := pg_temp.open_ret(o, i, 2);
  assert (public.online_return_preview(rid, pg_temp.recv_items(i, 2, 1)) ->> 'shipping')::numeric = 0, 'preview: no shipping';
  res := pg_temp.recv(rid, i, 2, 1);
  select * into ref from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert ref.reason = 'return' and ref.total_amount = 2000 and ref.shipping_amount = 0 and ref.units = 2, row_to_json(ref)::text;
  assert pg_temp.stock(pg_temp.variant_of(i)) = s0 + 1, 'stock + restock only';
  assert (select status = 'refunded' and refund_id = ref.id and received_at is not null
            from public.order_returns where id = rid), 'return refunded';
  assert (select received_units = 2 and restock_units = 1 from public.order_return_items where return_id = rid), 'units stored';
  assert (select status from public.orders where id = o) = 'delivered', 'order stays delivered';
  assert exists (select 1 from public.order_events where order_id = o and kind = 'return_refunded'
                   and data ->> 'return_id' = rid::text and data ->> 'refund_id' = ref.id::text), 'event';
  assert ref.status = 'awaiting_choice', 'gateway part waits for choice: ' || ref.status;
end $$;
rollback;

-- damaged whole order: shipping included (and offset on the bill)
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; ref public.order_refunds;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 2, 'damaged_wrong', now() - interval '1 day');
  perform pg_temp.photo(rid);
  assert (public.online_return_preview(rid, pg_temp.recv_items(i, 2, 0)) ->> 'shipping')::numeric = 99, 'preview: shipping';
  res := pg_temp.recv(rid, i, 2, 0);
  select * into ref from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert ref.shipping_amount = 99 and ref.total_amount = 2099, row_to_json(ref)::text;
  assert exists (select 1 from public.exchanges where order_refund_id = ref.id and order_item_id is null
                   and product_name = 'Shipping' and credit_amount = 99 and reason = 'Return: damaged/wrong'), 'shipping offset row';
end $$;
rollback;

-- damaged partial: no shipping
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; ref public.order_refunds;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 1, 'damaged_wrong', now() - interval '1 day');
  perform pg_temp.photo(rid);
  res := pg_temp.recv(rid, i, 1, 0);
  select * into ref from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert ref.shipping_amount = 0 and ref.total_amount = 1000, row_to_json(ref)::text;
  assert not exists (select 1 from public.exchanges where order_refund_id = ref.id and order_item_id is null), 'no shipping offset';
end $$;
rollback;

-- damaged whole order via two returns (one change of mind, one damaged): shipping on the one that completes it;
-- damaged whole order where only part passed the check: no shipping
begin;
do $$
declare
  o uuid; i uuid; r1 uuid; r2 uuid; res jsonb;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  r1 := pg_temp.open_ret(o, i, 2, 'damaged_wrong', now() - interval '1 day');
  perform pg_temp.photo(r1);
  res := pg_temp.recv(r1, i, 1, 0, 'one piece worn');
  assert (res #>> '{refund,shipping}')::numeric = 0, 'not every unit back: ' || res::text;
  r2 := pg_temp.open_ret(o, i, 1, 'damaged_wrong', now() - interval '1 day');
  perform pg_temp.photo(r2);
  res := pg_temp.recv(r2, i, 1, 0);
  assert (res #>> '{refund,shipping}')::numeric = 99, 'second return completes the order: ' || res::text;
end $$;
rollback;

-- second damaged return after shipping refunded: no shipping again
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; p jsonb;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  -- shipping already refunded by an earlier refund on this order
  perform public._online_refund_create(o, 'return', '[]'::jsonb, true, null);
  assert (select count(*) from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
           where r.order_id = o and l.source like 'shipping%') = 1, 'shipping leg exists';
  rid := pg_temp.open_ret(o, i, 2, 'damaged_wrong', now() - interval '1 day');
  perform pg_temp.photo(rid);
  p := public.online_return_preview(rid, pg_temp.recv_items(i, 2, 0));
  res := pg_temp.recv(rid, i, 2, 0);
  assert (p ->> 'shipping')::numeric = 0 and (res #>> '{refund,shipping}')::numeric = 0, 'no shipping twice: ' || res::text;
  assert (res #>> '{refund,total}')::numeric = 2000, res::text;
end $$;
rollback;

-- voucher-paid part completes at once
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; ref public.order_refunds;
begin
  insert into public.vouchers (voucher_id, expiry_date, value, source) values ('RETVOUCHER000002', current_date + 30, 5000, 'online_refund');
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)),
                               '{"voucher_code":"RETVOUCHER000002"}');
  assert (select gateway_amount from public.orders where id = o) = 0, 'fully voucher-paid';
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 1);
  res := pg_temp.recv(rid, i, 1, 1);
  select * into ref from public.order_refunds where id = (res ->> 'refund_id')::uuid;
  assert ref.status = 'completed' and ref.credit_amount = 1000 and ref.gateway_amount = 0, row_to_json(ref)::text;
  assert (select bool_and(status = 'completed') and bool_and(source = 'credit') from public.order_refund_legs where refund_id = ref.id),
    'credit leg completed';
end $$;
rollback;

-- failed pieces: received 1 of 2 refunds 1, note required
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; s0 numeric;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  s0 := pg_temp.stock(pg_temp.variant_of(i));
  rid := pg_temp.open_ret(o, i, 2);
  begin
    perform pg_temp.recv(rid, i, 1, 1, '  ');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%note%', 'note required: ' || sqlerrm; end;
  res := pg_temp.recv(rid, i, 1, 1, 'tags removed on one');
  assert (res #>> '{refund,total}')::numeric = 1000, res::text;
  assert (select receive_note from public.order_returns where id = rid) = 'tags removed on one', 'note stored';
  assert pg_temp.stock(pg_temp.variant_of(i)) = s0 + 1, 'stock +1';
  assert pg_temp.returnable(o) = 1, 'failed piece is returnable again: ' || pg_temp.returnable(o);
end $$;
rollback;

-- nothing passed → rejected, no refund
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; s0 numeric;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  s0 := pg_temp.stock(pg_temp.variant_of(i));
  rid := pg_temp.open_ret(o, i, 2);
  begin
    perform pg_temp.recv(rid, i, 0, 0);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%note%', 'note required to reject: ' || sqlerrm; end;
  res := pg_temp.recv(rid, i, 0, 0, 'both worn');
  assert res ->> 'status' = 'rejected' and res ->> 'refund_id' is null, res::text;
  assert (select status from public.order_returns where id = rid) = 'rejected', 'rejected';
  assert not exists (select 1 from public.order_refunds where order_id = o), 'no refund';
  assert pg_temp.stock(pg_temp.variant_of(i)) = s0, 'stock unchanged';
  assert exists (select 1 from public.order_events where order_id = o and kind = 'return_rejected'), 'event';
  res := pg_temp.recv(rid, i, 0, 0, 'both worn');
  assert res ->> 'status' = 'rejected', 'repeat on rejected returns stored result';
end $$;
rollback;

-- receive twice returns same refund
begin;
do $$
declare
  o uuid; i uuid; rid uuid; a jsonb; b jsonb; s0 numeric;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  s0 := pg_temp.stock(pg_temp.variant_of(i));
  rid := pg_temp.open_ret(o, i, 2);
  a := pg_temp.recv(rid, i, 2, 2);
  b := pg_temp.recv(rid, i, 2, 2);
  assert a = b, a::text || ' vs ' || b::text;
  assert (select count(*) from public.order_refunds where order_id = o) = 1, 'one refund';
  assert pg_temp.stock(pg_temp.variant_of(i)) = s0 + 2, 'stock restored once';
  assert (select count(*) from public.order_events where order_id = o and kind = 'return_refunded') = 1, 'one event';
end $$;
rollback;

-- damaged without photo raises
begin;
do $$
declare
  o uuid; i uuid; rid uuid;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 1, 'damaged_wrong', now() - interval '1 day');
  begin
    perform pg_temp.recv(rid, i, 1, 0);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%photo%', 'photo required: ' || sqlerrm; end;
  assert (select status from public.order_returns where id = rid) = 'open', 'still open';
end $$;
rollback;

-- in-store exchange meanwhile → raises
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 2);
  insert into public.exchanges (original_bill_item_id, quantity, reason)
  values ((select bill_item_id from public.order_items where id = i), 1, 'In-store exchange');
  begin
    perform pg_temp.recv(rid, i, 2, 2);
    assert false, 'should have raised';
  exception when others then
    assert sqlerrm = 'item ' || i || ' was exchanged in store; reduce received pieces', 'race: ' || sqlerrm;
  end;
  begin
    perform public.online_return_preview(rid, pg_temp.recv_items(i, 2, 2));
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%exchanged in store%', 'preview race: ' || sqlerrm; end;
  res := pg_temp.recv(rid, i, 1, 1, 'one exchanged in store');
  assert res ->> 'status' = 'refunded', res::text;
end $$;
rollback;

-- exchanges rows written with order_refund_id
begin;
do $$
declare
  o uuid; i uuid; rid uuid; res jsonb; b int;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 2);
  res := pg_temp.recv(rid, i, 2, 2);
  select bill_id into b from public.orders where id = o;
  assert exists (select 1 from public.exchanges e join public.order_items it on it.id = e.order_item_id
                  where e.order_refund_id = (res ->> 'refund_id')::uuid and e.order_item_id = i
                    and e.original_bill_item_id = it.bill_item_id and e.quantity = 2 and e.credit_amount = 2000
                    and e.reason = 'Return: change of mind' and e.new_billid = b), 'item offset row';
  assert pg_temp.returnable(o) = 0, 'online offset not double-counted as in-store exchange';
end $$;
rollback;

-- input validation
begin;
do $$
declare
  o uuid; i uuid; rid uuid;
begin
  o := pg_temp.delivered_multi(jsonb_build_array(jsonb_build_object('v', pg_temp.mk_variant(1000, 10), 'qty', 2)));
  i := pg_temp.item_of(o);
  rid := pg_temp.open_ret(o, i, 1);
  begin
    perform pg_temp.recv(rid, i, 2, 0, 'n');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%received%', 'received above units: ' || sqlerrm; end;
  begin
    perform pg_temp.recv(rid, i, 1, 2, 'n');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%restock%', 'restock above received: ' || sqlerrm; end;
  begin
    perform pg_temp.recv(rid, i, 1, null, 'n');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%restock%', 'restock required: ' || sqlerrm; end;
  begin
    perform pg_temp.recv(rid, gen_random_uuid(), 1, 1, 'n');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%not on return%', 'unknown item: ' || sqlerrm; end;
  begin
    perform public.online_return_receive(rid, null, '[]'::jsonb, 'n');
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%every item%', 'item missing: ' || sqlerrm; end;
  perform public.online_return_cancel(rid, null, 'n');
  begin
    perform pg_temp.recv(rid, i, 1, 1);
    assert false, 'should have raised';
  exception when others then assert sqlerrm like '%cancelled%', 'cancelled return: ' || sqlerrm; end;
  assert not has_function_privilege('anon', 'public.online_return_receive(uuid,uuid,jsonb,text)', 'execute'), 'anon receive';
  assert not has_function_privilege('authenticated', 'public.online_return_preview(uuid,jsonb)', 'execute'), 'authenticated preview';
  assert has_function_privilege('service_role', 'public.online_return_receive(uuid,uuid,jsonb,text)', 'execute'), 'service receive';
  assert has_function_privilege('service_role', 'public.online_return_preview(uuid,jsonb)', 'execute'), 'service preview';
end $$;
rollback;

\echo 'test_online_returns: all passed'
