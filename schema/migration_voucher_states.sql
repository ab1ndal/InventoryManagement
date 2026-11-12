-- Voucher lifecycle as one checked state machine (owner rule: credit is never cashed twice).
--
-- A voucher's state lives in four columns: redeemed, redeemed_at, redeemed_billid and
-- held_order_id. Every function re-derived "usable" from them by hand, and nothing stopped a
-- write leaving a contradiction, such as redeemed with no bill and no order (spent nowhere,
-- so nobody can tell whether it was cashed) or a bill link on an unredeemed voucher.
--
-- States, from public.voucher_state(v):
--   available  not redeemed, not held, expiry_date >= current_date
--   expired    not redeemed, not held, expiry_date <  current_date (time-derived, so it cannot
--              be a stored or generated column: current_date is not immutable)
--   held       not redeemed, held_order_id set (an unpaid online order)
--   redeemed   redeemed. In store: redeemed_billid set, held_order_id null. Online:
--              held_order_id kept as the order that spent it, redeemed_billid null until
--              online_order_create_bos links the order's bill.
--
-- Allowed changes (trigger vouchers_state_guard; anything else raises VOUCHER_BAD_TRANSITION):
--   insert                          only as available or expired: no redemption, hold or bill
--   available -> held               online_order_create, online_order_confirm_payment re-hold;
--                                   the order names this voucher (orders.voucher_code) and is
--                                   pending_payment, or expired / payment_failed (late payment)
--   held      -> available/expired  _online_release_holds, orders delete (FK set null); the order
--                                   is gone or unpaid (pending_payment, expired, payment_failed,
--                                   cancelled)
--   held      -> redeemed (online)  online_order_confirm_payment: same order, now paid, names
--                                   this voucher, no bill yet
--   redeemed (online, no bill) -> redeemed (online, bill)
--                                   online_order_create_bos, only the order's own bill
--   available -> redeemed (bill)    voucher_redeem (bill_save and the billing screen use it); the
--                                   bill exists and is not cancelled
--   redeemed (bill) -> available/expired
--                                   bill_cancel, voucher_release (a draft whose finalize failed).
--                                   Checked again at commit by the deferred trigger
--                                   vouchers_release_guard: the bill must by then be a draft,
--                                   cancelled or deleted. bill_cancel releases before it marks
--                                   the bill cancelled, so this cannot be checked any earlier.
--                                   Only drafts can be deleted (trg_bills_status_insert_delete,
--                                   schema/migration_bill_status_states.sql), so a deleted bill
--                                   was a draft. Nothing deletes a bill to free its voucher: new
--                                   bills are saved whole by bill_save, which leaves nothing to
--                                   undo after a failure.
--   delete                          only available or expired vouchers
-- Once held or redeemed, voucher_id, value, expiry_date and customerid cannot change.
-- Never: an online redemption undone, a redemption moved to another bill or order, a hold
-- moved to another order, an expired voucher held or redeemed, a live bill's voucher freed.
--
-- Staff no longer write vouchers directly: insert, update and delete are revoked from anon and
-- authenticated, so every change goes through the security definer functions above. Releasing
-- a redemption needs a draft, cancelled or deleted bill, and cancelled bills stay cancelled
-- (schema/migration_bill_status_states.sql), so a voucher can never pay for two live bills.
--
-- The three checks are added NOT VALID, so rows written before this migration are not checked
-- until the VALIDATE step at the end, after schema/preflight_voucher_states.sql reports zero.
-- New and updated rows are checked at once. redeemed NULL meant "not redeemed" in every reader
-- (coalesce(redeemed, false)), so it is backfilled and made NOT NULL here.
--
-- voucher_redeem keeps its signature and grants; only its predicate now calls voucher_state.
-- Its body is otherwise copied from schema/migration_atomic_shared_writes.sql, the only
-- migration that defines it. The trigger refuses it for a missing or cancelled bill. A draft is
-- allowed: the billing screen redeems before it marks a draft finalized, so a refusal leaves the
-- draft untouched, and calls voucher_release if marking it finalized then fails.
-- Never put BEGIN/COMMIT here (exec_sql runs it in a transaction).

set local lock_timeout = '3s';

