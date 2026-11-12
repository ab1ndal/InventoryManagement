-- Credit or money taken twice: one check per hole the 2026-11-12 verifier found, each written as
-- an admin would try it through the API (authenticated role, direct table writes or RPCs).
-- The whole file is one transaction that always rolls back, and its final select returns only
-- pass and fail counts. A failed check also raises a WARNING naming that check.
--   1. Deleting a finalized bill freed its exchange credit and voucher to be spent again.
--   2. A screen opened before a payment saved its stale total and status over it.
--   3. A payment above the balance, or on a paid bill, was accepted.
--   4. A bill set to cancelled directly skipped what bill_cancel undoes, and stayed editable.
--   5. bill_payments rows could be inserted, changed or deleted around the RPCs.
-- Run locally (every bill migration, in this order):
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_bill_save.sql \
--     schema/migration_bill_stock_reduced.sql schema/migration_bill_cancel.sql \
--     schema/migration_bill_cancel_exchange_payout.sql schema/migration_bill_save_app_callers.sql \
--     schema/migration_bill_cancel_marker.sql schema/migration_bill_status_states.sql \
--     schema/migration_bill_add_payment.sql schema/migration_bill_payments_ledger.sql \
--     schema/test_bill_double_cash.sql
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _dc_checks (label text not null, passed boolean not null) on commit drop;
grant all on _dc_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _dc_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('dc5a0000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'dc5a0000-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'dc5a0000-0000-4000-8000-100000000001'::uuid $$;

-- Runs p_sql as an admin through the API would: JWT claims set, authenticated role for the
-- statement only. Returns 'ok', the P0001 error code, or the SQLSTATE; an error undoes it.
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
    'product_name', 'DC item', 'product_code', 'DCP1', 'subtotal', 1000, 'gst_amount', 0, 'total', 1000)
$$;

-- What the bill screen sends for a new bill: finalize_create, or partial_create with a deposit.
create function pg_temp.save(p_key int, p_op text, p_extra jsonb default '{}', p_bill jsonb default '{}')
returns jsonb language sql as $$
  select pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key), p_op,
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', -9501, 'notes', 'DCASH', 'totalamount', 1000,
        'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000,
        'paymentstatus', case when p_op = 'partial_create' then 'partial' else 'finalized' end,
        'finalized', true, 'payment_amount', 1000, 'net_amount', 1000, 'salesmethodid', -9501) || p_bill,
      'items', jsonb_build_array(pg_temp.item())) || p_extra))
$$;

create function pg_temp.pay(p_key int, p_b int, p_amount numeric) returns text language sql as $$
  select pg_temp.as_admin(format('select public.bill_add_payment(%L, %s, %s, -9501, null)',
                                 pg_temp.k(p_key), p_b, p_amount))
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'dcash-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'dcash-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9501, 'DCASHFIXTURE00000000000001', 'Fixture', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9501, 'DCASH cash');
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('DCASH') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('DCASH', 'DCASH', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('DCP1', 'Fixture', 400, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid)
  values ('DCP1', 'DCASH', 'DCASH', 100, pg_temp.v1());
  insert into public.vouchers (voucher_id, customerid, expiry_date, value)
  values ('DCASH-V', -9501, current_date + 30, 100);
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount) values (-9501, 1, -9501, 300);
end $$;
-- What the live admin policies allow staff on these tables.
grant select, insert, update, delete on public.bills, public.bill_payments, public.vouchers to authenticated;
grant usage on sequence public.bill_payments_payment_id_seq to authenticated;

-- ---------- 1. a finalized bill cannot be deleted, so its credit stays spent ----------
do $$
declare
  r jsonb;
  b int;
