-- Preflight for schema/migration_bill_save_drafts.sql, migration_bill_edit_atomic.sql,
-- migration_bill_money_rpc_only.sql, migration_voucher_redeem_internal.sql and
-- migration_exchanges_rpc_only.sql. Read-only: the transaction is read only and rolled back.
--   supabase db query --linked -f schema/preflight_bill_money_rpc_only.sql
-- That returns only the last result set, the summary of checks 1-5. Run a block alone to see its
-- rows; checks 6-9 list what is there, for the record.
--
-- Checks 1-5 list rows the new functions would treat as real money although none moved. Rows
-- found do not stop the migrations, but each needs the owner's look first: the owner rule is that
-- credit is never cashed twice, so no repair is suggested here.

begin read only;

-- 1. Drafts holding credit figures. bill_cancel gives store_credit_used back on any bill, and
--    finalize_draft now takes a store_credit_used the finish leaves out from the customer.
select 'draft_with_credit' as chk, billid, bill_number, customerid, store_credit_used, exchange_credit_used,
       exchange_cash_refund
  from public.bills
 where paymentstatus = 'draft'
   and (coalesce(store_credit_used, 0) <> 0 or coalesce(exchange_credit_used, 0) <> 0
        or coalesce(exchange_cash_refund, 0) <> 0)
 order by billid;

-- 2. Drafts with a voucher redeemed or exchanges linked (an old-screen finish that failed half way).
select 'draft_voucher' as chk, v.voucher_id, v.redeemed_billid, b.bill_number
  from public.vouchers v join public.bills b on b.billid = v.redeemed_billid
 where b.paymentstatus = 'draft'
 order by v.redeemed_billid;
select 'draft_exchange' as chk, e.exchangeid, e.new_billid, e.credit_amount, b.bill_number
  from public.exchanges e join public.bills b on b.billid = e.new_billid
 where b.paymentstatus = 'draft'
 order by e.new_billid;