create or replace function public.voucher_state(v public.vouchers)
returns text
language sql
stable
as $$
  select case
    when coalesce(v.redeemed, false) then 'redeemed'
    when v.held_order_id is not null then 'held'
    when v.expiry_date < current_date then 'expired'
    else 'available'
  end
$$;

-- Before the trigger exists: it would refuse this as a change that moves no state.
update public.vouchers set redeemed = false where redeemed is null;
alter table public.vouchers alter column redeemed set not null;

alter table public.vouchers drop constraint if exists vouchers_redeemed_at_check;
alter table public.vouchers add constraint vouchers_redeemed_at_check
  check (redeemed = (redeemed_at is not null)) not valid;

-- A redemption must name what spent it: the bill, or the online order.
alter table public.vouchers drop constraint if exists vouchers_redeemed_target_check;
alter table public.vouchers add constraint vouchers_redeemed_target_check
  check (not redeemed or redeemed_billid is not null or held_order_id is not null) not valid;

alter table public.vouchers drop constraint if exists vouchers_billid_redeemed_check;
alter table public.vouchers add constraint vouchers_billid_redeemed_check
  check (redeemed_billid is null or redeemed) not valid;

create or replace function public._vouchers_guard_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_to text;
  v_order public.orders;
  v_bill_status text;
begin
  if tg_op = 'INSERT' then
    if new.redeemed or new.redeemed_at is not null or new.redeemed_billid is not null
       or new.held_order_id is not null then
      raise exception 'VOUCHER_BAD_TRANSITION' using errcode = '23514',
        detail = format('voucher %s: a new voucher must be unspent and unheld', new.voucher_id);
    end if;
    return new;
  end if;

  v_from := public.voucher_state(old);
  if tg_op = 'DELETE' then
    if v_from in ('held', 'redeemed') then
      raise exception 'VOUCHER_BAD_TRANSITION' using errcode = '23514',
        detail = format('voucher %s: a %s voucher cannot be deleted', old.voucher_id, v_from);
    end if;
    return old;
  end if;

  v_to := public.voucher_state(new);
  -- What the voucher is worth and whose it is are settled once an order or bill relies on it.
  if v_from in ('held', 'redeemed')
     and (new.voucher_id, new.value, new.expiry_date, new.customerid)
         is distinct from (old.voucher_id, old.value, old.expiry_date, old.customerid) then
    raise exception 'VOUCHER_BAD_TRANSITION' using errcode = '23514',
      detail = format('voucher %s: code, value, expiry and customer are fixed while %s',
                      old.voucher_id, v_from);
  end if;

  if new.redeemed = old.redeemed
     and new.redeemed_at is not distinct from old.redeemed_at
     and new.redeemed_billid is not distinct from old.redeemed_billid
     and new.held_order_id is not distinct from old.held_order_id then
    return new;
  end if;

  if v_from = 'available' and v_to = 'held' then
    select * into v_order from public.orders o where o.id = new.held_order_id;
    if v_order.voucher_code = new.voucher_id
       and v_order.status in ('pending_payment', 'expired', 'payment_failed') then
      return new;
    end if;
  end if;
  if v_from = 'held' and v_to in ('available', 'expired') and new.redeemed_billid is null then
    -- A deleted order is already gone when its FK sets held_order_id to null.
    select * into v_order from public.orders o where o.id = old.held_order_id;
    if not found or v_order.status in ('pending_payment', 'expired', 'payment_failed', 'cancelled') then
      return new;
    end if;
  end if;
  if v_from = 'held' and v_to = 'redeemed'
     and new.held_order_id = old.held_order_id and new.redeemed_billid is null then
    select * into v_order from public.orders o where o.id = new.held_order_id;
    if v_order.status = 'paid' and v_order.voucher_code = new.voucher_id then
      return new;
    end if;
  end if;
  if v_from = 'redeemed' and v_to = 'redeemed'
     and old.held_order_id is not null and new.held_order_id = old.held_order_id
     and new.redeemed_at = old.redeemed_at and old.redeemed_billid is null
     and new.redeemed_billid = (select o.bill_id from public.orders o where o.id = new.held_order_id) then
    return new;
  end if;
  if v_from = 'available' and v_to = 'redeemed'
     and new.held_order_id is null and new.redeemed_billid is not null then
    -- KEY SHARE waits for a bill_cancel holding this bill, then reads the cancelled row, so a
    -- voucher is never spent on a bill that is being cancelled. The FK check takes it anyway.
    select b.paymentstatus into v_bill_status from public.bills b
     where b.billid = new.redeemed_billid for key share;
    if found and v_bill_status is distinct from 'cancelled' then
      return new;
    end if;
  end if;
  -- The bill is checked at commit by vouchers_release_guard.
  if v_from = 'redeemed' and old.held_order_id is null and old.redeemed_billid is not null
     and v_to in ('available', 'expired') then
    return new;
  end if;

  raise exception 'VOUCHER_BAD_TRANSITION' using errcode = '23514',
    detail = format('voucher %s: %s (bill %s, order %s) -> %s (bill %s, order %s)',
                    old.voucher_id, v_from, old.redeemed_billid, old.held_order_id,
                    v_to, new.redeemed_billid, new.held_order_id);
