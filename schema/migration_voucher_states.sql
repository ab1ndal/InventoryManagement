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
--   available -> held               online_order_create, online_order_confirm_payment re-hold
--   held      -> available/expired  _online_release_holds, orders delete (FK set null)
--   held      -> redeemed (online)  online_order_confirm_payment, same order, no bill yet
--   redeemed (online, no bill) -> redeemed (online, bill)
--                                   online_order_create_bos, only the order's own bill
--   available -> redeemed (bill)    voucher_redeem (bill_save and the billing screen use it)
--   redeemed (bill) -> available/expired
--                                   bill_cancel, and the billing screen undoing a failed save
--                                   before it deletes the new bill
-- Never: an online redemption undone, a redemption moved to another bill or order, a hold
-- moved to another order, an expired voucher held or redeemed.
--
-- The three checks are added NOT VALID, so rows written before this migration are not checked
-- until the VALIDATE step at the end, after schema/preflight_voucher_states.sql reports zero.
-- New and updated rows are checked at once. redeemed NULL meant "not redeemed" in every reader
-- (coalesce(redeemed, false)), so it is backfilled and made NOT NULL here.
--
-- voucher_redeem keeps its signature and grants; only its predicate now calls voucher_state.
-- Its body is otherwise copied from schema/migration_atomic_shared_writes.sql, the only
-- migration that defines it. Never put BEGIN/COMMIT here (exec_sql runs it in a transaction).

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
  v_from text := public.voucher_state(old);
  v_to text := public.voucher_state(new);
begin
  if new.redeemed = old.redeemed
     and new.redeemed_at is not distinct from old.redeemed_at
     and new.redeemed_billid is not distinct from old.redeemed_billid
     and new.held_order_id is not distinct from old.held_order_id then
    return new;
  end if;

  if v_from = 'available' and v_to = 'held' then
    return new;
  end if;
  if v_from = 'held' and v_to in ('available', 'expired') and new.redeemed_billid is null then
    return new;
  end if;
  if v_from = 'held' and v_to = 'redeemed'
     and new.held_order_id = old.held_order_id and new.redeemed_billid is null then
    return new;
  end if;
  if v_from = 'redeemed' and v_to = 'redeemed'
     and old.held_order_id is not null and new.held_order_id = old.held_order_id
     and new.redeemed_at = old.redeemed_at and old.redeemed_billid is null
     and new.redeemed_billid = (select o.bill_id from public.orders o where o.id = new.held_order_id) then
    return new;
  end if;
  if v_from = 'available' and v_to = 'redeemed'
     and new.held_order_id is null and new.redeemed_billid is not null then
    return new;
  end if;
  if v_from = 'redeemed' and old.held_order_id is null and v_to in ('available', 'expired') then
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
  before update on public.vouchers
  for each row execute function public._vouchers_guard_transition();

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

-- Run after schema/preflight_voucher_states.sql reports zero rows for every check, as a
-- separate step (it scans the table but blocks no writes):
--   alter table public.vouchers validate constraint vouchers_redeemed_at_check;
--   alter table public.vouchers validate constraint vouchers_redeemed_target_check;
--   alter table public.vouchers validate constraint vouchers_billid_redeemed_check;