-- 3. Store credit a live bill records but the ledger never took (H2: bill_save kept the client's
--    store_credit_used and took only the balance). bill_cancel and bill_edit would give it back.
--    Net credit the bill holds = taken at finish (bill_finalize, bill_partial_finalize, the old
--    screen's bill_refinalize) less given back by an edit (bill_edit_credit_back). A bill from
--    before store_credit_ledger existed has no rows and shows here too: check its date first.
--    Website bills are left out: their store_credit_used is credit and voucher taken by the order
--    (source online, ref the order), never by these functions.
select 'credit_not_taken' as chk, b.billid, b.bill_number, b.orderdate, b.customerid, b.paymentstatus,
       b.store_credit_used,
       -coalesce(sum(l.delta), 0) as ledger_held
  from public.bills b
  left join public.store_credit_ledger l
    on l.ref_id = b.billid::text and l.customerid = b.customerid
   and l.reason in ('bill_finalize', 'bill_partial_finalize', 'bill_refinalize', 'bill_edit_credit_back')
 where b.paymentstatus in ('partial', 'finalized') and coalesce(b.store_credit_used, 0) > 0
   and not exists (select 1 from public.orders o where o.bill_id = b.billid)
 group by b.billid
having round(b.store_credit_used, 2) - round(-coalesce(sum(l.delta), 0), 2) > 0.01
 order by b.billid;

-- 4. Store credit on a live bill with no customer: no ledger row can exist for it.
select 'credit_no_customer' as chk, billid, bill_number, paymentstatus, store_credit_used
  from public.bills
 where paymentstatus in ('partial', 'finalized') and customerid is null and coalesce(store_credit_used, 0) > 0
 order by billid;

-- 5. Live bills recording more received than they come to (H5). bill_cancel refunds what is held.
--    held: the payment rows' sum, or payment_amount for a bill paid in one go (no rows).
--    net: net_amount, or for the bills finalize left it null on, totalamount less credit used, as
--    bill_save now works it out. The screen and the CLI allowed up to ₹100 over on a paid bill
--    (cash handed over and kept), so over_limit marks the ones past that; a part-paid bill a rupee
--    or more over is wrong at any amount. Online bills are listed too (online_order column): their
--    refunds go through the gateway.
select 'paid_over_net' as chk, b.billid, b.bill_number, b.orderdate, b.paymentstatus, b.totalamount,
       b.store_credit_used, b.exchange_credit_used, b.net_amount, x.net, x.held, x.held - x.net as over,
       (b.paymentstatus = 'partial' or x.held - x.net > 100) as over_limit,
       exists (select 1 from public.orders o where o.bill_id = b.billid) as online_order
  from public.bills b
  cross join lateral (
    select round(coalesce(b.net_amount,
                          greatest(0, coalesce(b.totalamount, 0) - coalesce(b.store_credit_used, 0)
                                      - coalesce(b.exchange_credit_used, 0))), 2) as net,
           coalesce((select round(sum(p.amount), 2) from public.bill_payments p where p.billid = b.billid),
                    round(coalesce(b.payment_amount, 0), 2)) as held) x
 where b.paymentstatus in ('partial', 'finalized')
   and x.held - x.net >= 1
 order by over_limit desc, over desc;

-- 6. Every function that writes bills: must be security definer and owned by a non-API role
--    (postgres), or trg_bills_via_rpc_only refuses its money writes as an API caller's.
select 'bills_writer' as chk, n.nspname, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema')
   and p.prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?bills\M'
 order by p.prosecdef, owner, p.proname;

-- 7. Triggers on bills (expect the trg_bills_* set from the bill migrations).
select 'bills_trigger' as chk, t.tgname, t.tgfoid::regproc, t.tgenabled
  from pg_trigger t
 where t.tgrelid = 'public.bills'::regclass and not t.tgisinternal
 order by t.tgname;

-- 8. Cron jobs that might write bills (they run as their owner).
select 'cron' as chk, jobid, username, command from cron.job where command ~* 'bills';

-- 9. Roles that can act as postgres, which the trigger does not treat as API callers.
select 'role_members_of_postgres' as chk, r.rolname
  from pg_auth_members m join pg_roles r on r.oid = m.member
 where m.roleid = 'postgres'::regrole;

-- Summary of checks 1-5 (the result `supabase db query -f` shows).
select
  (select count(*) from public.bills
    where paymentstatus = 'draft'
      and (coalesce(store_credit_used, 0) <> 0 or coalesce(exchange_credit_used, 0) <> 0
           or coalesce(exchange_cash_refund, 0) <> 0)) as draft_with_credit,
  (select count(*) from public.vouchers v join public.bills b on b.billid = v.redeemed_billid
    where b.paymentstatus = 'draft')
  + (select count(*) from public.exchanges e join public.bills b on b.billid = e.new_billid
      where b.paymentstatus = 'draft') as draft_voucher_or_exchange,
  (select count(*) from (
     select 1 from public.bills b
       left join public.store_credit_ledger l
         on l.ref_id = b.billid::text and l.customerid = b.customerid
        and l.reason in ('bill_finalize', 'bill_partial_finalize', 'bill_refinalize', 'bill_edit_credit_back')
      where b.paymentstatus in ('partial', 'finalized') and coalesce(b.store_credit_used, 0) > 0
        and not exists (select 1 from public.orders o where o.bill_id = b.billid)
      group by b.billid
     having round(b.store_credit_used, 2) - round(-coalesce(sum(l.delta), 0), 2) > 0.01) c) as credit_not_taken,
  (select count(*) from public.bills
    where paymentstatus in ('partial', 'finalized') and customerid is null
      and coalesce(store_credit_used, 0) > 0) as credit_no_customer,
  (select count(*) filter (where x.held - x.net >= 1)
     from public.bills b
     cross join lateral (
       select round(coalesce(b.net_amount,
                             greatest(0, coalesce(b.totalamount, 0) - coalesce(b.store_credit_used, 0)
                                         - coalesce(b.exchange_credit_used, 0))), 2) as net,
              coalesce((select round(sum(p.amount), 2) from public.bill_payments p where p.billid = b.billid),
                       round(coalesce(b.payment_amount, 0), 2)) as held) x
    where b.paymentstatus in ('partial', 'finalized')) as paid_over_net,
  (select count(*) filter (where b.paymentstatus = 'partial' or x.held - x.net > 100)
     from public.bills b
     cross join lateral (
       select round(coalesce(b.net_amount,
                             greatest(0, coalesce(b.totalamount, 0) - coalesce(b.store_credit_used, 0)
                                         - coalesce(b.exchange_credit_used, 0))), 2) as net,
              coalesce((select round(sum(p.amount), 2) from public.bill_payments p where p.billid = b.billid),
                       round(coalesce(b.payment_amount, 0), 2)) as held) x
    where b.paymentstatus in ('partial', 'finalized') and x.held - x.net >= 1) as paid_over_limit;

rollback;
