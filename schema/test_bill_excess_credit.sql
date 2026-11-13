-- Tests for schema/migration_bill_edit_excess.sql (bill_edit) and the excess guard in
-- schema/migration_bill_payments_ledger.sql. An edit that leaves the shop holding more than the
-- bill's new net is refunded or put on store credit, once, and a later cancel refunds only what
-- the shop still holds. The whole file is one transaction that always rolls back, and its final
-- select returns only pass and fail counts. A failed check also raises a WARNING naming it.
-- Run locally (every bill migration, in this order):
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_bill_save.sql \
--     schema/migration_bill_stock_reduced.sql schema/migration_bill_cancel.sql \
--     schema/migration_bill_cancel_exchange_payout.sql schema/migration_bill_save_app_callers.sql \
--     schema/migration_bill_cancel_marker.sql schema/migration_bill_status_states.sql \
--     schema/migration_bill_add_payment.sql schema/migration_bill_edit_excess.sql \
--     schema/migration_bill_payments_ledger.sql schema/migration_bill_item_exchange_lock.sql \
--     schema/test_bill_excess_credit.sql
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _ex_checks (label text not null, passed boolean not null) on commit drop;
grant all on _ex_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _ex_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('e0ce5500-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'e0ce5500-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'e0ce5500-0000-4000-8000-100000000001'::uuid $$;

-- Runs p_sql as an admin through the API would. Returns 'ok', the P0001 error code, or the
-- SQLSTATE; an error undoes it.
create function pg_temp.as_admin(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.admin_id(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

-- Exercise table invariants without RLS short-circuiting the statement first.
create function pg_temp.as_owner(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

-- The same for an RPC returning jsonb; raises on error.
create function pg_temp.rpc(p_sql text) returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.admin_id(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into r;
  perform set_config('role', 'none', true);
  return r;
end $$;

create function pg_temp.item() returns jsonb language sql as $$
  select jsonb_build_object('quantity', 1, 'mrp', 1000, 'variantid', pg_temp.v1(),
    'product_name', 'EX item', 'product_code', 'EXP1', 'subtotal', 1000, 'gst_amount', 0, 'total', 1000)
$$;

-- A new 1000 bill as the screen saves it: paid in one go, or part-paid with a first payment.
create function pg_temp.save(p_key int, p_paid numeric, p_partial boolean, p_customer int default -9601)
returns int language sql as $$
  select (pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key),
    case when p_partial then 'partial_create' else 'finalize_create' end,
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', p_customer, 'notes', 'EXCESS', 'totalamount', 1000,
        'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000,
        'paymentstatus', case when p_partial then 'partial' else 'finalized' end,
        'finalized', true, 'payment_amount', p_paid, 'net_amount', 1000, 'salesmethodid', -9601),
      'items', jsonb_build_array(pg_temp.item()))
    || case when p_partial then jsonb_build_object('first_payment',
         jsonb_build_object('amount', p_paid, 'salesmethodid', -9601)) else '{}'::jsonb end)) ->> 'billid')::int
$$;

-- bill_edit payload as BillingForm.handleSaveDraft sends it: expect from the opened bill, every
-- bill column, and the excess choice (null when there is none).
create function pg_temp.payload(p_b int, p_net numeric, p_status text, p_excess jsonb default null,
                                p_customer int default -9601)
returns jsonb language sql as $$
  select jsonb_build_object(
    'expect', (select jsonb_build_object('paymentstatus', b.paymentstatus, 'payment_amount', b.payment_amount)
                 from public.bills b where b.billid = p_b),
    'bill', (select jsonb_build_object('customerid', p_customer, 'notes', 'EXCESS edit',
               'totalamount', p_net, 'gst_total', 0, 'discount_total', 0, 'taxable_total', p_net,
               'net_amount', p_net, 'applied_codes', '[]'::jsonb, 'payment_amount', b.payment_amount,
               'final_amount', null, 'saleslocationid', null, 'salesmethodid', -9601,
               'paymentstatus', p_status, 'finalized', true, 'store_credit_used', 0,
               'orderdate', '2026-11-12T00:00:00+05:30')
               from public.bills b where b.billid = p_b),
    'excess', p_excess)
$$;

create function pg_temp.edit_sql(p_key int, p_b int, p_payload jsonb) returns text language sql as $$
  select format('select public.bill_edit(%L, %s, %L)', pg_temp.k(p_key), p_b, p_payload)
$$;

create function pg_temp.credit(p_c int) returns numeric language sql as $$
  select round(store_credit::numeric, 2) from public.customers where customerid = p_c
