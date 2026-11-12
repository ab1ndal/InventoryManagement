-- Bill lifecycle states, enforced in the table.
--
-- A bill's state is held in two columns: paymentstatus and finalized. Nothing stopped them
-- disagreeing (a draft is stored in both), and paymentstatus took any text or NULL.
-- The four states and the finalized value each allows:
--   draft      finalized false   saved, not yet finalized
--   partial    finalized true    finalized, payment still owed
--   finalized  finalized true    finalized, paid
--   cancelled  either            bill_cancel ran; finalized keeps whether it was ever finalized
-- stock_reduced is not part of the state: it records whether saving moved stock (the "Don't
-- reduce stock" choice), which can be true or false in every state, and null on old bills.
--
-- Allowed changes (enforced by the trigger below, on updates that set either column):
--   draft             -> draft, partial, finalized, cancelled (finalized stays false)
--   partial/finalized -> partial, finalized (payments and edits move between them), cancelled
--   cancelled         -> nothing (owner decision 2026-11-12: cancelled bills are locked)
-- A finalized bill never goes back to draft: it has a number, took stock and credit, and may
-- have payments. The app names these states in src/admin/lib/billStatus.js.
--
-- Run schema/preflight_bill_status_states.sql first. The checks are added NOT VALID, so this
-- migration does not read old rows and cannot fail on them, while every new insert and update
-- is checked from now on. Validate them (step at the end) once preflight shows no violators.
--
-- Also: no bill is inserted cancelled, a cancelled bill is never deleted, and bill_payments
-- rows are refused on draft and cancelled bills (triggers at the end).
--
-- Errors: P0001 BILL_BAD_TRANSITION, detail holds the billid and both states; P0001
-- BILL_NOT_PAYABLE for a payment on a draft or cancelled bill.

set local lock_timeout = '3s';

alter table public.bills drop constraint if exists bills_paymentstatus_check;
alter table public.bills add constraint bills_paymentstatus_check
  check (paymentstatus is not null
         and paymentstatus in ('draft', 'partial', 'finalized', 'cancelled')) not valid;

-- "is true"/"is false" rather than "= true", so a NULL finalized fails instead of passing.
alter table public.bills drop constraint if exists bills_finalized_status_check;
alter table public.bills add constraint bills_finalized_status_check
  check ((finalized is false and paymentstatus in ('draft', 'cancelled'))
         or (finalized is true and paymentstatus in ('partial', 'finalized', 'cancelled'))) not valid;

create or replace function public._bills_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Old rows with a NULL or unknown state pass, so the preflight backfill can repair them.
  if old.paymentstatus = 'cancelled'
     and (new.paymentstatus is distinct from old.paymentstatus
          or new.finalized is distinct from old.finalized) then
    raise exception 'BILL_BAD_TRANSITION' using errcode = 'P0001',
      detail = format('bill %s is cancelled (finalized %s -> %s, %s -> %s)', old.billid,
                      old.finalized, new.finalized, old.paymentstatus, new.paymentstatus);
  end if;
  if old.finalized is true and new.finalized is not true then
    raise exception 'BILL_BAD_TRANSITION' using errcode = 'P0001',
      detail = format('bill %s was finalized and cannot go back (%s -> %s)', old.billid,
                      old.paymentstatus, new.paymentstatus);
  end if;
  -- Cancelling keeps finalized as it was, since it records whether the bill was ever finalized.
  if new.paymentstatus = 'cancelled' and new.finalized is distinct from old.finalized then
    raise exception 'BILL_BAD_TRANSITION' using errcode = 'P0001',
      detail = format('bill %s: cancelling cannot change finalized (%s -> %s)', old.billid,
                      old.finalized, new.finalized);
  end if;
  return new;
end;
$$;
revoke all on function public._bills_status_transition() from public, anon, authenticated;

drop trigger if exists trg_bills_status_transition on public.bills;
create trigger trg_bills_status_transition
  before update of paymentstatus, finalized on public.bills
  for each row execute function public._bills_status_transition();

-- Only bill_cancel makes a bill cancelled, after undoing its stock, credit and voucher, so a
-- bill cannot start out cancelled. A cancelled bill is the record of that undo and of the
-- refund, so it is never deleted. Drafts can still be deleted, and so can a just-saved
-- finalized bill that the screen or CLI removes when a later step of its save fails.
create or replace function public._bills_status_insert_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.paymentstatus = 'cancelled' then
    raise exception 'BILL_BAD_TRANSITION' using errcode = 'P0001',
      detail = 'a bill cannot be created cancelled; cancel it with bill_cancel';
  end if;
  if tg_op = 'DELETE' and old.paymentstatus = 'cancelled' then
    raise exception 'BILL_BAD_TRANSITION' using errcode = 'P0001',
      detail = format('bill %s is cancelled and cannot be deleted', old.billid);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public._bills_status_insert_delete() from public, anon, authenticated;

drop trigger if exists trg_bills_status_insert_delete on public.bills;
create trigger trg_bills_status_insert_delete
  before insert or delete on public.bills
  for each row execute function public._bills_status_insert_delete();

-- Payments belong to part-paid and paid bills. Every path that records one (the screen's
-- part-paid finalize, the CLI, bill_save, bill_add_payment) sets the bill to partial first.
-- FOR SHARE waits for a bill_cancel in progress on the bill, then reads the status it left.
-- Security definer so row security on bills cannot hide the bill and let the payment through.
create or replace function public._bill_payments_bill_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select paymentstatus into v_status from public.bills where billid = new.billid for share;
  -- A missing bill is left to the foreign key, which names it.
  if found and v_status in ('draft', 'cancelled') then
    raise exception 'BILL_NOT_PAYABLE' using errcode = 'P0001',
      detail = format('bill %s is %s', new.billid, v_status);
  end if;
  return new;
end;
$$;
revoke all on function public._bill_payments_bill_open() from public, anon, authenticated;

drop trigger if exists trg_bill_payments_bill_open on public.bill_payments;
create trigger trg_bill_payments_bill_open
  before insert or update on public.bill_payments
  for each row execute function public._bill_payments_bill_open();

-- Step 2, run separately once schema/preflight_bill_status_states.sql returns no violators.
-- Each scans bills without blocking reads or writes.
--   alter table public.bills validate constraint bills_paymentstatus_check;
--   alter table public.bills validate constraint bills_finalized_status_check;
