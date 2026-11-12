-- Tests for schema/migration_bill_status_states.sql. The whole file is one transaction that
-- always rolls back, and its final select returns only pass and fail counts.
-- A failed check also raises a WARNING naming that check.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_bill_stock_reduced.sql \
--     schema/migration_bill_status_states.sql schema/test_bill_status_states.sql
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

-- 'ok', the P0001 message, or the SQLSTATE of whatever the statement raised.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

-- A bill in the given state. A cancelled one is made the only way allowed, by cancelling a draft
-- or finalized bill.
create function pg_temp.bill(p_status text, p_finalized boolean) returns int language plpgsql as $$
declare
  b int;
begin
  insert into public.bills (notes, paymentstatus, finalized)
  values ('BSTATE', case when p_status <> 'cancelled' then p_status
                         when p_finalized then 'finalized' else 'draft' end, p_finalized)
  returning billid into b;
  if p_status = 'cancelled' then
    update public.bills set paymentstatus = 'cancelled' where billid = b;
  end if;
  return b;
end $$;

-- Writes the state and reports the outcome; a refused write leaves the row as it was.
create function pg_temp.move(p_b int, p_status text, p_finalized boolean) returns text language sql as $$
  select pg_temp.try(format('update public.bills set paymentstatus = %L, finalized = %L where billid = %s',
                            p_status, p_finalized, p_b))
$$;

-- Inserts: draft, partial and finalized with their allowed finalized values, nothing else.
-- Cancelled is refused: only bill_cancel makes a bill cancelled.
do $$
declare
  s text;
  f boolean;
  allowed boolean;
begin
  foreach s in array array['draft', 'partial', 'finalized', 'cancelled', 'paid', 'Finalized', null] loop
    foreach f in array array[true, false, null] loop
      allowed := coalesce((f is false and s = 'draft')
                          or (f is true and s in ('partial', 'finalized')), false);
      perform pg_temp.ok(format('insert %s/%s %s', coalesce(s, 'null'), coalesce(f::text, 'null'),
                                case when allowed then 'allowed' else 'refused' end),
        (pg_temp.try(format('insert into public.bills (notes, paymentstatus, finalized) values (%L, %L, %L)',
                            'BSTATE', s, f)) = 'ok') = allowed);
    end loop;
  end loop;
  perform pg_temp.ok('insert without paymentstatus refused',
    pg_temp.try($q$insert into public.bills (notes, finalized) values ('BSTATE', false)$q$) = '23514');
end $$;

-- Transitions, each from a fresh bill.
do $$
declare
  t record;
  b int;
  got text;
begin
  for t in select * from (values
      -- from status, from finalized, to status, to finalized, allowed
      ('draft', false, 'draft', false, true),
      ('draft', false, 'partial', true, true),
      ('draft', false, 'finalized', true, true),
      ('draft', false, 'cancelled', false, true),
      ('draft', false, 'finalized', false, false),      -- pair refused by the check
      ('draft', false, 'cancelled', true, false),       -- never finalized, so cannot claim it was
      ('partial', true, 'finalized', true, true),
      ('finalized', true, 'partial', true, true),
      ('finalized', true, 'finalized', true, true),
      ('partial', true, 'cancelled', true, true),
      ('finalized', true, 'cancelled', true, true),
      ('finalized', true, 'draft', false, false),
      ('partial', true, 'draft', false, false),
      ('finalized', true, 'cancelled', false, false),
      ('cancelled', true, 'finalized', true, false),
      ('cancelled', false, 'draft', false, false),
      ('cancelled', false, 'cancelled', true, false),
      ('cancelled', true, 'cancelled', true, true)) v(fs, ff, ts, tf, allowed)
  loop
    b := pg_temp.bill(t.fs, t.ff);
    got := pg_temp.move(b, t.ts, t.tf);
    perform pg_temp.ok(format('%s/%s -> %s/%s %s', t.fs, t.ff, t.ts, t.tf,
                              case when t.allowed then 'allowed' else 'refused' end),
      (got = 'ok') = t.allowed);
    perform pg_temp.ok(format('%s/%s -> %s/%s refused with a named error', t.fs, t.ff, t.ts, t.tf),
      t.allowed or got in ('BILL_BAD_TRANSITION', '23514'));
  end loop;
end $$;

-- Other columns of a cancelled bill can still change (PDF, notes, slip photos).
do $$
declare
  b int := pg_temp.bill('cancelled', true);
