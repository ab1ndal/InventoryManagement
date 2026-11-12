-- Tests for schema/migration_bill_add_payment.sql. The whole file is one transaction that
-- always rolls back, it creates its own fixtures, and its final select returns only pass and
-- fail counts. A failed check also raises a WARNING naming that check.
-- Run locally (orders comes from the online orders migrations):
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_bill_save.sql \
--     schema/migration_bill_stock_reduced.sql schema/migration_bill_status_states.sql \
--     schema/migration_bill_add_payment.sql schema/test_bill_add_payment.sql
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _bp_checks (label text not null, passed boolean not null) on commit drop;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _bp_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

-- Every key this file uses shares one prefix.
create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('bada9000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'bada9000-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.customer_id() returns uuid language sql as $$ select 'bada9000-0000-4000-8000-a00000000002'::uuid $$;

-- Calls the RPC the way PostgREST would: JWT claims set, role switched only for the call.
create function pg_temp.call(p_key uuid, p_billid int, p_amount numeric, p_method int default -9401,
                             p_at timestamp default null, p_uid uuid default null,
                             p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', coalesce(p_uid, pg_temp.admin_id()), 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  r := public.bill_add_payment(p_key, p_billid, p_amount, p_method, p_at);
  perform set_config('role', 'none', true);
  return r;
end $$;

-- 'ok', the P0001 error code, or the SQLSTATE. The error undoes the call and the role switch.
create function pg_temp.try(p_key uuid, p_billid int, p_amount numeric, p_method int default -9401,
                            p_uid uuid default null, p_role text default 'authenticated')
returns text language plpgsql as $$
begin
  perform pg_temp.call(p_key, p_billid, p_amount, p_method, null, p_uid, p_role);
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

-- A bill in the given state with its earlier payments, written straight to the tables. A
-- cancelled one is cancelled after its payments, as bill_cancel would leave it.
create function pg_temp.bill(p_status text, p_net numeric, p_paid numeric[] default '{}')
returns int language plpgsql as $$
declare
  b int;
  a numeric;
begin
  insert into public.bills (notes, paymentstatus, finalized, net_amount, salesmethodid)
  values ('BPAY', case when p_status = 'cancelled' then 'partial' else p_status end,
          p_status <> 'draft', p_net, null)
  returning billid into b;
  foreach a in array p_paid loop
    insert into public.bill_payments (billid, amount, salesmethodid) values (b, a, -9402);
  end loop;
  if p_status = 'cancelled' then
    update public.bills set paymentstatus = 'cancelled' where billid = b;
  end if;
  return b;
end $$;

create function pg_temp.payments(p_b int) returns int language sql as $$
  select count(*)::int from public.bill_payments where billid = p_b
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values
    (pg_temp.admin_id(), 'bpay-admin@example.invalid'),
    (pg_temp.customer_id(), 'bpay-customer@example.invalid');
  insert into public.profiles (id, email, role, is_active) values
    (pg_temp.admin_id(), 'bpay-admin@example.invalid', 'admin', true),
    (pg_temp.customer_id(), 'bpay-customer@example.invalid', 'user', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.salesmethods (salesmethodid, methodname) values
    (-9401, 'BPAY cash'), (-9402, 'BPAY upi');
end $$;

-- ---------- access ----------
do $$
declare
  b int := pg_temp.bill('partial', 1000);
begin
  perform pg_temp.ok('anon refused', pg_temp.try(pg_temp.k(1), b, 100, -9401, null, 'anon') = '42501');
  perform pg_temp.ok('shopper refused',
    pg_temp.try(pg_temp.k(1), b, 100, -9401, pg_temp.customer_id()) = '42501');
  perform pg_temp.ok('access: no payment recorded', pg_temp.payments(b) = 0);
end $$;

-- ---------- only part-paid and paid bills take a payment ----------
do $$
declare
  t record;
  b int;
  n int := 10;
begin
  for t in select * from (values ('draft'), ('cancelled')) v(st) loop
    n := n + 1;
    b := pg_temp.bill(t.st, 1000);
    perform pg_temp.ok(format('%s bill refused', t.st), pg_temp.try(pg_temp.k(n), b, 100) = 'BILL_NOT_PAYABLE');
    perform pg_temp.ok(format('%s bill: no payment recorded', t.st), pg_temp.payments(b) = 0);
    perform pg_temp.ok(format('%s bill: status unchanged', t.st),
      (select paymentstatus from public.bills where billid = b) = t.st);
  end loop;
  perform pg_temp.ok('missing bill refused', pg_temp.try(pg_temp.k(13), -1, 100) = 'BILL_BAD_PAYLOAD');
end $$;

-- ---------- paid in full: the same cases as paymentHelpers.test.js ("same rule as SQL") ----------
do $$
declare
  t record;
  b int;
  r jsonb;
  n int := 20;
begin
  for t in select * from (values
      -- net, payments already recorded, new payment, status, remaining
      (1500.08, array[500]::numeric[], 1000, 'finalized', 0),     -- paise short counts as paid
      (1500.99, array[500]::numeric[], 1000, 'finalized', 0),
      (1501.00, array[500]::numeric[], 1000, 'partial', 1),       -- a whole rupee short does not
      (2000.00, array[]::numeric[], 500, 'partial', 1500),
      (1000.00, array[600]::numeric[], 600, 'finalized', 0)) v(net, paid, amt, st, remaining)
  loop
    n := n + 1;
    b := pg_temp.bill('partial', t.net, t.paid);
    r := pg_temp.call(pg_temp.k(n), b, t.amt);
    perform pg_temp.ok(format('net %s paid %s + %s -> %s', t.net, t.paid, t.amt, t.st),
      r ->> 'paymentstatus' = t.st and (r ->> 'remaining')::numeric = t.remaining);
    perform pg_temp.ok(format('net %s paid %s + %s: bill row matches', t.net, t.paid, t.amt),
      (select paymentstatus = t.st and finalized and payment_amount = (r ->> 'total_paid')::numeric
         from public.bills where billid = b));
  end loop;
end $$;

-- ---------- status comes from every payment row, not the caller's list ----------
do $$
declare
  b int := pg_temp.bill('partial', 1000, array[300]::numeric[]);
  r jsonb;
begin
  -- Another screen records 400 the old way after this one loaded the bill.
  insert into public.bill_payments (billid, amount, salesmethodid) values (b, 400, -9402);
  r := pg_temp.call(pg_temp.k(31), b, 300);
  perform pg_temp.ok('stale screen: all rows counted, bill paid',
    r ->> 'paymentstatus' = 'finalized' and (r ->> 'total_paid')::numeric = 1000);
end $$;

-- ---------- payment row, method and date ----------
do $$
declare
  b int := pg_temp.bill('partial', 1000);
  r jsonb;
begin
  r := pg_temp.call(pg_temp.k(41), b, 200, -9401, '2026-11-01 12:00:00');
  perform pg_temp.ok('payment row returned with method name',
    (r -> 'payment' ->> 'amount')::numeric = 200
    and (r -> 'payment' ->> 'salesmethodid')::int = -9401
    and r -> 'payment' -> 'salesmethods' ->> 'methodname' = 'BPAY cash');
  perform pg_temp.ok('given date stored',
    (select recorded_at from public.bill_payments where billid = b) = '2026-11-01 12:00:00');
  perform pg_temp.ok('first payment sets the bill method',
    (select salesmethodid from public.bills where billid = b) = -9401);
  perform pg_temp.call(pg_temp.k(42), b, 100, -9402);
  perform pg_temp.ok('later payment keeps the bill method',
    (select salesmethodid from public.bills where billid = b) = -9401);
  perform pg_temp.ok('no date recorded as now',
    (select max(recorded_at) from public.bill_payments where billid = b) > localtimestamp - interval '1 minute');
end $$;

-- ---------- idempotency ----------
do $$
declare
  b int := pg_temp.bill('partial', 1000);
  r1 jsonb;
  r2 jsonb;
begin
  r1 := pg_temp.call(pg_temp.k(51), b, 250);
  r2 := pg_temp.call(pg_temp.k(51), b, 250);
  perform pg_temp.ok('retry replays', (r2 ->> 'replayed')::boolean
    and r2 - 'replayed' = r1 - 'replayed');
  perform pg_temp.ok('retry records one payment', pg_temp.payments(b) = 1);
  perform pg_temp.ok('same key, other amount refused', pg_temp.try(pg_temp.k(51), b, 300) = 'BILL_KEY_CONFLICT');
  perform pg_temp.ok('key conflict: still one payment', pg_temp.payments(b) = 1);
end $$;

-- ---------- bad input and online bills ----------
do $$
declare
  b int := pg_temp.bill('partial', 1000);
begin
  perform pg_temp.ok('zero amount refused', pg_temp.try(pg_temp.k(61), b, 0) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('unknown method refused', pg_temp.try(pg_temp.k(62), b, 100, -1) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('null amount refused', pg_temp.try(pg_temp.k(63), b, null) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('bad input: no payment, key released',
    pg_temp.payments(b) = 0
    and not exists (select 1 from public.bill_save_log where idempotency_key in (pg_temp.k(61), pg_temp.k(62))));

  insert into public.orders (order_ref, contact_name, contact_phone, address, subtotal, gateway_amount, bill_id)
  values ('BPAY-TEST', 'BPAY', '9999999999', '{}'::jsonb, 1000, 1000, b);
  perform pg_temp.ok('online bill refused', pg_temp.try(pg_temp.k(64), b, 100) = 'BILL_ONLINE');
  perform pg_temp.ok('online: no payment', pg_temp.payments(b) = 0);
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _bp_checks;
rollback;
