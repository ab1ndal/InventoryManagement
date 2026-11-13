-- A bill's money columns are written only by the bill functions, never directly through the API.
--
-- Staff can update bills directly (row security lets admins). The screen used to finish drafts and
-- re-finalize opened bills that way, and a direct write can still:
--   - raise payment_amount on a paid bill, so bill_cancel pays out money never received, or lower
--     it, an unrecorded refund;
--   - mark a draft finalized or part-paid without the voucher, exchange, stock and credit steps
--     bill_save does, or move a bill between partial and finalized past its payments;
--   - set store_credit_used, exchange_credit_used or exchange_cash_refund, which bill_cancel gives
--     back or claws back as if they were real (a draft too: cancel returns store_credit_used);
--   - insert a bill that starts out finalized with any of those;
--   - flip stock_reduced, which decides whether later saves move stock and what bill_cancel gives
--     back for a bill with no stock moves, so the bill gives back stock it never took.
-- Since the bill screen now finishes drafts with bill_save (schema/migration_bill_save_drafts.sql)
-- and saves opened bills with bill_edit (schema/migration_bill_edit_atomic.sql), no API caller needs
-- these writes. So for the API roles (anon, authenticated, service_role):
--   INSERT  only a draft (paymentstatus draft, finalized false) with no store credit, exchange
--           credit or exchange cash refund. The screen's Save Draft on a new bill inserts exactly
--           that.
--   UPDATE  paymentstatus, finalized, store_credit_used, exchange_credit_used,
--           exchange_cash_refund and stock_reduced never change; payment_amount and net_amount
--           change only while the bill is a draft. Everything else (notes, pdf_url, ...) is as
--           before. stock_reduced is set once, on insert (the screen's Save Draft, or bill_save).
-- Anything else: P0001 BILL_MONEY_DIRECT, the columns in detail.
--
-- How the trigger tells the functions apart: it runs as the caller (security invoker), so
-- current_user is the API role for a direct write and the functions' owner inside bill_save,
-- bill_edit, bill_add_payment, bill_cancel and the online order functions, which are all security
-- definer. API sessions cannot switch to the owner role. A per-function marker (set_config, as
-- app.bill_cancel) was rejected: bill_add_payment and online_order_create_bos would each need a
-- new copy only to set it, and the owner check already holds for every definer function.
-- Sessions as the owner (SQL editor, migrations, tests) are not API callers and are not checked.
--
-- The trigger is named to run after the bills triggers it does not replace, so a write they
-- refuse keeps its earlier error (BILL_BAD_TRANSITION, BILL_PAYMENTS_MISMATCH, ...).
--
-- Run after schema/migration_bill_edit_atomic.sql, and only once the app version that calls
-- bill_save's draft ops and bill_edit for Finalize is live and every open bill screen reloaded:
-- the older screen's Finalize and Partial Payment on a saved draft are direct writes this refuses.

set local lock_timeout = '3s';

create or replace function public._bills_money_via_rpc()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  c_api_roles constant text[] := array['anon', 'authenticated', 'service_role'];
begin
  if current_user <> all (c_api_roles) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.paymentstatus is distinct from 'draft' or new.finalized is distinct from false
       or coalesce(new.store_credit_used, 0) <> 0 or coalesce(new.exchange_credit_used, 0) <> 0
       or coalesce(new.exchange_cash_refund, 0) <> 0 then
      raise exception 'BILL_MONEY_DIRECT' using errcode = 'P0001',
        detail = 'a bill is created here only as a draft with no credit; bill_save finishes it';
    end if;
    return new;
  end if;

  if (new.paymentstatus, new.finalized, new.store_credit_used, new.exchange_credit_used,
      new.exchange_cash_refund, new.stock_reduced)
     is distinct from (old.paymentstatus, old.finalized, old.store_credit_used,
                       old.exchange_credit_used, old.exchange_cash_refund, old.stock_reduced)
     or (old.paymentstatus is distinct from 'draft'
         and (new.payment_amount, new.net_amount) is distinct from (old.payment_amount, old.net_amount)) then
    raise exception 'BILL_MONEY_DIRECT' using errcode = 'P0001',
      detail = format('bill %s: status, amounts received, credit and stock choice change only through bill_save, '
                      'bill_edit, bill_add_payment or bill_cancel', old.billid);
  end if;
  return new;
end;
$$;
revoke all on function public._bills_money_via_rpc() from public, anon, authenticated;

drop trigger if exists trg_bills_via_rpc_only on public.bills;
create trigger trg_bills_via_rpc_only
  before insert or update on public.bills
  for each row execute function public._bills_money_via_rpc();