end;
$$;
revoke all on function public._vouchers_guard_transition() from public, anon, authenticated;

drop trigger if exists vouchers_state_guard on public.vouchers;
create trigger vouchers_state_guard
  before insert or update or delete on public.vouchers
  for each row execute function public._vouchers_guard_transition();

-- A released in-store redemption is checked when the transaction commits, after bill_cancel
-- has marked its bill cancelled. A bill gone by then was a draft: only drafts can be deleted.
create or replace function public._vouchers_check_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.bills b
              where b.billid = old.redeemed_billid
                and b.paymentstatus is distinct from 'cancelled'
                and not (b.paymentstatus = 'draft' and b.finalized is not true)) then
    raise exception 'VOUCHER_BAD_TRANSITION' using errcode = '23514',
      detail = format('voucher %s: bill %s still stands, so its voucher stays spent',
                      old.voucher_id, old.redeemed_billid);
  end if;
  return null;
end;
$$;
revoke all on function public._vouchers_check_release() from public, anon, authenticated;

drop trigger if exists vouchers_release_guard on public.vouchers;
create constraint trigger vouchers_release_guard
  after update on public.vouchers
  deferrable initially deferred
  for each row
  when (old.redeemed and not new.redeemed and old.redeemed_billid is not null)
  execute function public._vouchers_check_release();

-- Every legitimate writer is one of the security definer functions above (or service_role).
-- The billing screen's direct update, which could free a live bill's voucher, is replaced by
-- voucher_release.
revoke insert, update, delete, truncate on table public.vouchers from anon, authenticated;

create or replace function public.voucher_redeem(p_voucher text, p_bill int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.vouchers v
     set redeemed = true, redeemed_at = now(), redeemed_billid = p_bill
   where v.voucher_id = p_voucher
     and public.voucher_state(v) = 'available';
  return found;
end;
$$;

-- Undoes this bill's redemption while the bill is still a draft: the billing screen's
-- finalize redeemed the voucher and then failed to mark the draft finalized.
create or replace function public.voucher_release(p_voucher text, p_bill int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.bills;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- NO KEY UPDATE: a finalize of this draft waits until the release commits, and then marks a
  -- bill whose voucher is free, which its own voucher_redeem must take again.
  select * into v_bill from public.bills b where b.billid = p_bill for no key update;
  if not found or v_bill.paymentstatus is distinct from 'draft' or v_bill.finalized is true then
    raise exception 'VOUCHER_RELEASE_REFUSED' using errcode = 'P0001',
      detail = format('bill %s is %s, not a draft, so voucher %s stays spent',
                      p_bill, coalesce(v_bill.paymentstatus, 'missing'), p_voucher);
  end if;
  update public.vouchers
     set redeemed = false, redeemed_at = null, redeemed_billid = null
   where voucher_id = p_voucher and redeemed_billid = p_bill and held_order_id is null;
  return found;
end;
$$;

revoke all on function public.voucher_release(text, int) from public, anon;
grant execute on function public.voucher_release(text, int) to authenticated, service_role;

-- Run after schema/preflight_voucher_states.sql reports zero rows for every check, as a
-- separate step (it scans the table but blocks no writes):
--   alter table public.vouchers validate constraint vouchers_redeemed_at_check;
--   alter table public.vouchers validate constraint vouchers_redeemed_target_check;
--   alter table public.vouchers validate constraint vouchers_billid_redeemed_check;
