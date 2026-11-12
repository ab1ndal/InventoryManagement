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

-- 7. still redeemed by a cancelled bill (bill_cancel releases it; a bill cancelled before
--    bill_cancel existed may not have). Repair after checking the bill:
--   update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
--    where voucher_id = '<code>' and held_order_id is null;
select 'redeemed_by_cancelled_bill' as check_name, count(*) as violations
  from public.vouchers v join public.bills b on b.billid = v.redeemed_billid
 where coalesce(v.redeemed, false) and v.held_order_id is null and b.paymentstatus = 'cancelled';

-- 8. held, unredeemed, by an order that is no longer waiting for payment: a hold that was
--    never released. _online_release_holds(o) is the repair for such an order.
select 'stale_hold' as check_name, count(*) as violations
  from public.vouchers v join public.orders o on o.id = v.held_order_id
 where not coalesce(v.redeemed, false) and o.status <> 'pending_payment';

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
  count(*) as vouchers
  from public.vouchers;
