-- Tests for schema/migration_manual_item_stock_backfill.sql: each manual item gets 1 less what
-- its stock-taking bills still hold, never below 0, and a second run changes nothing. The whole
-- file is one transaction that always rolls back, and its final select returns only pass and fail
-- counts. A failed check also raises a WARNING naming it.
-- Run locally (the chain in tasks/manual-item-stock-plan.md section 6, then):
--   scripts/test-db.sh sql schema/migration_manual_item_stock.sql schema/test_manual_item_stock_backfill.sql
-- (from the repo root: the backfill is included with \ir). Before the backfill exists it fails.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _mb_checks (label text not null, passed boolean not null) on commit drop;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _mb_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.stock(p_code text) returns numeric language sql as $$
  select stock from public.manual_items where manual_item_id = p_code
$$;

-- A bill with one line of p_code, written directly as the owner (the triggers let postgres).
create function pg_temp.bill(p_code text, p_qty numeric, p_status text default 'finalized',
                             p_stock_reduced boolean default true) returns int language plpgsql as $$
declare
  b int;
  l int;
begin
  insert into public.bills (notes, document_type, totalamount, paymentstatus, finalized, payment_amount,
                            orderdate, stock_reduced)
  values ('MIBF', 'bos', 100 * p_qty, case when p_status = 'cancelled' then 'finalized' else p_status end,
          p_status <> 'draft', 100 * p_qty, '2026-11-01', p_stock_reduced)
  returning billid into b;
  insert into public.bill_items (billid, quantity, mrp, product_name, product_code, subtotal, gst_amount, total)
  values (b, p_qty, 100, 'MIBF item', p_code, 100 * p_qty, 0, 100 * p_qty)
  returning bill_item_id into l;
  -- No bill is inserted cancelled; the marker bill_cancel sets lets this update through.
  if p_status = 'cancelled' then
    perform set_config('app.bill_cancel', 'on', true);
    update public.bills set paymentstatus = 'cancelled' where billid = b;
    perform set_config('app.bill_cancel', '', true);
  end if;
  return l;
end $$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
declare
  l int;
begin
  insert into public.categories (categoryid, name) values ('MIBF', 'MIBF fixture') on conflict do nothing;
  -- As live before the migration: every item at the default 1.
  insert into public.manual_items (manual_item_id, name, categoryid)
  select 'MIBF' || lpad(n::text, 2, '0'), 'MIBF item ' || n, 'MIBF' from generate_series(1, 11) n;
  perform pg_temp.bill('MIBF01', 1);                               -- sold
  -- MIBF02: never sold
  perform pg_temp.bill('MIBF03', 3.5);                             -- fabric, 3.5 m
  perform pg_temp.bill('MIBF04', 1, 'finalized', false);           -- "Don't reduce stock"
  perform pg_temp.bill('MIBF05', 1, 'cancelled');                  -- cancelled
  perform pg_temp.bill('MIBF06', 1, 'draft');                      -- a draft took stock
  perform pg_temp.bill('MIBF07', 1, 'finalized', null);            -- legacy bill (took stock)
  perform pg_temp.bill('MIBF08', 1, 'partial');                    -- part-paid
  perform pg_temp.bill('MIBF09', 1);                               -- sold on two bills
  perform pg_temp.bill('MIBF09', 1);
  l := pg_temp.bill('MIBF10', 2);                                  -- 2 sold, 1 exchanged
  insert into public.exchanges (original_bill_item_id, quantity, credit_amount) values (l, 1, 100);
  l := pg_temp.bill('MIBF11', 1);                                  -- sold and exchanged back
  insert into public.exchanges (original_bill_item_id, quantity, credit_amount) values (l, 1, 100);
end $$;

\ir migration_manual_item_stock_backfill.sql

do $$
begin
  perform pg_temp.ok('sold piece -> 0', pg_temp.stock('MIBF01') = 0);
  perform pg_temp.ok('never sold stays 1', pg_temp.stock('MIBF02') = 1);
  perform pg_temp.ok('3.5 m from an item at 1 -> 0, not below', pg_temp.stock('MIBF03') = 0);
  perform pg_temp.ok('"Don''t reduce stock" bill does not count', pg_temp.stock('MIBF04') = 1);
  perform pg_temp.ok('cancelled bill does not count', pg_temp.stock('MIBF05') = 1);
  perform pg_temp.ok('draft counts', pg_temp.stock('MIBF06') = 0);
  perform pg_temp.ok('legacy (stock_reduced null) bill counts', pg_temp.stock('MIBF07') = 0);
  perform pg_temp.ok('part-paid counts', pg_temp.stock('MIBF08') = 0);
  perform pg_temp.ok('sold twice -> 0, not -1', pg_temp.stock('MIBF09') = 0);
  perform pg_temp.ok('2 sold, 1 exchanged -> 0', pg_temp.stock('MIBF10') = 0);
  perform pg_temp.ok('sold and exchanged back -> 1', pg_temp.stock('MIBF11') = 1);
end $$;

-- A second run changes nothing.
create temp table _mb_before on commit drop as
  select manual_item_id, stock from public.manual_items where manual_item_id like 'MIBF%';
\ir migration_manual_item_stock_backfill.sql
do $$
begin
  perform pg_temp.ok('a second run changes nothing',
    not exists (select 1 from public.manual_items m join _mb_before b using (manual_item_id)
                 where m.stock is distinct from b.stock));
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _mb_checks;
rollback;
