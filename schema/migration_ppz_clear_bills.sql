-- migration_ppz_clear_bills.sql
-- PURPOSE: Wipe all bill records and reset billid sequence to 1.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- WARNING: This is IRREVERSIBLE. All bills, bill_items, and bill_salespersons will be deleted.

BEGIN;

-- 1. Delete junction/child rows first (FK constraints)
DELETE FROM public.bill_salespersons;
DELETE FROM public.bill_items;

-- 2. Delete all bill rows
DELETE FROM public.bills;

-- 3. Reset the serial sequence so the next inserted bill gets billid = 1
TRUNCATE TABLE bills RESTART IDENTITY CASCADE;

-- 4. OPTIONAL: Zero out store_credit on all customers.
--    Uncomment the line below ONLY if store credit was issued from test bills
--    and should not carry over to production.
UPDATE public.customers SET store_credit = 0;

-- 5. OPTIONAL: Zero out vouchers issued from cancelled test bills.
--    Uncomment if the vouchers table exists and needs clearing too.
DELETE FROM public.vouchers;

-- 6.xClear PDFs: Supabase Dashboard → Storage → invoices bucket → delete all bill-{N}.pdf files  
COMMIT;