$$;
create function pg_temp.held(p_b int) returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.bill_payments where billid = p_b
$$;
create function pg_temp.bill(p_b int) returns public.bills language sql as $$
  select * from public.bills where billid = p_b
$$;
create function pg_temp.cancel_sql(p_key int, p_b int, p_mode text) returns text language sql as $$
  select format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(p_key), p_b, p_mode,
    (select jsonb_build_object('expect', jsonb_build_object('finalized', b.finalized, 'paymentstatus', b.paymentstatus))
       from public.bills b where b.billid = p_b))
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'excess-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'excess-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit) values
    (-9601, 'EXCESSFIXTURE0000000000001', 'Fixture', 0),
    (-9602, 'EXCESSFIXTURE0000000000002', 'Other', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9601, 'EXCESS cash'), (-9602, 'EXCESS upi');
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('EXCESS') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('EXCESS', 'EXCESS', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('EXP1', 'Fixture', 400, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid)
  values ('EXP1', 'EXCESS', 'EXCESS', 100, pg_temp.v1());
end $$;
-- What the live admin policies allow staff on these tables.
grant select, insert, update, delete on public.bills, public.bill_payments to authenticated;
grant usage on sequence public.bill_payments_payment_id_seq to authenticated;

-- ---------- 1. part-paid bill edited below what was paid: store credit, exactly once ----------
do $$
declare
  b int := pg_temp.save(1, 600, true);
  p jsonb;
  r jsonb;
begin
  p := pg_temp.payload(b, 400, 'finalized', '{"mode": "store_credit", "amount": 200}');
  r := pg_temp.rpc(pg_temp.edit_sql(2, b, p));
  perform pg_temp.ok('1 credit result names the amount', (r -> 'excess' ->> 'amount')::numeric = 200
    and r -> 'excess' ->> 'mode' = 'store_credit' and (r -> 'excess' ->> 'customerid')::int = -9601);
  perform pg_temp.ok('1 customer credited 200', pg_temp.credit(-9601) = 200);
  perform pg_temp.ok('1 ledger row for the credit', (select count(*) from public.store_credit_ledger
    where customerid = -9601 and reason = 'bill_edit_excess' and ref_id = b::text and delta = 200) = 1);
  perform pg_temp.ok('1 credit row on the bill', (select count(*) from public.bill_payments
    where billid = b and kind = 'store_credit' and amount = -200 and salesmethodid is null) = 1);
  perform pg_temp.ok('1 bill holds 400 and is paid', pg_temp.held(b) = 400
    and (pg_temp.bill(b)).payment_amount = 400 and (pg_temp.bill(b)).paymentstatus = 'finalized'
    and (pg_temp.bill(b)).net_amount = 400);

  -- Replay of the same call (response lost): first result, nothing credited again.
  r := pg_temp.rpc(pg_temp.edit_sql(2, b, p));
  perform pg_temp.ok('1 replay returns the first result', (r ->> 'replayed')::boolean
    and (r -> 'excess' ->> 'amount')::numeric = 200);
  perform pg_temp.ok('1 replay credits nothing more', pg_temp.credit(-9601) = 200
    and (select count(*) from public.bill_payments where billid = b) = 2);
  -- A retry under a new key from the window as it was opened: the bill has moved.
  perform pg_temp.ok('1 stale retry refused', pg_temp.as_admin(pg_temp.edit_sql(3, b, p)) = 'BILL_STALE');
  perform pg_temp.ok('1 stale retry credits nothing', pg_temp.credit(-9601) = 200);

  -- Edited back up: the credit is final, the bill is owed the difference.
  perform pg_temp.ok('1 edit up claiming paid refused',
    pg_temp.as_admin(pg_temp.edit_sql(4, b, pg_temp.payload(b, 900, 'finalized'))) = 'BILL_PAYMENTS_MISMATCH');
  r := pg_temp.rpc(pg_temp.edit_sql(5, b, pg_temp.payload(b, 900, 'partial')));
  perform pg_temp.ok('1 edit up leaves 500 due', (pg_temp.bill(b)).paymentstatus = 'partial'
    and pg_temp.held(b) = 400 and pg_temp.credit(-9601) = 200);
  perform pg_temp.ok('1 add_payment over the 500 due refused', pg_temp.as_admin(format(
    'select public.bill_add_payment(%L, %s, 600, -9601, null)', pg_temp.k(6), b)) = 'BILL_OVERPAID');
  perform pg_temp.ok('1 add_payment of the 500 due', pg_temp.as_admin(format(
    'select public.bill_add_payment(%L, %s, 500, -9601, null)', pg_temp.k(7), b)) = 'ok');
  perform pg_temp.ok('1 bill paid, credit untouched', (pg_temp.bill(b)).paymentstatus = 'finalized'
    and pg_temp.held(b) = 900 and pg_temp.credit(-9601) = 200);
end $$;

-- ---------- 2. bill paid in one go, cash refund ----------
do $$
declare
  b int := pg_temp.save(10, 1000, false);
  r jsonb;
begin
  perform pg_temp.ok('2 no payment rows before', (select count(*) from public.bill_payments where billid = b) = 0);
  r := pg_temp.rpc(pg_temp.edit_sql(11, b, pg_temp.payload(b, 600, 'finalized',
         '{"mode": "refund", "amount": 400, "salesmethodid": -9602}')));
  perform pg_temp.ok('2 opening row records what was received', (select count(*) from public.bill_payments
    where billid = b and kind = 'payment' and amount = 1000 and salesmethodid = -9601) = 1);
  perform pg_temp.ok('2 refund row with its method', (select count(*) from public.bill_payments
    where billid = b and kind = 'refund' and amount = -400 and salesmethodid = -9602) = 1);
  perform pg_temp.ok('2 bill holds 600 and is paid', pg_temp.held(b) = 600
    and (pg_temp.bill(b)).payment_amount = 600 and (pg_temp.bill(b)).paymentstatus = 'finalized');
  perform pg_temp.ok('2 refund leaves store credit alone', pg_temp.credit(-9601) = 200);
  perform pg_temp.ok('2 refund result', r -> 'excess' ->> 'mode' = 'refund'
    and (r -> 'excess' ->> 'amount')::numeric = 400 and r -> 'excess' -> 'customerid' = 'null'::jsonb);

  -- Cancel after the refund: only the 600 still held goes back.
  r := pg_temp.rpc(pg_temp.cancel_sql(12, b, 'return_payment'));
  perform pg_temp.ok('2 cancel refunds 600, not 1000', (r ->> 'refund')::numeric = 600);
end $$;

-- ---------- 3. cancel after store credit ----------
do $$
declare
  b int;
  r jsonb;
begin
  update public.customers set store_credit = 0 where customerid = -9602;
  b := pg_temp.save(20, 1000, false, -9602);
  perform pg_temp.rpc(pg_temp.edit_sql(21, b, pg_temp.payload(b, 600, 'finalized',
    '{"mode": "store_credit", "amount": 400}', -9602)));
  perform pg_temp.ok('3 credited 400', pg_temp.credit(-9602) = 400);
  r := pg_temp.rpc(pg_temp.cancel_sql(22, b, 'store_credit'));
  perform pg_temp.ok('3 cancel credits only the 600 held', (r ->> 'refund')::numeric = 600
    and (r ->> 'credit_added')::numeric = 600);
  perform pg_temp.ok('3 customer ends with the 1000 paid, not more', pg_temp.credit(-9602) = 1000);

  -- The same with a cash cancel: 600 back in cash, the 400 credit stays.
  update public.customers set store_credit = 0 where customerid = -9602;
  b := pg_temp.save(23, 1000, true, -9602);
  perform pg_temp.rpc(pg_temp.edit_sql(24, b, pg_temp.payload(b, 300, 'finalized',
    '{"mode": "store_credit", "amount": 700}', -9602)));
  r := pg_temp.rpc(pg_temp.cancel_sql(25, b, 'return_payment'));
  perform pg_temp.ok('3 cash cancel refunds 300', (r ->> 'refund')::numeric = 300);
  perform pg_temp.ok('3 cash cancel keeps the 700 credit', pg_temp.credit(-9602) = 700);
end $$;

-- ---------- 4. the choice must match the excess ----------
do $$
declare
  b int := pg_temp.save(30, 1000, false);
begin
  perform pg_temp.ok('4 no choice refused', pg_temp.as_admin(pg_temp.edit_sql(31, b,
    pg_temp.payload(b, 600, 'finalized'))) = 'BILL_EXCESS_UNSETTLED');
  perform pg_temp.ok('4 wrong amount refused', pg_temp.as_admin(pg_temp.edit_sql(32, b,
    pg_temp.payload(b, 600, 'finalized', '{"mode": "store_credit", "amount": 300}'))) = 'BILL_EXCESS_CHANGED');
  perform pg_temp.ok('4 choice without excess refused', pg_temp.as_admin(pg_temp.edit_sql(33, b,
    pg_temp.payload(b, 1000, 'finalized', '{"mode": "store_credit", "amount": 0}'))) = 'BILL_EXCESS_CHANGED');
  perform pg_temp.ok('4 refund without a method refused', pg_temp.as_admin(pg_temp.edit_sql(34, b,
    pg_temp.payload(b, 600, 'finalized', '{"mode": "refund", "amount": 400}'))) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('4 under a rupee over needs no choice', pg_temp.as_admin(pg_temp.edit_sql(35, b,
    pg_temp.payload(b, 999.5, 'finalized'))) = 'ok');
  perform pg_temp.ok('4 refusals left the bill alone', pg_temp.held(b) = 0
    and (pg_temp.bill(b)).payment_amount = 1000 and (pg_temp.bill(b)).net_amount = 999.5);
  perform pg_temp.ok('4 missing bill key refused', pg_temp.as_admin(pg_temp.edit_sql(36, b,
    pg_temp.payload(b, 1000, 'finalized') #- '{bill,notes}')) = 'BILL_BAD_PAYLOAD');
end $$;

-- ---------- 5. walk-in: refund only ----------
do $$
declare
  b int := pg_temp.save(40, 1000, false, null);
begin
  perform pg_temp.ok('5 walk-in store credit refused', pg_temp.as_admin(pg_temp.edit_sql(41, b,
    pg_temp.payload(b, 600, 'finalized', '{"mode": "store_credit", "amount": 400}', null)))
    = 'BILL_EXCESS_NEEDS_CUSTOMER');
  perform pg_temp.ok('5 walk-in refused: nothing written', pg_temp.held(b) = 0
    and (pg_temp.bill(b)).net_amount = 1000);
  perform pg_temp.ok('5 walk-in cash refund', pg_temp.as_admin(pg_temp.edit_sql(42, b,
    pg_temp.payload(b, 600, 'finalized', '{"mode": "refund", "amount": 400, "salesmethodid": -9601}', null))) = 'ok'
    and pg_temp.held(b) = 600);
  -- Customer attached in the same edit: the credit goes to them.
  b := pg_temp.save(43, 1000, false, null);
  update public.customers set store_credit = 0 where customerid = -9602;
  perform pg_temp.ok('5 customer attached in the edit gets the credit', pg_temp.as_admin(pg_temp.edit_sql(44, b,
    pg_temp.payload(b, 600, 'finalized', '{"mode": "store_credit", "amount": 400}', -9602))) = 'ok'
    and pg_temp.credit(-9602) = 400 and (pg_temp.bill(b)).customerid = -9602);
end $$;

-- ---------- 6. a payment and an edit on one bill: whichever is second sees the first ----------
do $$
declare
  b int := pg_temp.save(50, 600, true);
  p jsonb;
begin
  update public.customers set store_credit = 0 where customerid = -9601;
  p := pg_temp.payload(b, 400, 'finalized', '{"mode": "store_credit", "amount": 200}');
  perform pg_temp.as_admin(format('select public.bill_add_payment(%L, %s, 400, -9601, null)', pg_temp.k(51), b));
  perform pg_temp.ok('6 edit after a payment it did not see refused',
    pg_temp.as_admin(pg_temp.edit_sql(52, b, p)) = 'BILL_STALE');
  perform pg_temp.ok('6 nothing credited', pg_temp.credit(-9601) = 0 and pg_temp.held(b) = 1000);

  b := pg_temp.save(53, 600, true);
  perform pg_temp.rpc(pg_temp.edit_sql(54, b, pg_temp.payload(b, 400, 'finalized',
    '{"mode": "store_credit", "amount": 200}')));
  perform pg_temp.ok('6 payment after the settling edit refused', pg_temp.as_admin(format(
    'select public.bill_add_payment(%L, %s, 400, -9601, null)', pg_temp.k(55), b)) = 'BILL_NOTHING_DUE');
  perform pg_temp.ok('6 bill holds 400, customer has 200', pg_temp.held(b) = 400 and pg_temp.credit(-9601) = 200);
end $$;

-- ---------- 7. the credit is spent on a new bill through the usual save ----------
do $$
declare
  r jsonb;
begin
  -- -9601 holds 200 from section 6.
  r := pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(60), 'finalize_create',
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', -9601, 'notes', 'EXCESS spend', 'totalamount', 1000,
        'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000, 'paymentstatus', 'finalized',
        'finalized', true, 'payment_amount', 800, 'net_amount', 800, 'store_credit_used', 200,
        'salesmethodid', -9601),
      'items', jsonb_build_array(pg_temp.item()))));
  perform pg_temp.ok('7 credit spent on a new bill', pg_temp.credit(-9601) = 0);
end $$;

-- ---------- 8. nothing else can drop a paid bill below what it holds ----------
do $$
declare
  b int := pg_temp.save(70, 1000, false);
  c int := pg_temp.save(71, 600, true);
begin
  perform pg_temp.ok('8 direct update of a bill paid in one go refused', pg_temp.as_admin(format(
    'update public.bills set net_amount = 600, totalamount = 600 where billid = %s', b)) = 'BILL_EXCESS_UNSETTLED');
  perform pg_temp.ok('8 direct update of a part-paid bill refused', pg_temp.as_admin(format(
    'update public.bills set net_amount = 400 where billid = %s', c)) = 'BILL_EXCESS_UNSETTLED');
  -- Since schema/migration_bill_money_rpc_only.sql even that goes through bill_edit only.
  perform pg_temp.ok('8 direct update under a rupee below what is held passes', pg_temp.as_admin(format(
    'update public.bills set net_amount = 999.5 where billid = %s', b))
      = case when to_regproc('public._bills_money_via_rpc') is null then 'ok' else 'BILL_MONEY_DIRECT' end);
  perform pg_temp.ok('8 direct refund row refused', pg_temp.as_admin(format(
    'insert into public.bill_payments (billid, amount, salesmethodid, kind) values (%s, -100, -9601, %L)',
    c, 'refund')) = 'BILL_PAYMENT_DIRECT');
  perform pg_temp.ok('8 payment kind cannot change', pg_temp.as_admin(format(
    'update public.bill_payments set kind = %L where billid = %s', 'refund', c)) = 'BILL_PAYMENT_LOCKED');
  -- The kinds keep their signs and methods even for the RPCs.
  perform set_config('app.bill_payment_writer', 'on', true);
  perform pg_temp.ok('8 negative payment refused', pg_temp.as_admin(format(
    'insert into public.bill_payments (billid, amount, salesmethodid) values (%s, -5, -9601)', c)) = '23514');
  perform pg_temp.ok('8 credit row with a method refused', pg_temp.as_admin(format(
    'insert into public.bill_payments (billid, amount, salesmethodid, kind) values (%s, -5, -9601, %L)',
    c, 'store_credit')) = '23514');
  perform set_config('app.bill_payment_writer', '', true);
end $$;

-- ---------- 9. drafts save as before, with no money to settle ----------
do $$
declare
  b int;
begin
  insert into public.bills (notes, paymentstatus, finalized, net_amount, payment_amount, customerid)
  values ('EXCESS draft', 'draft', false, 1000, 1000, -9601) returning billid into b;
  -- A saved draft has its lines; the total cannot be above them.
  insert into public.bill_items (billid, quantity, mrp, product_name, subtotal, gst_amount, total)
  values (b, 1, 1000, 'EXCESS item', 1000, 0, 1000);
  perform pg_temp.ok('9 draft edit down needs no choice', pg_temp.as_admin(pg_temp.edit_sql(80, b,
    jsonb_set(pg_temp.payload(b, 400, 'draft'), '{bill,finalized}', 'false'))) = 'ok'
    and (pg_temp.bill(b)).net_amount = 400 and pg_temp.held(b) = 0);
  perform pg_temp.ok('9 anon cannot call it',
    not has_function_privilege('anon', 'public.bill_edit(uuid, int, jsonb)', 'execute'));
end $$;

-- ---------- 10. a returned line cannot be erased and paid out again ----------
do $$
declare
  b int := pg_temp.save(90, 1000, false);
  bi int;
begin
  select bill_item_id into bi from public.bill_items where billid = b;
  insert into public.exchanges
    (original_bill_item_id, quantity, reason, customerid, credit_amount)
  values (bi, 1, 'EXCESS already paid as exchange credit', -9601, 1000);

  perform pg_temp.ok('10 exchanged bill item delete refused', pg_temp.as_owner(format(
    'delete from public.bill_items where bill_item_id = %s', bi)) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('10 sold line and exchange history both remain',
    exists (select 1 from public.bill_items where bill_item_id = bi)
    and exists (select 1 from public.exchanges where original_bill_item_id = bi));

  -- The screen deletes all lines before calculating an edit payout. Refusing that first step
  -- means no bill, payment or customer-credit write can follow.
  perform pg_temp.ok('10 no second payout was recorded', pg_temp.held(b) = 0
    and pg_temp.credit(-9601) = 0 and (pg_temp.bill(b)).net_amount = 1000);
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _ex_checks;
rollback;
