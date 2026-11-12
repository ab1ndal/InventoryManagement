-- Tests for schema/migration_bill_save.sql. The whole file is one transaction that always rolls
-- back, it creates its own fixtures, and its final select returns only pass and fail counts.
-- A failed check also raises a WARNING naming that check.
-- Each failure is injected by catching the error in a plpgsql block, which undoes the call
-- exactly as a real failure would. Trigger-based and two-session cases are local only: see
-- schema/test_harness/concurrency_test.sh.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql schema/migration_bill_save.sql \
--     schema/migration_bill_stock_reduced.sql schema/migration_bill_save_app_callers.sql \
--     schema/test_bill_save.sql
-- It also passes with the later bill migrations loaded (bill_status_states, bill_add_payment,
-- bill_payments_ledger).
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _bs_checks (label text not null, passed boolean not null) on commit drop;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _bs_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

-- Every key this file uses shares one prefix, so the state check can find them.
create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('b5a7e000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create function pg_temp.admin_id() returns uuid language sql as $$ select 'b5a7e000-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.customer_id() returns uuid language sql as $$ select 'b5a7e000-0000-4000-8000-a00000000002'::uuid $$;
create function pg_temp.inactive_id() returns uuid language sql as $$ select 'b5a7e000-0000-4000-8000-a00000000003'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'b5a7e000-0000-4000-8000-100000000001'::uuid $$;
create function pg_temp.v2() returns uuid language sql as $$ select 'b5a7e000-0000-4000-8000-100000000002'::uuid $$;
create function pg_temp.v0() returns uuid language sql as $$ select 'b5a7e000-0000-4000-8000-100000000000'::uuid $$;

-- Calls the RPC the way PostgREST would: JWT claims set, role switched only for the call.
create function pg_temp.call(p_key uuid, p_op text, p_payload jsonb,
                             p_uid uuid default null, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', coalesce(p_uid, pg_temp.admin_id()), 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  r := public.bill_save(p_key, p_op, p_payload);
  perform set_config('role', 'none', true);
  return r;
end $$;

-- 'ok', the P0001 error code, or the SQLSTATE. The error undoes the call and the role switch.
create function pg_temp.try(p_key uuid, p_op text, p_payload jsonb,
                            p_uid uuid default null, p_role text default 'authenticated')
returns text language plpgsql as $$
begin
  perform pg_temp.call(p_key, p_op, p_payload, p_uid, p_role);
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

-- Everything a save can touch. Compared whole, never output.
create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'bills', (select count(*) from public.bills b where b.notes like 'BSAVE%'),
    'items', (select count(*) from public.bill_items i join public.bills b using (billid) where b.notes like 'BSAVE%'),
    'stock', (select jsonb_object_agg(variantid, stock) from public.productsizecolors where productid like 'BSAVE%'),
    'credit', (select jsonb_object_agg(customerid, store_credit) from public.customers where customerid in (-9001, -9002)),
    'ledger', (select count(*) from public.store_credit_ledger where customerid in (-9001, -9002)),
    'vouchers', (select jsonb_object_agg(voucher_id, jsonb_build_array(redeemed, redeemed_billid)) from public.vouchers where voucher_id like 'BSAVE%'),
    'exchanges', (select jsonb_object_agg(exchangeid, new_billid) from public.exchanges where exchangeid in (-9001, -9002)),
    'usage', (select count(*) from public.discount_usage where customerid in (-9001, -9002)),
    'payments', (select count(*) from public.bill_payments p join public.bills b using (billid) where b.notes like 'BSAVE%'),
    'salespersons', (select count(*) from public.bill_salespersons where salesperson_id = -9001),
    'moves', (select count(*) from public.bill_stock_moves where idempotency_key::text like 'b5a7e000-%'),
    'log', (select count(*) from public.bill_save_log where idempotency_key::text like 'b5a7e000-%'),
    'counters', (select jsonb_object_agg(financial_year || document_type, last_value) from public.bill_sequences))
$$;

create function pg_temp.stock(p_v uuid) returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = p_v
$$;

create function pg_temp.item(p_v uuid, p_qty numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('billid', null, 'quantity', p_qty, 'mrp', 1000, 'variantid', p_v,
    'product_name', 'BSAVE item', 'product_code', 'BSAVEP1', 'category', null, 'cost_price', 400,
    'alteration_charge', 0, 'discount_total', 0, 'subtotal', 1000, 'gst_rate', null,
    'gst_amount', 0, 'total', 1000, 'stitch_type', 'unstitched', 'unit_type', 'piece',
    'salesperson_id', null)
$$;

create function pg_temp.final_pl(p_v uuid, p_qty numeric default 1, p_extra jsonb default '{}', p_bill jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'bill', jsonb_build_object('customerid', -9001, 'notes', 'BSAVE', 'document_type', 'bos',
      'totalamount', 1000, 'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000,
      'paymentstatus', 'finalized', 'finalized', true, 'applied_codes', '[]'::jsonb,
      'payment_amount', 1000, 'store_credit_used', 0, 'exchange_credit_used', 0,
      'exchange_source_bill', null, 'exchange_cash_refund', 0, 'saleslocationid', -9001,
      'salesmethodid', -9001, 'orderdate', '2026-11-04T00:00:00+05:30') || p_bill,
    'items', jsonb_build_array(pg_temp.item(p_v, p_qty))) || p_extra
$$;

create function pg_temp.partial_pl(p_v uuid, p_qty numeric default 1, p_extra jsonb default '{}', p_bill jsonb default '{}')
returns jsonb language sql as $$
  select pg_temp.final_pl(p_v, p_qty, p_extra,
    jsonb_build_object('paymentstatus', 'partial', 'net_amount', 1000, 'final_amount', null,
                       'payment_amount', 0) || p_bill)
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values
    (pg_temp.admin_id(), 'bsave-admin@example.invalid'),
    (pg_temp.customer_id(), 'bsave-customer@example.invalid'),
    (pg_temp.inactive_id(), 'bsave-inactive@example.invalid');
  insert into public.profiles (id, email, role, is_active) values
    (pg_temp.admin_id(), 'bsave-admin@example.invalid', 'admin', true),
    (pg_temp.customer_id(), 'bsave-customer@example.invalid', 'user', true),
    (pg_temp.inactive_id(), 'bsave-inactive@example.invalid', 'admin', false)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

  insert into public.customers (customerid, customer_ulid, first_name, store_credit) values
    (-9001, 'BSAVEFIXTURE00000000000001', 'Fixture', 500),
    (-9002, 'BSAVEFIXTURE00000000000002', 'Fixture', 50);
  insert into public.salespersons (salesperson_id, name) values (-9001, 'Fixture');
  insert into public.salesmethods (salesmethodid, methodname) values (-9001, 'BSAVE method');
  insert into public.saleslocations (saleslocationid, locationname) values (-9001, 'BSAVE location');
  insert into public.discounts (code, type, value) values ('BSAVE-TEST', 'flat', 10);

  -- Live has foreign keys from variants to these two tables, and the harness has neither.
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('BSAVE'), ('BSAVE2'), ('BSAVE0') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('BSAVE', 'BSAVE', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('BSAVEP1', 'Fixture', 400, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('BSAVEP1', 'BSAVE', 'BSAVE', 100, pg_temp.v1()),
    ('BSAVEP1', 'BSAVE', 'BSAVE2', 5, pg_temp.v2()),
    ('BSAVEP1', 'BSAVE', 'BSAVE0', 0, pg_temp.v0());

  insert into public.vouchers (voucher_id, customerid, expiry_date, value) values
    ('BSAVE-GOOD', -9001, current_date + 30, 100),
    ('BSAVE-EXPIRED', -9001, current_date - 1, 100);
  insert into public.vouchers (voucher_id, customerid, expiry_date, value, redeemed) values
    ('BSAVE-USED', -9001, current_date + 30, 100, true);
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount) values
    (-9001, 1, -9001, 100), (-9002, 1, -9001, 100);
end $$;

-- ---------- row 1: unknown discount code, then the fixed retry; row 6: lost response; row 7: changed payload ----------
do $$
declare
  before jsonb := pg_temp.state();
  stock0 numeric := pg_temp.stock(pg_temp.v1());
  full_pl jsonb;
  r jsonb;
  after jsonb;
begin
  full_pl := pg_temp.final_pl(pg_temp.v1(), 2,
    jsonb_build_object('voucher_id', 'BSAVE-GOOD', 'exchange_ids', jsonb_build_array(-9001),
                       'salesperson_ids', jsonb_build_array(-9001), 'discount_codes', jsonb_build_array('BSAVE-NOPE')),
    '{"store_credit_used": 100}');
  perform pg_temp.ok('row1 bad code refused',
    pg_temp.try(pg_temp.k(1), 'finalize_create', full_pl) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('row1 nothing changed', pg_temp.state() = before);

  full_pl := full_pl || '{"discount_codes": ["BSAVE-TEST"]}';
  r := pg_temp.call(pg_temp.k(1), 'finalize_create', full_pl);
  perform pg_temp.ok('row1 retry saved', (r ->> 'replayed')::boolean = false and r ->> 'billid' is not null);
  perform pg_temp.ok('row1 one bill', (pg_temp.state() ->> 'bills')::int = (before ->> 'bills')::int + 1);
  perform pg_temp.ok('row1 number from trigger',
    (select bill_number from public.bills where billid = (r ->> 'billid')::int) = r ->> 'bill_number');
  perform pg_temp.ok('row1 one item', (select count(*) from public.bill_items where billid = (r ->> 'billid')::int) = 1);
  perform pg_temp.ok('row1 one stock move', pg_temp.stock(pg_temp.v1()) = stock0 - 2);
  perform pg_temp.ok('row1 stock ledger row', (
    select count(*) from public.bill_stock_moves m
     where m.billid = (r ->> 'billid')::int and m.variantid = pg_temp.v1() and m.delta = -2
       and m.stock_after = stock0 - 2 and m.reason = 'bill_finalize' and m.idempotency_key = pg_temp.k(1)) = 1);
  perform pg_temp.ok('row1 voucher redeemed for this bill', (
    select redeemed and redeemed_billid = (r ->> 'billid')::int and redeemed_at is not null
      from public.vouchers where voucher_id = 'BSAVE-GOOD'));
  perform pg_temp.ok('row1 exchange linked',
    (select new_billid from public.exchanges where exchangeid = -9001) = (r ->> 'billid')::int);
  perform pg_temp.ok('row1 usage row', (
    select count(*) from public.discount_usage
     where customerid = -9001 and code = 'BSAVE-TEST' and billid = (r ->> 'billid')::int) = 1);
  perform pg_temp.ok('row1 salesperson row',
    (select count(*) from public.bill_salespersons where billid = (r ->> 'billid')::int and salesperson_id = -9001) = 1);
  perform pg_temp.ok('row1 credit moved once', (select store_credit from public.customers where customerid = -9001) = 400);
  perform pg_temp.ok('row1 credit ledger as today', (
    select count(*) from public.store_credit_ledger l
     where l.customerid = -9001 and l.delta = -100 and l.balance_after = 400 and l.source = 'instore'
       and l.reason = 'bill_finalize' and l.ref_type = 'bill' and l.ref_id = r ->> 'billid') = 1);
  perform pg_temp.ok('row1 log holds result', (
    select l.billid = (r ->> 'billid')::int and l.result = r and l.op = 'finalize_create'
           and l.actor_id = pg_temp.admin_id()
      from public.bill_save_log l where l.idempotency_key = pg_temp.k(1)));

  -- row 6: the same request again, as after a lost response
  after := pg_temp.state();
  perform pg_temp.ok('row6 replayed flag',
    (pg_temp.call(pg_temp.k(1), 'finalize_create', full_pl) ->> 'replayed')::boolean);
  perform pg_temp.ok('row6 replay returns same bill',
    pg_temp.call(pg_temp.k(1), 'finalize_create', full_pl) - 'replayed' = r - 'replayed');
  perform pg_temp.ok('row6 no second write', pg_temp.state() = after);

  -- row 7: same key, changed payload
  perform pg_temp.ok('row7 conflict',
    pg_temp.try(pg_temp.k(1), 'finalize_create', full_pl || '{"skip_stock": true}') = 'BILL_KEY_CONFLICT');
  perform pg_temp.ok('row7 same payload under other op conflicts too',
    pg_temp.try(pg_temp.k(1), 'partial_create', full_pl) = 'BILL_KEY_CONFLICT');
  perform pg_temp.ok('row7 first bill unchanged', pg_temp.state() = after);

  -- the exchange above is taken now
  perform pg_temp.ok('exchange double spend refused',
    pg_temp.try(pg_temp.k(2), 'finalize_create',
      pg_temp.final_pl(pg_temp.v1(), 1, '{"exchange_ids": [-9001]}')) = 'BILL_EXCHANGE_USED');
  perform pg_temp.ok('exchange double spend wrote nothing', pg_temp.state() = after);
end $$;

-- ---------- rows 2, 3, 4: voucher, salesperson and item failures, then one good retry each ----------
do $$
declare
  before jsonb := pg_temp.state();
  stock0 numeric := pg_temp.stock(pg_temp.v1());
  r jsonb;
begin
  perform pg_temp.ok('row2 expired voucher refused',
    pg_temp.try(pg_temp.k(3), 'finalize_create',
      pg_temp.final_pl(pg_temp.v1(), 1, '{"voucher_id": "BSAVE-EXPIRED"}')) = 'BILL_VOUCHER_REFUSED');
  perform pg_temp.ok('row2 used voucher refused',
    pg_temp.try(pg_temp.k(3), 'finalize_create',
      pg_temp.final_pl(pg_temp.v1(), 1, '{"voucher_id": "BSAVE-USED"}')) = 'BILL_VOUCHER_REFUSED');
  perform pg_temp.ok('row2 nothing changed', pg_temp.state() = before);
  r := pg_temp.call(pg_temp.k(3), 'finalize_create', pg_temp.final_pl(pg_temp.v1()));
  perform pg_temp.ok('row2 retry one bill', (pg_temp.state() ->> 'bills')::int = (before ->> 'bills')::int + 1);
  perform pg_temp.ok('row2 retry one move', pg_temp.stock(pg_temp.v1()) = stock0 - 1);

  before := pg_temp.state();
  perform pg_temp.ok('row3 bad salesperson refused',
    pg_temp.try(pg_temp.k(4), 'finalize_create',
      pg_temp.final_pl(pg_temp.v1(), 1, '{"salesperson_ids": [-9999]}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('row3 nothing changed', pg_temp.state() = before);
  r := pg_temp.call(pg_temp.k(4), 'finalize_create', pg_temp.final_pl(pg_temp.v1()));
  perform pg_temp.ok('row3 retry one bill', (pg_temp.state() ->> 'bills')::int = (before ->> 'bills')::int + 1);

  before := pg_temp.state();
  perform pg_temp.ok('row4 null subtotal refused',
    pg_temp.try(pg_temp.k(5), 'finalize_create', jsonb_set(pg_temp.final_pl(pg_temp.v1()), '{items,0,subtotal}', 'null')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('row4 nothing changed', pg_temp.state() = before);
  r := pg_temp.call(pg_temp.k(5), 'finalize_create', pg_temp.final_pl(pg_temp.v1()));
  perform pg_temp.ok('row4 retry one bill', (pg_temp.state() ->> 'bills')::int = (before ->> 'bills')::int + 1);
end $$;

-- ---------- row 8: tick on; row 9: stock goes negative; lines totalled per variant ----------
do $$
declare
  s1 numeric := pg_temp.stock(pg_temp.v1());
  r jsonb;
begin
  r := pg_temp.call(pg_temp.k(6), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{"skip_stock": true}'));
  perform pg_temp.ok('row8 stock unmoved', pg_temp.stock(pg_temp.v1()) = s1);
  perform pg_temp.ok('row8 marker row', (
    select count(*) from public.bill_stock_moves m
     where m.billid = (r ->> 'billid')::int and m.variantid = pg_temp.v1()
       and m.delta = 0 and m.stock_after = s1) = 1);
  perform pg_temp.ok('row8 nothing flagged', r -> 'negative_stock' = '[]'::jsonb);

  r := pg_temp.call(pg_temp.k(7), 'finalize_create', pg_temp.final_pl(pg_temp.v0()));
  perform pg_temp.ok('row9 saved with stock -1', pg_temp.stock(pg_temp.v0()) = -1);
  perform pg_temp.ok('row9 flagged', r -> 'negative_stock'
    = jsonb_build_array(jsonb_build_object('variantid', pg_temp.v0(), 'stock', -1.000)));

  r := pg_temp.call(pg_temp.k(8), 'finalize_create',
    jsonb_set(pg_temp.final_pl(pg_temp.v2()), '{items}',
      jsonb_build_array(pg_temp.item(pg_temp.v2(), 1.5), pg_temp.item(pg_temp.v2(), 0.25))));
  perform pg_temp.ok('lines totalled per variant, fractional', pg_temp.stock(pg_temp.v2()) = 3.25);
  perform pg_temp.ok('one move per variant', (
    select count(*) from public.bill_stock_moves where billid = (r ->> 'billid')::int and delta = -1.75) = 1);
  perform pg_temp.ok('both lines kept', (select count(*) from public.bill_items where billid = (r ->> 'billid')::int) = 2);
end $$;

-- ---------- row 10: payment failure keeps stock; row 11: nothing paid ----------
do $$
declare
  before jsonb := pg_temp.state();
  s1 numeric := pg_temp.stock(pg_temp.v1());
  r jsonb;
  pay_ok jsonb := '{"amount": 200, "salesmethodid": -9001, "recorded_at": "2026-11-01T12:00:00"}';
begin
  perform pg_temp.ok('row10 amount 0 refused',
    pg_temp.try(pg_temp.k(9), 'partial_create',
      pg_temp.partial_pl(pg_temp.v1(), 1, jsonb_build_object('first_payment', '{"amount": 0, "salesmethodid": -9001}'::jsonb))) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('row10 bad method refused',
    pg_temp.try(pg_temp.k(9), 'partial_create',
      pg_temp.partial_pl(pg_temp.v1(), 1, jsonb_build_object('first_payment', '{"amount": 200, "salesmethodid": -9999}'::jsonb),
                         '{"payment_amount": 200}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('row10 nothing saved, stock not lost', pg_temp.state() = before);

  r := pg_temp.call(pg_temp.k(9), 'partial_create',
    pg_temp.partial_pl(pg_temp.v1(), 1, jsonb_build_object('first_payment', pay_ok), '{"payment_amount": 200}'));
  perform pg_temp.ok('row10 retry one bill', (pg_temp.state() ->> 'bills')::int = (before ->> 'bills')::int + 1);
  perform pg_temp.ok('row10 retry one move', pg_temp.stock(pg_temp.v1()) = s1 - 1);
  perform pg_temp.ok('row10 retry one payment', (
    select count(*) from public.bill_payments
     where billid = (r ->> 'billid')::int and amount = 200 and salesmethodid = -9001
       and recorded_at = '2026-11-01 12:00:00'::timestamp) = 1);
  perform pg_temp.ok('row10 result carries the payment',
    r -> 'payment' ->> 'amount' = '200.00' and r -> 'payment' -> 'salesmethods' ->> 'methodname' = 'BSAVE method');

  r := pg_temp.call(pg_temp.k(10), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1, '{}', '{"payment_amount": 0}'));
  perform pg_temp.ok('row11 finalized and partial', (
    select finalized and paymentstatus = 'partial' and payment_amount = 0 and net_amount = 1000 and final_amount is null
      from public.bills where billid = (r ->> 'billid')::int));
  perform pg_temp.ok('row11 no payment row', (select count(*) from public.bill_payments where billid = (r ->> 'billid')::int) = 0);
  perform pg_temp.ok('row11 stock moved', pg_temp.stock(pg_temp.v1()) = s1 - 2);
  perform pg_temp.ok('row11 reason', (select reason from public.bill_stock_moves where billid = (r ->> 'billid')::int) = 'bill_partial_finalize');
end $$;

-- ---------- store credit floor and exchange balance, as on the screen ----------
do $$
declare
  r jsonb;
begin
  r := pg_temp.call(pg_temp.k(11), 'finalize_create',
    pg_temp.final_pl(pg_temp.v1(), 1, '{"exchange_balance_to_credit": 75.555}', '{"customerid": -9002, "store_credit_used": 80}'));
  perform pg_temp.ok('credit floor: bill keeps the client figure',
    (select store_credit_used from public.bills where billid = (r ->> 'billid')::int) = 80);
  perform pg_temp.ok('credit floor: only the balance is taken', (
    select count(*) from public.store_credit_ledger
     where customerid = -9002 and delta = -50 and balance_after = 0 and reason = 'bill_finalize' and ref_id = r ->> 'billid') = 1);
  perform pg_temp.ok('exchange balance added after, rounded as store_credit_adjust', (
    select count(*) from public.store_credit_ledger
     where customerid = -9002 and delta = 75.56 and balance_after = 75.56 and reason = 'exchange_credit' and ref_id = r ->> 'billid') = 1);
  perform pg_temp.ok('credit balance', (select store_credit from public.customers where customerid = -9002) = 75.56);

  r := pg_temp.call(pg_temp.k(12), 'partial_create',
    pg_temp.partial_pl(pg_temp.v1(), 1, '{}', '{"customerid": -9002, "store_credit_used": 10.5}'));
  perform pg_temp.ok('partial credit reason', (
    select count(*) from public.store_credit_ledger
     where customerid = -9002 and delta = -10.5 and reason = 'bill_partial_finalize' and ref_id = r ->> 'billid') = 1);

  r := pg_temp.call(pg_temp.k(13), 'finalize_create',
    pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"customerid": null, "store_credit_used": 10}'));
  perform pg_temp.ok('no customer, no credit move', (
    select count(*) from public.store_credit_ledger where ref_id = r ->> 'billid') = 0);
end $$;

-- ---------- refused requests: unsupported ops, refused keys, structure ----------
do $$
declare
  before jsonb := pg_temp.state();
  good jsonb := pg_temp.final_pl(pg_temp.v1());
  op text;
begin
  foreach op in array array['draft_create', 'draft_update', 'finalize_update', 'partial_update', 'nonsense'] loop
    perform pg_temp.ok('op refused: ' || op, pg_temp.try(pg_temp.k(20), op, good) = 'BILL_BAD_PAYLOAD');
  end loop;
  perform pg_temp.ok('null op refused', pg_temp.try(pg_temp.k(20), null, good) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('null key refused', pg_temp.try(null, 'finalize_create', good) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('bill_number refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"bill_number": "FY26-999999"}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('bill.billid refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"billid": 1}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('top level billid refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', good || '{"billid": 1}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown bill key refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"totalamuont": 1}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown item key refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', jsonb_set(good, '{items,0,bill_item_id}', '1')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('item billid refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', jsonb_set(good, '{items,0,billid}', '1')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown payload key refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', good || '{"surprise": 1}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('no items refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', good || '{"items": []}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('quantity 0 refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 0)) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('non numeric total refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"totalamount": "abc"}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('wrong status for op refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"paymentstatus": "partial"}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('not finalized refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"finalized": false}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('payment on finalize refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', good || '{"first_payment": {"amount": 1, "salesmethodid": -9001}}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('exchange balance on partial refused',
    pg_temp.try(pg_temp.k(20), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1, '{"exchange_balance_to_credit": 5}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown variant refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', pg_temp.final_pl('b5a7e000-0000-4000-8000-1000000000ff')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown exchange refused',
    pg_temp.try(pg_temp.k(20), 'finalize_create', good || '{"exchange_ids": [-9999]}') = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('code without customer refused, as discount_usage requires one',
    pg_temp.try(pg_temp.k(20), 'finalize_create',
      pg_temp.final_pl(pg_temp.v1(), 1, '{"discount_codes": ["BSAVE-TEST"]}', '{"customerid": null}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('refused requests wrote nothing', pg_temp.state() = before);
end $$;

-- ---------- row 24: access ----------
do $$
declare
  before jsonb := pg_temp.state();
  good jsonb := pg_temp.final_pl(pg_temp.v1());
  n bigint;
begin
  perform pg_temp.ok('row24 customer refused', pg_temp.try(pg_temp.k(30), 'finalize_create', good, pg_temp.customer_id()) = '42501');
  perform pg_temp.ok('row24 inactive admin refused', pg_temp.try(pg_temp.k(30), 'finalize_create', good, pg_temp.inactive_id()) = '42501');
  perform pg_temp.ok('row24 anon refused', pg_temp.try(pg_temp.k(30), 'finalize_create', good, null, 'anon') = '42501');
  perform pg_temp.ok('row24 no writes', pg_temp.state() = before);
  -- past the access check: the refusal comes from the op check instead
  perform pg_temp.ok('row24 service role passes the access check',
    pg_temp.try(pg_temp.k(30), 'nonsense', good, null, 'service_role') = 'BILL_BAD_PAYLOAD');

  perform pg_temp.ok('grants: bill_save',
    has_function_privilege('authenticated', 'public.bill_save(uuid,text,jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.bill_save(uuid,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.bill_save(uuid,text,jsonb)', 'execute'));
  perform pg_temp.ok('grants: claim helper is private',
    not has_function_privilege('authenticated', 'public._bill_claim_key(uuid,text,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public._bill_claim_key(uuid,text,jsonb)', 'execute'));
  perform pg_temp.ok('tables: row security on, no policies', (
    select bool_and(c.relrowsecurity)
           and not exists (select 1 from pg_policies p where p.tablename in ('bill_save_log', 'bill_stock_moves'))
      from pg_class c where c.oid in ('public.bill_save_log'::regclass, 'public.bill_stock_moves'::regclass)));
  perform pg_temp.ok('tables: grants like the credit ledger',
    has_table_privilege('authenticated', 'public.bill_save_log', 'select')
    and not has_table_privilege('authenticated', 'public.bill_save_log', 'insert')
    and not has_table_privilege('authenticated', 'public.bill_stock_moves', 'insert')
    and not has_table_privilege('anon', 'public.bill_save_log', 'select')
    and not has_table_privilege('anon', 'public.bill_stock_moves', 'select'));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.admin_id(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.bill_save_log;
  perform set_config('role', 'none', true);
  perform pg_temp.ok('tables: staff read no rows directly', n = 0);
end $$;

-- ---------- row 26: number series and financial year, as the trigger gives ----------
do $$
declare
  doc text;
  c record;
  n int;
  i int := 40;
  want text;
  r jsonb;
begin
  foreach doc in array array['bos', 'invoice'] loop
    for c in select * from (values
        ('2026-03-31T00:00:00+05:30', '25', '2026-03-31'),
        ('2026-04-01T00:00:00+05:30', '26', '2026-04-01')) as t(sent, fy, day) loop
      select coalesce(max(last_value), 0) + 1 into n from public.bill_sequences
       where financial_year = c.fy and document_type = doc;
      want := case when doc = 'invoice' then 'FY' || c.fy || '-SG' || lpad(n::text, 4, '0')
                   else 'FY' || c.fy || '-' || lpad(n::text, 6, '0') end;
      i := i + 1;
      r := pg_temp.call(pg_temp.k(i), 'finalize_create',
        pg_temp.final_pl(pg_temp.v1(), 1, '{"skip_stock": true}',
          jsonb_build_object('document_type', doc, 'orderdate', c.sent)));
      perform pg_temp.ok('row26 number ' || doc || ' ' || c.day, r ->> 'bill_number' = want);
      perform pg_temp.ok('row26 date kept ' || doc || ' ' || c.day,
        (select orderdate from public.bills where billid = (r ->> 'billid')::int) = c.day::timestamp);
      perform pg_temp.ok('row26 type kept ' || doc || ' ' || c.day,
        (select document_type from public.bills where billid = (r ->> 'billid')::int) = doc);
    end loop;
  end loop;
end $$;

-- ---------- row 27: stored values match a direct insert of the same JSON, digit for digit ----------
do $$
declare
  bill_txt text := '{"customerid": -9001, "notes": "BSAVE direct", "document_type": "invoice",
    "totalamount": 1234.5649999999999, "gst_total": 0.30000000000000004, "discount_total": 99.995,
    "taxable_total": 1234.565, "paymentstatus": "partial", "finalized": true, "applied_codes": ["BSAVE-TEST"],
    "payment_amount": 100.005, "net_amount": 1.005, "final_amount": 2.675, "store_credit_used": 0,
    "exchange_credit_used": 12.345, "exchange_source_bill": "FY26-TEST", "exchange_cash_refund": 3.335,
    "saleslocationid": -9001, "salesmethodid": -9001, "orderdate": "2026-04-01T00:00:00+05:30"}';
  item_txt text := '{"quantity": 1.2345, "mrp": 1000.555, "variantid": null, "product_name": "BSAVE item",
    "product_code": "BSAVEP1", "category": "X", "cost_price": 500.005, "alteration_charge": 10.005,
    "discount_total": 3.335, "subtotal": 999.995, "gst_rate": 5.005, "gst_amount": 49.995, "total": 999.995,
    "stitch_type": "stitched", "unit_type": "metre", "salesperson_id": -9001}';
  pay_set_txt text := '{"amount": 100.005, "salesmethodid": -9001, "recorded_at": "2026-11-01T12:00:00"}';
  r jsonb;
  rpc_id int;
  direct_id int;
  drop_keys text[] := array['billid', 'bill_number', 'pdf_url'];
begin
  r := pg_temp.call(pg_temp.k(50), 'partial_create', jsonb_build_object(
    'bill', bill_txt::jsonb, 'items', jsonb_build_array(item_txt::jsonb), 'first_payment', pay_set_txt::jsonb));
  rpc_id := (r ->> 'billid')::int;

  -- What PostgREST does: a typed record from the JSON text, with only the keys sent.
  insert into public.bills (customerid, notes, document_type, totalamount, gst_total, discount_total, taxable_total,
      paymentstatus, finalized, applied_codes, payment_amount, net_amount, final_amount, store_credit_used,
      exchange_credit_used, exchange_source_bill, exchange_cash_refund, saleslocationid, salesmethodid, orderdate)
    select customerid, notes, document_type, totalamount, gst_total, discount_total, taxable_total,
      paymentstatus, finalized, applied_codes, payment_amount, net_amount, final_amount, store_credit_used,
      exchange_credit_used, exchange_source_bill, exchange_cash_refund, saleslocationid, salesmethodid, orderdate
    from json_populate_record(null::public.bills, bill_txt::json)
    returning billid into direct_id;
  insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code, category, cost_price,
      alteration_charge, discount_total, subtotal, gst_rate, gst_amount, total, stitch_type, unit_type, salesperson_id)
    select direct_id, quantity, mrp, variantid, product_name, product_code, category, cost_price,
      alteration_charge, discount_total, subtotal, gst_rate, gst_amount, total, stitch_type, unit_type, salesperson_id
    from json_populate_record(null::public.bill_items, item_txt::json);
  -- bill_payments takes rows only with the marker bill_save sets (migration_bill_payments_ledger.sql).
  perform set_config('app.bill_payment_writer', 'on', true);
  insert into public.bill_payments (billid, amount, salesmethodid, recorded_at)
    select direct_id, amount, salesmethodid, recorded_at
    from json_populate_record(null::public.bill_payments, pay_set_txt::json);
  perform set_config('app.bill_payment_writer', '', true);

  perform pg_temp.ok('row27 bill equals direct insert',
    (select to_jsonb(b) - drop_keys from public.bills b where billid = rpc_id)
    = (select to_jsonb(b) - drop_keys from public.bills b where billid = direct_id));
  perform pg_temp.ok('row27 item equals direct insert',
    (select to_jsonb(i) - array['billid', 'bill_item_id'] from public.bill_items i where billid = rpc_id)
    = (select to_jsonb(i) - array['billid', 'bill_item_id'] from public.bill_items i where billid = direct_id));
  perform pg_temp.ok('row27 payment set equals direct insert',
    (select to_jsonb(p) - array['billid', 'payment_id'] from public.bill_payments p where billid = rpc_id)
    = (select to_jsonb(p) - array['billid', 'payment_id'] from public.bill_payments p where billid = direct_id));
  perform pg_temp.ok('row27 known rounding', (
    select totalamount = 1234.56 and taxable_total = 1234.57 and discount_total = 100.00 and orderdate = '2026-04-01'::timestamp
      from public.bills where billid = rpc_id));

  -- recorded_at absent, then null: the database clock, as a direct insert gets
  r := pg_temp.call(pg_temp.k(51), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1,
    '{"skip_stock": true, "first_payment": {"amount": 5, "salesmethodid": -9001}}', '{"payment_amount": 5}'));
  perform pg_temp.ok('row27 recorded_at absent uses the clock',
    (select recorded_at from public.bill_payments where billid = (r ->> 'billid')::int) = current_timestamp::timestamp);
  r := pg_temp.call(pg_temp.k(52), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1,
    '{"skip_stock": true, "first_payment": {"amount": 5, "salesmethodid": -9001, "recorded_at": null}}',
    '{"payment_amount": 5}'));
  perform pg_temp.ok('row27 recorded_at null uses the clock',
    (select recorded_at from public.bill_payments where billid = (r ->> 'billid')::int) = current_timestamp::timestamp);

  -- absent keys take the column defaults, on both tables
  r := pg_temp.call(pg_temp.k(53), 'finalize_create', jsonb_build_object(
    'bill', '{"notes": "BSAVE defaults", "paymentstatus": "finalized", "finalized": true}'::jsonb,
    'items', '[{"quantity": 1, "mrp": 1, "subtotal": 1, "gst_amount": 0, "total": 1}]'::jsonb));
  perform pg_temp.ok('row27 bill defaults', (
    select store_credit_used = 0 and exchange_credit_used = 0 and exchange_cash_refund = 0
           and applied_codes = '{}'::text[] and document_type = 'bos' and customerid is null
           and orderdate = current_timestamp::timestamp and net_amount is null and final_amount is null
           and payment_amount is null and salesperson_ids = '{}'::int[] and pdf_url is null
      from public.bills where billid = (r ->> 'billid')::int));
  perform pg_temp.ok('row27 item defaults', (
    select alteration_charge = 0 and discount_total = 0 and stitch_type = 'unstitched' and unit_type = 'piece'
           and variantid is null and cost_price is null and gst_rate is null
      from public.bill_items where billid = (r ->> 'billid')::int));
end $$;

-- ---------- app callers (migration_bill_save_app_callers.sql) ----------
do $$
declare
  r jsonb;
begin
  -- stock_reduced records the skip_stock choice, so cancelling restores only what left.
  r := pg_temp.call(pg_temp.k(60), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{"skip_stock": true}'));
  perform pg_temp.ok('app: skip_stock saves stock_reduced false',
    (select stock_reduced is false from public.bills where billid = (r ->> 'billid')::int));
  r := pg_temp.call(pg_temp.k(61), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1));
  perform pg_temp.ok('app: moving stock saves stock_reduced true',
    (select stock_reduced is true from public.bills where billid = (r ->> 'billid')::int));
  perform pg_temp.ok('app: stock_reduced is not a bill key',
    pg_temp.try(pg_temp.k(62), 'finalize_create', pg_temp.final_pl(pg_temp.v1(), 1, '{}', '{"stock_reduced": false}'))
      = 'BILL_BAD_PAYLOAD');

  -- A part-paid bill's payment_amount is its first payment, since that is its only row.
  perform pg_temp.ok('app: payment_amount above the first payment refused',
    pg_temp.try(pg_temp.k(63), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1,
      '{"first_payment": {"amount": 200, "salesmethodid": -9001}}', '{"payment_amount": 1000}')) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('app: payment_amount without a first payment refused',
    pg_temp.try(pg_temp.k(64), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1, '{}', '{"payment_amount": 200}'))
      = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('app: refused saves left no key',
    not exists (select 1 from public.bill_save_log where idempotency_key in (pg_temp.k(62), pg_temp.k(63), pg_temp.k(64))));
  r := pg_temp.call(pg_temp.k(65), 'partial_create', pg_temp.partial_pl(pg_temp.v1(), 1,
    '{"first_payment": {"amount": 200, "salesmethodid": -9001}}', '{"payment_amount": 200}'));
  perform pg_temp.ok('app: matching first payment saved',
    (select payment_amount = 200 from public.bills where billid = (r ->> 'billid')::int)
    and (select sum(amount) = 200 from public.bill_payments where billid = (r ->> 'billid')::int));
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _bs_checks;
rollback;