begin
  r := pg_temp.save(1, 'finalize_create', '{"exchange_ids": [-9501]}',
                    '{"exchange_credit_used": 300, "payment_amount": 700}');
  b := (r ->> 'billid')::int;
  perform pg_temp.ok('1 delete of a finalized bill refused',
    pg_temp.as_admin(format('delete from public.bills where billid = %s', b)) = 'BILL_BAD_TRANSITION');
  perform pg_temp.ok('1 exchange credit still spent on the bill',
    (select new_billid from public.exchanges where exchangeid = -9501) = b);
  perform pg_temp.ok('1 the exchange credit cannot be spent again',
    pg_temp.as_admin(format('select public.bill_save(%L, %L, %L)', pg_temp.k(2), 'finalize_create',
      jsonb_build_object('bill', '{"customerid": -9501, "notes": "DCASH", "paymentstatus": "finalized", "finalized": true}'::jsonb,
                         'items', jsonb_build_array(pg_temp.item()), 'exchange_ids', '[-9501]'::jsonb)))
      = 'BILL_EXCHANGE_USED');

  -- A voucher's foreign key already blocked this delete; the screen released the voucher first.
  r := pg_temp.save(4, 'finalize_create', '{"voucher_id": "DCASH-V"}', '{"payment_amount": 900}');
  b := (r ->> 'billid')::int;
  perform pg_temp.as_admin(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null where redeemed_billid = %s', b));
  perform pg_temp.ok('1 delete after releasing the voucher refused',
    pg_temp.as_admin(format('delete from public.bills where billid = %s', b)) = 'BILL_BAD_TRANSITION');

  r := pg_temp.save(3, 'partial_create', '{"first_payment": {"amount": 200, "salesmethodid": -9501}}',
                    '{"payment_amount": 200}');
  perform pg_temp.ok('1 delete of a part-paid bill refused',
    pg_temp.as_admin(format('delete from public.bills where billid = %s', r ->> 'billid')) = 'BILL_BAD_TRANSITION');
  perform pg_temp.ok('1 part-paid bill keeps its payment',
    (select count(*) from public.bill_payments where billid = (r ->> 'billid')::int) = 1);

  insert into public.bills (notes, paymentstatus, finalized) values ('DCASH draft', 'draft', false) returning billid into b;
  perform pg_temp.ok('1 a draft can still be deleted',
    pg_temp.as_admin(format('delete from public.bills where billid = %s', b)) = 'ok');
  perform pg_temp.ok('1 the draft is gone', not exists (select 1 from public.bills where billid = b));
end $$;

-- ---------- 2. a stale screen cannot write over a payment ----------
do $$
declare
  r jsonb;
  b int;
begin
  -- Net 1000, 200 paid. Screen A opens it; screen B then takes the other 800.
  r := pg_temp.save(10, 'partial_create', '{"first_payment": {"amount": 200, "salesmethodid": -9501}}',
                    '{"payment_amount": 200}');
  b := (r ->> 'billid')::int;
  perform pg_temp.ok('2 screen B pays the rest', pg_temp.pay(11, b, 800) = 'ok');
  perform pg_temp.ok('2 paid in full now',
    (select paymentstatus = 'finalized' and payment_amount = 1000 from public.bills where billid = b));
  -- Screen A saves an item edit with what it loaded: partial, 200 received.
  perform pg_temp.ok('2 stale save refused',
    pg_temp.as_admin(format($q$update public.bills set paymentstatus = 'partial', finalized = true,
                                 payment_amount = 200, net_amount = 1000, notes = 'DCASH edited' where billid = %s$q$, b))
      = 'BILL_PAYMENTS_MISMATCH');
  perform pg_temp.ok('2 bill still paid in full',
    (select paymentstatus = 'finalized' and payment_amount = 1000 and notes = 'DCASH' from public.bills where billid = b));
  perform pg_temp.ok('2 status alone cannot be set back', pg_temp.as_admin(format(
    $q$update public.bills set paymentstatus = 'partial' where billid = %s$q$, b)) = 'BILL_PAYMENTS_MISMATCH');
  perform pg_temp.ok('2 total alone cannot be lowered', pg_temp.as_admin(format(
    'update public.bills set payment_amount = 200 where billid = %s', b)) = 'BILL_PAYMENTS_MISMATCH');
  perform pg_temp.ok('2 an edit leaving the payment fields alone still saves', pg_temp.as_admin(format(
    $q$update public.bills set notes = 'DCASH edited', totalamount = 1000 where billid = %s$q$, b)) = 'ok');
  -- A return by edit (owner rule for part-paid bills): net drops to 600, status follows the payments.
  perform pg_temp.ok('2 an edit consistent with the payments saves', pg_temp.as_admin(format(
    $q$update public.bills set net_amount = 600, payment_amount = 1000, paymentstatus = 'finalized' where billid = %s$q$, b)) = 'ok');
end $$;

-- ---------- 3. no payment past the balance ----------
do $$
declare
  r jsonb;
  b int;
begin
  r := pg_temp.save(20, 'partial_create', '{"first_payment": {"amount": 200, "salesmethodid": -9501}}',
                    '{"payment_amount": 200}');
  b := (r ->> 'billid')::int;
  perform pg_temp.ok('3 overpayment refused', pg_temp.pay(21, b, 5000) = 'BILL_OVERPAID');
  perform pg_temp.ok('3 balance accepted', pg_temp.pay(22, b, 800) = 'ok');
  perform pg_temp.ok('3 paid bill refuses more', pg_temp.pay(23, b, 500) = 'BILL_NOTHING_DUE');
  perform pg_temp.ok('3 1000 received, no more',
    (select sum(amount) from public.bill_payments where billid = b) = 1000);

  r := pg_temp.save(24, 'finalize_create');
  perform pg_temp.ok('3 bill paid in one go refuses a payment',
    pg_temp.pay(25, (r ->> 'billid')::int, 500) = 'BILL_NOTHING_DUE');
end $$;

-- ---------- 4. only bill_cancel cancels, and a cancelled bill is locked ----------
do $$
declare
  r jsonb;
  b int;
begin
  r := pg_temp.save(30, 'finalize_create');
  b := (r ->> 'billid')::int;
  perform pg_temp.ok('4 direct cancel refused', pg_temp.as_admin(format(
    $q$update public.bills set paymentstatus = 'cancelled' where billid = %s$q$, b)) = 'BILL_BAD_TRANSITION');
  perform pg_temp.ok('4 stock still out after the refused cancel',
    (select stock from public.productsizecolors where variantid = pg_temp.v1()) < 100);

  perform pg_temp.ok('4 bill_cancel cancels', pg_temp.as_admin(format('select public.bill_cancel(%L, %s, %L, %L)',
    pg_temp.k(31), b, 'store_credit', '{"expect": {"finalized": true, "paymentstatus": "finalized"}}')) = 'ok');
  perform pg_temp.ok('4 bill is cancelled', (select paymentstatus from public.bills where billid = b) = 'cancelled');
  perform pg_temp.ok('4 cancelled bill: amounts locked', pg_temp.as_admin(format(
    'update public.bills set payment_amount = 99999, net_amount = 1 where billid = %s', b)) = 'BILL_BAD_TRANSITION');
  perform pg_temp.ok('4 cancelled bill: PDF path still updates', pg_temp.as_admin(format(
    $q$update public.bills set pdf_url = 'bill-x.pdf' where billid = %s$q$, b)) = 'ok');
  perform pg_temp.ok('4 cancelled bill cannot be deleted', pg_temp.as_admin(format(
    'delete from public.bills where billid = %s', b)) = 'BILL_BAD_TRANSITION');
end $$;

-- ---------- 5. bill_payments only through the RPCs ----------
do $$
declare
  r jsonb;
  b int;
  p int;
begin
  r := pg_temp.save(40, 'partial_create', '{"first_payment": {"amount": 200, "salesmethodid": -9501}}',
                    '{"payment_amount": 200}');
  b := (r ->> 'billid')::int;
  p := (r -> 'payment' ->> 'payment_id')::int;
  perform pg_temp.ok('5 direct payment insert refused', pg_temp.as_admin(format(
    'insert into public.bill_payments (billid, amount, salesmethodid) values (%s, 800, -9501)', b)) = 'BILL_PAYMENT_DIRECT');
  perform pg_temp.ok('5 payment delete refused', pg_temp.as_admin(format(
    'delete from public.bill_payments where payment_id = %s', p)) = 'BILL_PAYMENT_LOCKED');
  perform pg_temp.ok('5 payment amount change refused', pg_temp.as_admin(format(
    'update public.bill_payments set amount = 1 where payment_id = %s', p)) = 'BILL_PAYMENT_LOCKED');
  perform pg_temp.ok('5 payment date can be corrected', pg_temp.as_admin(format(
    $q$update public.bill_payments set recorded_at = '2026-11-01 12:00:00' where payment_id = %s$q$, p)) = 'ok');
  perform pg_temp.ok('5 still one payment of 200, bill partial',
    (select count(*) = 1 and sum(amount) = 200 from public.bill_payments where billid = b)
    and (select paymentstatus = 'partial' and payment_amount = 200 from public.bills where billid = b));
  perform pg_temp.ok('5 the marker is off after the RPC', current_setting('app.bill_payment_writer', true) is distinct from 'on');
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _dc_checks;
rollback;
