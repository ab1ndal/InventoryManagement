-- Preflight for schema/migration_voucher_states.sql. Read-only: every statement is a SELECT.
-- Run before the migration and again before its VALIDATE step:
--   supabase db query --linked -f schema/preflight_voucher_states.sql
-- (that returns only the last result set, so the summary comes last; run a block alone to see
-- its rows).
--
-- Each check counts vouchers that break one rule of the migration. Rows found before the
-- migration do not stop it (the checks go in NOT VALID), but they must be zero before VALIDATE,
-- and any later update to such a row fails until it is repaired. Suggested repairs follow
-- each check as comments. Run a repair only after the owner has looked at the rows: the
-- owner rule is that credit is never cashed twice, so when in doubt a voucher stays spent.
-- Run repairs before the migration: afterwards its trigger refuses most of them (only check 7's
-- release of a cancelled bill's voucher still goes through).

-- 1. redeemed is NULL. Every reader treats it as false, and the migration sets it to false
--    itself. Listed for the record only.
select 'redeemed_null' as check_name, count(*) as violations
  from public.vouchers where redeemed is null;

-- 2. redeemed without redeemed_at. Repair (keeps it spent, dates it from its bill or issue):
--   update public.vouchers v
--      set redeemed_at = coalesce((select b.orderdate from public.bills b where b.billid = v.redeemed_billid),
--                                 v.issue_date::timestamp)
--    where v.redeemed and v.redeemed_at is null;
select 'redeemed_without_redeemed_at' as check_name, count(*) as violations
  from public.vouchers where coalesce(redeemed, false) and redeemed_at is null;

-- 3. redeemed_at on an unredeemed voucher with no bill: a leftover stamp. Repair:
--   update public.vouchers set redeemed_at = null
--    where not coalesce(redeemed, false) and redeemed_at is not null and redeemed_billid is null;
--    (with a bill, see check 5 first)
select 'redeemed_at_without_redeemed' as check_name, count(*) as violations
  from public.vouchers where not coalesce(redeemed, false) and redeemed_at is not null;

-- 4. redeemed with neither a bill nor an online order: spent, but nobody can tell where.
--    No automatic repair. For each row, find the bill it paid for (customer, date, value) and
--    set redeemed_billid. Only if the owner confirms it was never used, release it:
--   update public.vouchers set redeemed = false, redeemed_at = null where voucher_id = '<code>';
select 'redeemed_without_bill_or_order' as check_name, count(*) as violations
  from public.vouchers
 where coalesce(redeemed, false) and redeemed_billid is null and held_order_id is null;

-- 5. a bill link on an unredeemed voucher. The bill row says it paid with the voucher, so the
--    safe repair keeps it spent, unless that bill is cancelled (then clear the link instead):
--   update public.vouchers v
--      set redeemed = true,
--          redeemed_at = coalesce(v.redeemed_at, (select b.orderdate from public.bills b where b.billid = v.redeemed_billid))
--    where not coalesce(v.redeemed, false) and v.redeemed_billid is not null
--      and not exists (select 1 from public.bills b where b.billid = v.redeemed_billid and b.paymentstatus = 'cancelled');
select 'bill_link_without_redeemed' as check_name, count(*) as violations
  from public.vouchers where not coalesce(redeemed, false) and redeemed_billid is not null;

-- The checks below are not constraints. They find states the trigger now prevents but older
-- rows may already have. Look at them; repair by hand.

-- 6. spent online but linked to a bill that is not the order's own bill.
select 'online_redemption_wrong_bill' as check_name, count(*) as violations
  from public.vouchers v join public.orders o on o.id = v.held_order_id
 where coalesce(v.redeemed, false) and v.redeemed_billid is not null
   and v.redeemed_billid is distinct from o.bill_id;

-- 7. still redeemed by a cancelled bill. The migration's trigger refuses any new redemption
--    against a cancelled bill. These rows are the past cases to look at for credit cashed twice:
--    a bill cancelled before bill_cancel existed did not release its voucher, so check whether
--    the customer was given the value again some other way (a new voucher, store credit, cash)
--    before freeing it. bill_cancel releases it; by hand, after checking the bill (the commit
--    check allows it because the bill is cancelled):
--   update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
--    where voucher_id = '<code>' and held_order_id is null;
select 'redeemed_by_cancelled_bill' as check_name, count(*) as violations
  from public.vouchers v join public.bills b on b.billid = v.redeemed_billid
 where coalesce(v.redeemed, false) and v.held_order_id is null and b.paymentstatus = 'cancelled';
select v.voucher_id, v.customerid, v.value, v.redeemed_at, b.billid, b.bill_number, b.orderdate,
       b.customerid as bill_customer, b.store_credit_used
  from public.vouchers v join public.bills b on b.billid = v.redeemed_billid
 where coalesce(v.redeemed, false) and v.held_order_id is null and b.paymentstatus = 'cancelled'
 order by b.orderdate;

-- 8. held, unredeemed, by an order that is no longer waiting for payment: a hold that was
--    never released. _online_release_holds(o) is the repair for such an order.
select 'stale_hold' as check_name, count(*) as violations
  from public.vouchers v join public.orders o on o.id = v.held_order_id
 where not coalesce(v.redeemed, false) and o.status <> 'pending_payment';

-- 9. held or spent online by an order that does not name the voucher (orders.voucher_code).
--    The trigger now refuses such a hold. Repair by hand.
select 'online_link_wrong_voucher' as check_name, count(*) as violations
  from public.vouchers v join public.orders o on o.id = v.held_order_id
 where o.voucher_code is distinct from v.voucher_id;

-- 10. spent online by an order that was never paid (it never left pending_payment, or it
--     expired or failed). The trigger now redeems only for a paid order. Look at the order's
--     payment before freeing anything.
select 'online_redemption_unpaid_order' as check_name, count(*) as violations
  from public.vouchers v join public.orders o on o.id = v.held_order_id
 where coalesce(v.redeemed, false) and o.status in ('pending_payment', 'expired', 'payment_failed');

-- 11. redeemed by a draft bill: a finalize that redeemed and then failed to mark the draft
--     finalized, before the billing screen called voucher_release. Allowed, but the credit is
--     stuck until the draft is finalized or cancelled (bill_cancel releases it).
select 'redeemed_by_draft_bill' as check_name, count(*) as violations
  from public.vouchers v join public.bills b on b.billid = v.redeemed_billid
 where coalesce(v.redeemed, false) and v.held_order_id is null and b.paymentstatus = 'draft';

-- 12. functions that write vouchers without security definer. The migration revokes insert,
--     update and delete from anon and authenticated, so such a function would fail for staff.
--     Must be zero (the repo has none; this catches one created by hand on live).
select 'invoker_function_writes_vouchers' as check_name, count(*) as violations
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and not p.prosecdef
   and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?vouchers\M';

-- Rows behind any non-zero count above.
select v.voucher_id, v.customerid, v.value, v.expiry_date, v.redeemed, v.redeemed_at,
       v.redeemed_billid, v.held_order_id, v.source
  from public.vouchers v
 where v.redeemed is null
    or (coalesce(v.redeemed, false) and v.redeemed_at is null)
    or (not coalesce(v.redeemed, false) and v.redeemed_at is not null)
    or (coalesce(v.redeemed, false) and v.redeemed_billid is null and v.held_order_id is null)
    or (not coalesce(v.redeemed, false) and v.redeemed_billid is not null)
 order by v.voucher_id;

-- Summary (last, so `db query -f` shows it).
select
  count(*) filter (where redeemed is null) as redeemed_null,
  count(*) filter (where coalesce(redeemed, false) and redeemed_at is null) as redeemed_without_redeemed_at,
  count(*) filter (where not coalesce(redeemed, false) and redeemed_at is not null) as redeemed_at_without_redeemed,
  count(*) filter (where coalesce(redeemed, false) and redeemed_billid is null and held_order_id is null)
    as redeemed_without_bill_or_order,
  count(*) filter (where not coalesce(redeemed, false) and redeemed_billid is not null) as bill_link_without_redeemed,
  count(*) filter (where coalesce(redeemed, false) and held_order_id is null
                     and (select b.paymentstatus from public.bills b where b.billid = redeemed_billid) = 'cancelled')
    as redeemed_by_cancelled_bill,
  count(*) filter (where held_order_id is not null
                     and (select o.voucher_code from public.orders o where o.id = held_order_id) is distinct from voucher_id)
    as online_link_wrong_voucher,
  count(*) filter (where coalesce(redeemed, false)
                     and (select o.status from public.orders o where o.id = held_order_id)
                         in ('pending_payment', 'expired', 'payment_failed'))
    as online_redemption_unpaid_order,
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and not p.prosecdef
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?vouchers\M')
    as invoker_function_writes_vouchers,
  count(*) as vouchers
  from public.vouchers;
