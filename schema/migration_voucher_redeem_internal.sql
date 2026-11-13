-- Vouchers are redeemed only inside bill_save; voucher_release is dropped.
--
-- The bill screen redeemed a voucher with voucher_redeem before marking a draft finalized, and
-- gave it back with voucher_release when that failed. A finished draft is now saved whole by
-- bill_save (schema/migration_bill_save_drafts.sql), which redeems in the same transaction, so a
-- failure leaves nothing to give back, and no client, CLI or edge function calls either function
-- (checked 2026-11-12: src/, scripts/, supabase/functions/). Left callable, voucher_redeem let an
-- admin spend a voucher on a bill already finished, outside any save, and voucher_release kept a
-- second path that frees a redemption.
--
-- voucher_redeem stays for bill_save, a security definer function that runs it as the owner, so
-- execute is taken from every API role. bill_cancel frees a cancelled bill's voucher with its own
-- update, as before; the vouchers trigger and its commit check are unchanged.
--
-- Run after schema/migration_bill_save_drafts.sql, once the app version that finishes drafts with
-- it is live and every open bill screen reloaded: the older screen's Finalize and Partial Payment
-- on a saved draft call both functions and would fail.

set local lock_timeout = '3s';

revoke execute on function public.voucher_redeem(text, int) from public, anon, authenticated, service_role;

drop function if exists public.voucher_release(text, int);
