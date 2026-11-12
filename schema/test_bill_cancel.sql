-- Tests for schema/migration_bill_cancel.sql. The whole file is one transaction that always
-- rolls back, it creates its own fixtures, and its final select returns only pass and fail counts.
-- A failed check also raises a WARNING naming that check.
-- Run locally (orders comes from the online orders migrations):
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_bill_save.sql \
--     schema/migration_bill_stock_reduced.sql schema/migration_bill_cancel.sql \
--     schema/migration_bill_cancel_exchange_payout.sql schema/test_bill_cancel.sql
-- Add schema/migration_bill_cancel_marker.sql before this file to test the live definition; it
-- also passes with the later bill migrations loaded (bill_status_states, bill_payments_ledger).
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _bc_checks (label text not null, passed boolean not null) on commit drop;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _bc_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

-- Every key this file uses shares one prefix.
create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('bca2c000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create function pg_temp.admin_id() returns uuid language sql as $$ select 'bca2c000-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.customer_id() returns uuid language sql as $$ select 'bca2c000-0000-4000-8000-a00000000002'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'bca2c000-0000-4000-8000-100000000001'::uuid $$;
create function pg_temp.v2() returns uuid language sql as $$ select 'bca2c000-0000-4000-8000-100000000002'::uuid $$;

-- Calls the RPC the way PostgREST would: JWT claims set, role switched only for the call.
create function pg_temp.call(p_key uuid, p_billid int, p_mode text, p_options jsonb,
                             p_uid uuid default null, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', coalesce(p_uid, pg_temp.admin_id()), 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  r := public.bill_cancel(p_key, p_billid, p_mode, p_options);
  perform set_config('role', 'none', true);
  return r;
end $$;

-- 'ok', the P0001 error code, or the SQLSTATE. The error undoes the call and the role switch.
create function pg_temp.try(p_key uuid, p_billid int, p_mode text, p_options jsonb,
                            p_uid uuid default null, p_role text default 'authenticated')
returns text language plpgsql as $$
begin
  perform pg_temp.call(p_key, p_billid, p_mode, p_options, p_uid, p_role);
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

create function pg_temp.opts(p_finalized boolean, p_status text, p_restore_older boolean default true)
returns jsonb language sql as $$
  select jsonb_build_object('expect', jsonb_build_object('finalized', p_finalized, 'paymentstatus', p_status),
                            'restore_older_stock', p_restore_older)
$$;

create function pg_temp.stock(p_v uuid) returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = p_v
$$;

create function pg_temp.credit(p_c int) returns numeric language sql as $$
  select round(store_credit::numeric, 2) from public.customers where customerid = p_c
$$;

create function pg_temp.status(p_b int) returns text language sql as $$
  select paymentstatus from public.bills where billid = p_b
$$;

-- Everything a cancel can touch. Compared whole, never output.
create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'bills', (select jsonb_object_agg(billid, paymentstatus) from public.bills where notes like 'BCAN%'),
    'stock', (select jsonb_object_agg(variantid, stock) from public.productsizecolors where productid like 'BCAN%'),
    'credit', (select jsonb_object_agg(customerid, store_credit) from public.customers where customerid in (-9101, -9102, -9103)),
    'ledger', (select count(*) from public.store_credit_ledger where customerid in (-9101, -9102, -9103)),
    'vouchers', (select jsonb_object_agg(voucher_id, jsonb_build_array(redeemed, redeemed_billid)) from public.vouchers where voucher_id like 'BCAN%'),
    'exchanges', (select jsonb_object_agg(exchangeid, new_billid) from public.exchanges where exchangeid between -9199 and -9101),
    'usage', (select count(*) from public.discount_usage where customerid in (-9101, -9102, -9103)),
    'moves', (select count(*) from public.bill_stock_moves where reason = 'bill_cancel'),
    'log', (select count(*) from public.bill_save_log where idempotency_key::text like 'bca2c000-%'))
$$;

-- A bill written straight to the table, as the old screen and CLI do. One line per variant given.
create function pg_temp.bill(p_finalized boolean, p_status text, p_customer int, p_paid numeric,
                             p_stock_reduced boolean, p_lines jsonb, p_extra jsonb default '{}')
returns int language plpgsql as $$
declare
  b int;
  l jsonb;
begin
  insert into public.bills (customerid, notes, totalamount, paymentstatus, finalized, payment_amount,
                            store_credit_used, exchange_credit_used, exchange_cash_refund,
                            stock_reduced, saleslocationid, salesmethodid)
  values (p_customer, 'BCAN', 1000, p_status, p_finalized, p_paid,
          coalesce((p_extra ->> 'store_credit_used')::numeric, 0),
          coalesce((p_extra ->> 'exchange_credit_used')::numeric, 0),
          coalesce((p_extra ->> 'exchange_cash_refund')::numeric, 0),
          p_stock_reduced, -9101, -9101)
  returning billid into b;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.bill_items (billid, quantity, mrp, variantid, product_name, subtotal, gst_amount, total)
    values (b, (l ->> 'qty')::numeric, 1000, (l ->> 'v')::uuid, 'BCAN item', 1000, 0, 1000);
  end loop;
  return b;
end $$;

create function pg_temp.line(p_v uuid, p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_object('v', p_v, 'qty', p_qty)
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values
    (pg_temp.admin_id(), 'bcan-admin@example.invalid'),
    (pg_temp.customer_id(), 'bcan-customer@example.invalid');
  insert into public.profiles (id, email, role, is_active) values
    (pg_temp.admin_id(), 'bcan-admin@example.invalid', 'admin', true),
    (pg_temp.customer_id(), 'bcan-customer@example.invalid', 'user', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

  insert into public.customers (customerid, customer_ulid, first_name, store_credit) values
    (-9101, 'BCANFIXTURE000000000000001', 'Fixture', 500),
    (-9102, 'BCANFIXTURE000000000000002', 'Fixture', 0),
    (-9103, 'BCANFIXTURE000000000000003', 'Fixture', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9101, 'BCAN method');
  insert into public.saleslocations (saleslocationid, locationname) values (-9101, 'BCAN location');
  insert into public.discounts (code, type, value) values ('BCAN', 'flat', 10);

  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('BCAN'), ('BCAN2') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('BCAN', 'BCAN', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('BCANP1', 'Fixture', 400, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('BCANP1', 'BCAN', 'BCAN', 10, pg_temp.v1()),
    ('BCANP1', 'BCAN', 'BCAN2', 10, pg_temp.v2());
  insert into public.vouchers (voucher_id, customerid, expiry_date, value) values
    ('BCAN-V', -9101, current_date + 30, 100);
end $$;

-- ---------- access ----------
do $$
declare
  b int := pg_temp.bill(false, 'draft', -9101, null, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  before jsonb := pg_temp.state();
begin
  perform pg_temp.ok('anon refused',
    pg_temp.try(pg_temp.k(1), b, 'draft', pg_temp.opts(false, 'draft'), null, 'anon') = '42501');
  perform pg_temp.ok('shopper refused',
    pg_temp.try(pg_temp.k(1), b, 'draft', pg_temp.opts(false, 'draft'), pg_temp.customer_id()) = '42501');
  perform pg_temp.ok('access: nothing changed', pg_temp.state() = before);
end $$;

-- ---------- draft: stock back, locked, second cancel refused, replay ----------
do $$
declare
  b int := pg_temp.bill(false, 'draft', -9101, null, true,
    jsonb_build_array(pg_temp.line(pg_temp.v1(), 2), pg_temp.line(pg_temp.v1(), 1), pg_temp.line(null, 1)));
  s0 numeric := pg_temp.stock(pg_temp.v1());
  r jsonb;
  after jsonb;
begin
  r := pg_temp.call(pg_temp.k(10), b, 'draft', pg_temp.opts(false, 'draft'));
  perform pg_temp.ok('draft cancelled', pg_temp.status(b) = 'cancelled');
  perform pg_temp.ok('draft stock back summed per variant', pg_temp.stock(pg_temp.v1()) = s0 + 3);
  perform pg_temp.ok('draft one move row', (select count(*) = 1 and sum(delta) = 3
      from public.bill_stock_moves where billid = b and reason = 'bill_cancel'));
  perform pg_temp.ok('draft result', (r ->> 'replayed')::boolean = false and r ->> 'mode' = 'draft'
      and jsonb_array_length(r -> 'stock') = 1);

  after := pg_temp.state();
  r := pg_temp.call(pg_temp.k(10), b, 'draft', pg_temp.opts(false, 'draft'));
  perform pg_temp.ok('same key replays', (r ->> 'replayed')::boolean and pg_temp.state() = after);
  perform pg_temp.ok('same key other mode conflicts',
    pg_temp.try(pg_temp.k(10), b, 'no_customer', pg_temp.opts(false, 'draft')) = 'BILL_KEY_CONFLICT');
  perform pg_temp.ok('second cancel refused',
    pg_temp.try(pg_temp.k(11), b, 'draft', pg_temp.opts(false, 'draft')) = 'BILL_ALREADY_CANCELLED');
  perform pg_temp.ok('second cancel refused even with matching expect',
    pg_temp.try(pg_temp.k(12), b, 'draft', pg_temp.opts(false, 'cancelled')) = 'BILL_ALREADY_CANCELLED');
  perform pg_temp.ok('refusals changed nothing', pg_temp.state() = after);
end $$;

-- ---------- refusals before any write ----------
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9101, 1000, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  anon_b int := pg_temp.bill(true, 'finalized', null, 1000, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  before jsonb := pg_temp.state();
begin
  perform pg_temp.ok('stale finalized',
    pg_temp.try(pg_temp.k(20), b, 'draft', pg_temp.opts(false, 'draft')) = 'BILL_STALE');
  perform pg_temp.ok('stale status',
    pg_temp.try(pg_temp.k(21), b, 'return_payment', pg_temp.opts(true, 'partial')) = 'BILL_STALE');
  perform pg_temp.ok('draft mode on finalized refused',
    pg_temp.try(pg_temp.k(22), b, 'draft', pg_temp.opts(true, 'finalized')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('no_customer mode with customer refused',
    pg_temp.try(pg_temp.k(23), b, 'no_customer', pg_temp.opts(true, 'finalized')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('store_credit without customer refused',
    pg_temp.try(pg_temp.k(24), anon_b, 'store_credit', pg_temp.opts(true, 'finalized')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown mode refused',
    pg_temp.try(pg_temp.k(25), b, 'void', pg_temp.opts(true, 'finalized')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown option refused',
    pg_temp.try(pg_temp.k(26), b, 'return_payment', pg_temp.opts(true, 'finalized') || '{"x": 1}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('missing expect refused',
    pg_temp.try(pg_temp.k(27), b, 'return_payment', '{"restore_older_stock": true}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('missing bill refused',
    pg_temp.try(pg_temp.k(28), -1, 'return_payment', pg_temp.opts(true, 'finalized')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('bad option type refused',
    pg_temp.try(pg_temp.k(29), b, 'return_payment', pg_temp.opts(true, 'finalized') || '{"restore_older_stock": "maybe"}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('refusals: nothing changed', pg_temp.state() = before);
end $$;

-- ---------- website bill refused ----------
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9101, 1000, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  before jsonb;
begin
  -- order_ref given so the rolled-back prod run never takes a real WEB- number from the sequence.
  insert into public.orders (order_ref, contact_name, contact_phone, address, subtotal, gateway_amount, bill_id)
  values ('BCAN-TEST', 'BCAN', '9999999999', '{}'::jsonb, 1000, 1000, b);
  before := pg_temp.state();
  perform pg_temp.ok('online bill refused',
    pg_temp.try(pg_temp.k(30), b, 'return_payment', pg_temp.opts(true, 'finalized')) = 'BILL_ONLINE');
  perform pg_temp.ok('online: nothing changed', pg_temp.state() = before);
end $$;

-- ---------- decision 4: stock back only what the bill took ----------
do $$
declare
  b_false int := pg_temp.bill(true, 'finalized', null, 0, false, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  b_null_no int := pg_temp.bill(true, 'finalized', null, 0, null, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  b_null_yes int := pg_temp.bill(true, 'finalized', null, 0, null, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  s0 numeric := pg_temp.stock(pg_temp.v1());
  r jsonb;
begin
  r := pg_temp.call(pg_temp.k(40), b_false, 'no_customer', pg_temp.opts(true, 'finalized'));
  perform pg_temp.ok('stock_reduced false: no stock back', pg_temp.stock(pg_temp.v1()) = s0
      and jsonb_array_length(r -> 'stock') = 0 and pg_temp.status(b_false) = 'cancelled');
  r := pg_temp.call(pg_temp.k(41), b_null_no, 'no_customer', pg_temp.opts(true, 'finalized', false));
  perform pg_temp.ok('older bill, staff say no: no stock back', pg_temp.stock(pg_temp.v1()) = s0);
  r := pg_temp.call(pg_temp.k(42), b_null_yes, 'no_customer', pg_temp.opts(true, 'finalized', true));
  perform pg_temp.ok('older bill, staff say yes: stock back', pg_temp.stock(pg_temp.v1()) = s0 + 1);
end $$;

-- bill_save with "Don't reduce stock": stock_reduced defaults true, but the move rows say 0.
do $$
declare
  r jsonb;
  b int;
  s0 numeric;
begin
  r := public.bill_save(pg_temp.k(50), 'finalize_create', jsonb_build_object(
    'bill', jsonb_build_object('notes', 'BCAN save', 'paymentstatus', 'finalized', 'finalized', true,
                               'totalamount', 1000, 'payment_amount', 1000),
    'items', jsonb_build_array(jsonb_build_object('quantity', 2, 'mrp', 1000, 'variantid', pg_temp.v2(),
      'subtotal', 1000, 'gst_amount', 0, 'total', 1000)),
    'skip_stock', true));
  b := (r ->> 'billid')::int;
  s0 := pg_temp.stock(pg_temp.v2());
  r := pg_temp.call(pg_temp.k(51), b, 'no_customer', pg_temp.opts(true, 'finalized', true));
  perform pg_temp.ok('skip_stock bill_save bill: no stock back', pg_temp.stock(pg_temp.v2()) = s0);

  r := public.bill_save(pg_temp.k(52), 'finalize_create', jsonb_build_object(
    'bill', jsonb_build_object('notes', 'BCAN save', 'paymentstatus', 'finalized', 'finalized', true,
                               'totalamount', 1000, 'payment_amount', 1000),
    'items', jsonb_build_array(jsonb_build_object('quantity', 2, 'mrp', 1000, 'variantid', pg_temp.v2(),
      'subtotal', 1000, 'gst_amount', 0, 'total', 1000))));
  b := (r ->> 'billid')::int;
  s0 := pg_temp.stock(pg_temp.v2());
  -- stock_reduced set false by hand: the move rows still win, because they record what happened.
  update public.bills set stock_reduced = false where billid = b;
  r := pg_temp.call(pg_temp.k(53), b, 'no_customer', pg_temp.opts(true, 'finalized', false));
  perform pg_temp.ok('bill_save bill: moves decide, 2 back', pg_temp.stock(pg_temp.v2()) = s0 + 2);
end $$;

-- ---------- decision 1: exchanged items; store credit used comes back ----------
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9101, 1000, true,
    jsonb_build_array(pg_temp.line(pg_temp.v1(), 2), pg_temp.line(pg_temp.v2(), 1)),
    '{"store_credit_used": 50}');
  item int;
  s1 numeric := pg_temp.stock(pg_temp.v1());
  s2 numeric := pg_temp.stock(pg_temp.v2());
  c0 numeric := pg_temp.credit(-9101);
  r jsonb;
begin
  select bill_item_id into item from public.bill_items where billid = b and variantid = pg_temp.v1();
  insert into public.exchanges (exchangeid, original_bill_item_id, quantity, customerid, credit_amount)
  values (-9101, item, 1, -9101, 300);

  r := pg_temp.call(pg_temp.k(60), b, 'return_payment', pg_temp.opts(true, 'finalized'));
  perform pg_temp.ok('exchange: refund = received - exchange credit', (r ->> 'refund')::numeric = 700);
  perform pg_temp.ok('exchange: figures reported', (r ->> 'received')::numeric = 1000
      and (r ->> 'exchange_credit_given')::numeric = 300);
  perform pg_temp.ok('exchange: exchanged qty not restocked', pg_temp.stock(pg_temp.v1()) = s1 + 1
      and pg_temp.stock(pg_temp.v2()) = s2 + 1);
  perform pg_temp.ok('return_payment: only used credit comes back',
      pg_temp.credit(-9101) = c0 + 50 and (r ->> 'store_credit_refunded')::numeric = 50
      and (r ->> 'credit_added')::numeric = 0);
  perform pg_temp.ok('ledger reason', exists (select 1 from public.store_credit_ledger
      where customerid = -9101 and reason = 'bill_cancel_refund' and ref_id = b::text and delta = 50));
end $$;

-- exchange credit bigger than what was paid: refund floors at 0
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9102, 200, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  item int;
  r jsonb;
begin
  select bill_item_id into item from public.bill_items where billid = b;
  insert into public.exchanges (exchangeid, original_bill_item_id, quantity, customerid, credit_amount)
  values (-9102, item, 1, -9102, 500);
  r := pg_temp.call(pg_temp.k(61), b, 'store_credit', pg_temp.opts(true, 'finalized'));
  perform pg_temp.ok('refund floors at 0', (r ->> 'refund')::numeric = 0
      and (r ->> 'credit_added')::numeric = 0 and pg_temp.credit(-9102) = 0);
end $$;

-- ---------- part paid: received is the sum of payments; store_credit mode adds it ----------
do $$
declare
  b int := pg_temp.bill(true, 'partial', -9102, 999, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)));
  r jsonb;
  c0 numeric := pg_temp.credit(-9102);
begin
  -- Written with the marker bill_save and bill_add_payment set (migration_bill_payments_ledger.sql).
  perform set_config('app.bill_payment_writer', 'on', true);
  insert into public.bill_payments (billid, amount, salesmethodid) values (b, 150.25, -9101), (b, 100, -9101);
  perform set_config('app.bill_payment_writer', '', true);
  r := pg_temp.call(pg_temp.k(70), b, 'store_credit', pg_temp.opts(true, 'partial'));
  perform pg_temp.ok('partial: received from payments', (r ->> 'refund')::numeric = 250.25);
  perform pg_temp.ok('store_credit: credit added', pg_temp.credit(-9102) = c0 + 250.25
      and (r ->> 'credit_added')::numeric = 250.25);
  perform pg_temp.ok('store_credit ledger', exists (select 1 from public.store_credit_ledger
      where customerid = -9102 and reason = 'bill_cancel_credit' and ref_id = b::text and delta = 250.25));
end $$;

-- ---------- decision 2 + voucher + discount usage ----------
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9101, 400, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"exchange_credit_used": 600}');
  r jsonb;
begin
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9103, 1, -9101, 600, b), (-9104, 1, -9101, 100, null);
  update public.vouchers set redeemed = true, redeemed_at = now(), redeemed_billid = b where voucher_id = 'BCAN-V';
  insert into public.discount_usage (customerid, code, billid) values (-9101, 'BCAN', b);

  r := pg_temp.call(pg_temp.k(80), b, 'return_payment', pg_temp.opts(true, 'finalized'));
  perform pg_temp.ok('exchange credit pending again', (select new_billid from public.exchanges where exchangeid = -9103) is null
      and (r ->> 'exchanges_released')::int = 1);
  perform pg_temp.ok('paying exchange is not this bill''s exchange credit', (r ->> 'refund')::numeric = 400);
  perform pg_temp.ok('voucher released', (select not redeemed and redeemed_billid is null and redeemed_at is null
      from public.vouchers where voucher_id = 'BCAN-V') and (r ->> 'voucher_released')::boolean);
  perform pg_temp.ok('discount usage removed', not exists (select 1 from public.discount_usage where billid = b));
end $$;

-- ---------- owner rule: exchange credit is never cashed out twice ----------
-- Bill 167 on prod: exchange 688.46 paid a 687.90 bill and 0.56 went back as cash.
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9103, null, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"exchange_credit_used": 687.90, "exchange_cash_refund": 0.56}');
  before jsonb;
begin
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9110, 1, -9103, 688.46, b);
  before := pg_temp.state();
  perform pg_temp.ok('cash back with nothing to take it from: refused',
    pg_temp.try(pg_temp.k(100), b, 'store_credit', pg_temp.opts(true, 'finalized')) = 'BILL_EXCHANGE_PAID_OUT');
  perform pg_temp.ok('cash back refused: nothing changed', pg_temp.state() = before
      and (select new_billid from public.exchanges where exchangeid = -9110) = b);
end $$;

-- the paid-out part comes off this bill's refund first
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9103, 500, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"exchange_credit_used": 700, "exchange_cash_refund": 100}');
  r jsonb;
  c0 numeric := pg_temp.credit(-9103);
begin
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9111, 1, -9103, 800, b);
  r := pg_temp.call(pg_temp.k(101), b, 'store_credit', pg_temp.opts(true, 'finalized'));
  perform pg_temp.ok('paid out taken from refund', (r ->> 'refund')::numeric = 400
      and (r ->> 'exchange_paid_out')::numeric = 100 and (r ->> 'store_credit_taken')::numeric = 0);
  perform pg_temp.ok('refund net of paid out credited', pg_temp.credit(-9103) = c0 + 400);
  perform pg_temp.ok('exchange pending again', (select new_billid from public.exchanges where exchangeid = -9111) is null);
end $$;

-- excess put on store credit at the bill is taken back from store credit
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9103, 0, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"exchange_credit_used": 600}');
  r jsonb;
  c0 numeric;
begin
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9112, 1, -9103, 1000, b);
  perform public.store_credit_adjust(-9103, 400, 'exchange_credit', b::text);
  c0 := pg_temp.credit(-9103);
  r := pg_temp.call(pg_temp.k(102), b, 'return_payment', pg_temp.opts(true, 'finalized'));
  perform pg_temp.ok('store credit excess taken back', pg_temp.credit(-9103) = c0 - 400
      and (r ->> 'store_credit_taken')::numeric = 400 and (r ->> 'refund')::numeric = 0);
  perform pg_temp.ok('take-back ledger row', exists (select 1 from public.store_credit_ledger
      where customerid = -9103 and reason = 'bill_cancel_exchange_paid_out' and ref_id = b::text and delta = -400));
end $$;

-- the same excess already spent from store credit: refused
do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9103, 0, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"exchange_credit_used": 600}');
  before jsonb;
begin
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9113, 1, -9103, 1000, b);
  update public.customers set store_credit = 399.99 where customerid = -9103;
  before := pg_temp.state();
  perform pg_temp.ok('spent excess: refused',
    pg_temp.try(pg_temp.k(103), b, 'return_payment', pg_temp.opts(true, 'finalized')) = 'BILL_EXCHANGE_PAID_OUT');
  perform pg_temp.ok('spent excess: nothing changed', pg_temp.state() = before);
end $$;

-- no customer to take it from: refused
do $$
declare
  b int := pg_temp.bill(true, 'finalized', null, 0, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"exchange_credit_used": 100, "exchange_cash_refund": 50}');
begin
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9114, 1, -9103, 150, b);
  perform pg_temp.ok('no customer, paid out: refused',
    pg_temp.try(pg_temp.k(104), b, 'no_customer', pg_temp.opts(true, 'finalized')) = 'BILL_EXCHANGE_PAID_OUT');
end $$;

-- ---------- a failure part way leaves nothing behind ----------
-- The status update is the last write, so failing it proves stock, credit, voucher, exchange
-- and usage writes all roll back with it. The trigger exists only inside this transaction.
create function pg_temp.fail_cancel() returns trigger language plpgsql as $$
begin
  if new.notes = 'BCAN fail' and new.paymentstatus = 'cancelled' then
    raise exception 'injected failure';
  end if;
  return new;
end $$;
create trigger bcan_fail before update on public.bills for each row execute function pg_temp.fail_cancel();

do $$
declare
  b int := pg_temp.bill(true, 'finalized', -9101, 1000, true, jsonb_build_array(pg_temp.line(pg_temp.v1(), 1)),
    '{"store_credit_used": 50, "exchange_credit_used": 100}');
  before jsonb;
begin
  update public.bills set notes = 'BCAN fail' where billid = b;
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid)
  values (-9105, 1, -9101, 100, b);
  update public.vouchers set redeemed = true, redeemed_at = now(), redeemed_billid = b where voucher_id = 'BCAN-V';
  insert into public.discount_usage (customerid, code, billid) values (-9101, 'BCAN', b);
  before := pg_temp.state();
  perform pg_temp.ok('injected failure fails the cancel',
    pg_temp.try(pg_temp.k(90), b, 'store_credit', pg_temp.opts(true, 'finalized')) <> 'ok');
  perform pg_temp.ok('failed cancel: nothing changed', pg_temp.state() = before and pg_temp.status(b) = 'finalized');
  perform pg_temp.ok('failed cancel: key released for retry',
    not exists (select 1 from public.bill_save_log where idempotency_key = pg_temp.k(90)));
end $$;
drop trigger bcan_fail on public.bills;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _bc_checks;
rollback;
