-- Preflight for schema/migration_bill_status_states.sql. Read-only: run each query in the
-- SQL editor before the migration, and again before validating its constraints.

-- 1. Every state combination in use. Valid rows: draft/false, partial/true, finalized/true,
--    cancelled/false, cancelled/true. stock_reduced is listed for context only; any value is fine.
select paymentstatus, finalized, stock_reduced, count(*) as bills,
       min(orderdate)::date as first_bill, max(orderdate)::date as last_bill
  from public.bills
 group by 1, 2, 3
 order by 1 nulls first, 2 nulls first, 3 nulls first;

-- 2. Rows the two checks would refuse, grouped by reason. Zero rows here = safe to validate.
select case
         when paymentstatus is null then 'paymentstatus null'
         when paymentstatus not in ('draft', 'partial', 'finalized', 'cancelled') then 'paymentstatus unknown: ' || paymentstatus
         when finalized is null then 'finalized null'
         when finalized is false then 'not finalized but ' || paymentstatus
         else 'finalized but ' || paymentstatus
       end as problem,
       count(*) as bills
  from public.bills
 where not (paymentstatus is not null
            and paymentstatus in ('draft', 'partial', 'finalized', 'cancelled'))
    or not coalesce((finalized is false and paymentstatus in ('draft', 'cancelled'))
                    or (finalized is true and paymentstatus in ('partial', 'finalized', 'cancelled')), false)
 group by 1
 order by 1;

-- 3. The same rows one by one, with what shows whether each was really finalized: a bill
--    number is given to every bill, but payments, a PDF and an online order only to finalized ones.
select b.billid, b.bill_number, b.orderdate::date, b.paymentstatus, b.finalized, b.stock_reduced,
       b.totalamount, b.payment_amount, b.pdf_url is not null as has_pdf,
       (select count(*) from public.bill_payments p where p.billid = b.billid) as payments,
       exists (select 1 from public.orders o where o.bill_id = b.billid) as online
  from public.bills b
 where not (b.paymentstatus is not null
            and b.paymentstatus in ('draft', 'partial', 'finalized', 'cancelled'))
    or not coalesce((b.finalized is false and b.paymentstatus in ('draft', 'cancelled'))
                    or (b.finalized is true and b.paymentstatus in ('partial', 'finalized', 'cancelled')), false)
 order by b.billid;

-- Suggested repairs, only if query 2 found rows. Review query 3 first; run inside a
-- transaction and check the counts before commit. Not part of the migration.
--
-- a) NULL status: the app already reads a NULL as "draft" on unfinalized bills and as
--    "finalized" in the PDF, so keep those meanings.
--      update public.bills set paymentstatus = case when finalized then 'finalized' else 'draft' end
--       where paymentstatus is null;
-- b) NULL finalized (the column default is false): a bill whose status says finalized or partial
--    went through Finalize, anything else did not.
--      update public.bills set finalized = paymentstatus in ('partial', 'finalized')
--       where finalized is null;
-- c) Finalized but status 'draft': every Finalize writes both columns together, so this row
--    came from outside the app. Decide per bill from query 3 (payments or a PDF = finalized).
-- d) Not finalized but status 'partial' or 'finalized': same, decide per bill. To keep it as a
--    finalized bill:   update public.bills set finalized = true where billid in (...);
-- e) An unknown status (for example a capitalised one): map it to one of the four by hand.
