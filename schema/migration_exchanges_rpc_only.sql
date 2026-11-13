-- Exchanges are written only by the database functions, never directly through the API.
--
-- An exchanges row is credit: credit_amount is what the customer may spend, new_billid says it has
-- been spent, original_bill_item_id ties it to the sold line bill_cancel and bill_edit count it
-- against. A direct write could mint credit, unlink a spent exchange so it pays for a second
-- bill, or move it off its line. The last client write, the bill screen linking exchanges after a
-- part-paid finish with no check that they were unspent, is gone: bill_save links them now
-- (schema/migration_bill_save_drafts.sql). What still writes exchanges is security definer and
-- runs as the owner: exchange_record (the Exchange page), bill_save, bill_cancel and the online
-- return functions; foreign key actions run as the owner too. The Exchange page and bill screen
-- only read the table.
--
-- So insert, update, delete and truncate are revoked from anon and authenticated, as
-- schema/migration_voucher_states.sql does for vouchers. Reads are unchanged.
--
-- Run after schema/migration_bill_save_drafts.sql, once the app version that finishes drafts with
-- it is live and every open bill screen reloaded: the older screen's Partial Payment on a saved
-- draft writes exchanges directly (it ignored the error, so the link would silently be missing).

set local lock_timeout = '3s';

revoke insert, update, delete, truncate on table public.exchanges from anon, authenticated;