begin
  perform pg_temp.ok('cancelled bill: other columns still update',
    pg_temp.try(format($q$update public.bills set pdf_url = 'x', notes = 'BSTATE edited' where billid = %s$q$, b)) = 'ok');
end $$;

-- Inserting a cancelled bill is refused with the named error, not only by the checks.
do $$
begin
  perform pg_temp.ok('insert cancelled refused as BILL_BAD_TRANSITION',
    pg_temp.try($q$insert into public.bills (notes, paymentstatus, finalized) values ('BSTATE', 'cancelled', true)$q$)
      = 'BILL_BAD_TRANSITION');
end $$;

-- Deletes: a cancelled bill is kept; drafts go, and so does a just-saved finalized bill that
-- a failed save removes.
do $$
declare
  t record;
  b int;
begin
  for t in select * from (values
      ('draft', false, true),
      ('partial', true, true),
      ('finalized', true, true),
      ('cancelled', false, false),
      ('cancelled', true, false)) v(st, fin, allowed)
  loop
    b := pg_temp.bill(t.st, t.fin);
    perform pg_temp.ok(format('delete %s/%s %s', t.st, t.fin, case when t.allowed then 'allowed' else 'refused' end),
      pg_temp.try(format('delete from public.bills where billid = %s', b))
        = case when t.allowed then 'ok' else 'BILL_BAD_TRANSITION' end);
    perform pg_temp.ok(format('delete %s/%s leaves the row %s', t.st, t.fin, case when t.allowed then 'gone' else 'in place' end),
      exists (select 1 from public.bills where billid = b) = not t.allowed);
  end loop;
end $$;

-- Payments: only on part-paid and paid bills, by insert or by moving a row.
do $$
declare
  t record;
  b int;
  m int;
  open_bill int := pg_temp.bill('partial', true);
  pay int;
begin
  insert into public.salesmethods (salesmethodid, methodname) values (-9301, 'BSTATE method') returning salesmethodid into m;
  for t in select * from (values
      ('draft', false, false),
      ('partial', true, true),
      ('finalized', true, true),
      ('cancelled', false, false),
      ('cancelled', true, false)) v(st, fin, allowed)
  loop
    b := pg_temp.bill(t.st, t.fin);
    perform pg_temp.ok(format('payment on %s/%s %s', t.st, t.fin, case when t.allowed then 'allowed' else 'refused' end),
      pg_temp.try(format('insert into public.bill_payments (billid, amount, salesmethodid) values (%s, 100, %s)', b, m))
        = case when t.allowed then 'ok' else 'BILL_NOT_PAYABLE' end);
  end loop;

  insert into public.bill_payments (billid, amount, salesmethodid) values (open_bill, 100, m) returning payment_id into pay;
  b := pg_temp.bill('cancelled', true);
  perform pg_temp.ok('payment moved onto a cancelled bill refused',
    pg_temp.try(format('update public.bill_payments set billid = %s where payment_id = %s', b, pay)) = 'BILL_NOT_PAYABLE');
  -- A cancelled bill keeps its payments as the record of what was refunded.
  update public.bills set paymentstatus = 'cancelled' where billid = open_bill;
  perform pg_temp.ok('payment on a cancelled bill cannot be changed',
    pg_temp.try(format('update public.bill_payments set amount = 1 where payment_id = %s', pay)) = 'BILL_NOT_PAYABLE');
end $$;

-- The preflight repairs still work on a row that was invalid before the migration.
do $$
declare
  b int;
begin
  -- Recreated as the migration does: NOT VALID keeps the old row in place.
  alter table public.bills drop constraint bills_paymentstatus_check;
  insert into public.bills (notes, paymentstatus, finalized) values ('BSTATE legacy', null, true) returning billid into b;
  alter table public.bills add constraint bills_paymentstatus_check
    check (paymentstatus is not null
           and paymentstatus in ('draft', 'partial', 'finalized', 'cancelled')) not valid;
  perform pg_temp.ok('legacy null status repaired by the preflight update',
    pg_temp.try(format($q$update public.bills set paymentstatus = case when finalized then 'finalized' else 'draft' end where billid = %s$q$, b)) = 'ok');
end $$;

-- Staff write through the authenticated role, which cannot execute the trigger function; the
-- trigger still runs for them.
grant select, update on public.bills to authenticated;
do $$
declare
  b int := pg_temp.bill('finalized', true);
  got text;
begin
  set local role authenticated;
  got := pg_temp.move(b, 'draft', false);
  reset role;
  perform pg_temp.ok('authenticated: un-finalize refused', got = 'BILL_BAD_TRANSITION');
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _bs_checks;
rollback;
