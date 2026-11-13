-- bill_payments is the ledger of what a customer paid; keep it and bills.payment_amount in step.
--
-- Three ways the two drifted apart, each found by the 2026-11-12 verifier:
--   - A bill screen left open from before a payment saved its stale payment_amount and status
--     over it (finalized -> partial, 1000 -> 200), and the bill then took more payments.
--   - A bill_payments row inserted directly (not through bill_save or bill_add_payment) changed
--     what was received without touching the bill's total or status.
--   - Deleting or changing a payment row rewrote the record of what was paid, which bill_cancel
--     reads to work out the refund.
--
-- From now on:
--   1. bill_payments rows are inserted only by bill_save, bill_add_payment and bill_edit. Each sets
--      app.bill_payment_writer to 'on' for its own insert; anything else is refused
--      (BILL_PAYMENT_DIRECT). The marker is transaction-local and switched off straight after
--      the insert, and PostgREST cannot set it, so table writes from the app cannot pass.
--   2. A payment's amount, bill and kind never change (BILL_PAYMENT_LOCKED). Its method, date
--      and notes may be corrected. Refund and store credit rows are negative (kind, from
--      schema/migration_bill_edit_excess.sql), so the sum is what the shop still holds.
--   3. A payment row is deleted only with its draft bill (BILL_PAYMENT_LOCKED otherwise). When
--      a draft is deleted the cascade finds the bill already gone, which is allowed.
--   4. Once a bill has bill_payments rows, an update that changes its payment_amount,
--      paymentstatus or net_amount must leave payment_amount equal to their sum and the status the sum gives
--      (finalized when the shortfall is under one rupee, as bill_add_payment and tallyPayment
--      judge it). Otherwise BILL_PAYMENTS_MISMATCH: the screen tells staff to reload.
--      Bills paid in one go have no rows and keep payment_amount as entered, so the rule does
--      not apply to them. Updates that leave all three alone (a PDF, notes, an item edit
--      that keeps the totals) pass even on an older bill whose total already disagrees, so
--      existing rows cannot block the shop; the read-only query below lists those.
--   5. An update may not drop a part-paid or paid bill's net amount a rupee or more below what
--      the shop holds for it (its rows' sum, or payment_amount before the update for a bill
--      paid in one go): BILL_EXCESS_UNSETTLED. bill_edit records the refund or store credit
--      first, so its own update passes; any other write (the Finalize button on an opened
--      bill, a direct API update) would leave the excess unrecorded.
--
-- Run after schema/migration_bill_save_app_callers.sql, schema/migration_bill_add_payment.sql and
-- schema/migration_bill_edit_excess.sql, which set the marker (and add bill_payments.kind), and after the app version that records every payment through them.
--
-- Read-only check before running: bills whose payment_amount already disagrees with their rows.
--   select b.billid, b.bill_number, b.paymentstatus, b.net_amount, b.payment_amount,
--          round(sum(p.amount), 2) as paid
--     from public.bills b join public.bill_payments p on p.billid = b.billid
--    group by b.billid
--   having b.payment_amount is distinct from round(sum(p.amount), 2)
--    order by b.billid;

set local lock_timeout = '3s';

-- Security definer so row security on bills cannot hide the bill a payment belongs to.
create or replace function public._bill_payments_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' then
    if current_setting('app.bill_payment_writer', true) is distinct from 'on' then
      raise exception 'BILL_PAYMENT_DIRECT' using errcode = 'P0001',
        detail = format('bill %s: record payments with bill_save, bill_add_payment or bill_edit', new.billid);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount or new.billid is distinct from old.billid
       or new.kind is distinct from old.kind then
      raise exception 'BILL_PAYMENT_LOCKED' using errcode = 'P0001',
        detail = format('payment %s: amount, bill and kind cannot change', old.payment_id);
    end if;
    return new;
  end if;

  select b.paymentstatus into v_status from public.bills b where b.billid = old.billid;
  if found and v_status is distinct from 'draft' then
    raise exception 'BILL_PAYMENT_LOCKED' using errcode = 'P0001',
      detail = format('payment %s on bill %s (%s) cannot be deleted', old.payment_id, old.billid,
                      coalesce(v_status, 'null'));
  end if;
  return old;
end;
$$;
revoke all on function public._bill_payments_ledger() from public, anon, authenticated;

drop trigger if exists trg_bill_payments_ledger on public.bill_payments;
create trigger trg_bill_payments_ledger
  before insert or update or delete on public.bill_payments
  for each row execute function public._bill_payments_ledger();

create or replace function public._bills_payment_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js and bill_add_payment.
  c_paid_in_full_tolerance constant numeric := 1;
  v_rows int;
  v_paid numeric;
  v_status text;
  v_held numeric;
begin
  -- Money held over after an edit must be refunded or credited (bill_edit), never dropped.
  if old.paymentstatus in ('partial', 'finalized') and new.paymentstatus in ('partial', 'finalized')
     and round(coalesce(new.net_amount, 0), 2) < round(coalesce(old.net_amount, 0), 2) then
    if exists (select 1 from public.bill_payments p where p.billid = new.billid) then
      select round(sum(p.amount), 2) into v_held from public.bill_payments p where p.billid = new.billid;
    else
      v_held := round(coalesce(old.payment_amount, 0), 2);
    end if;
    if v_held - round(coalesce(new.net_amount, 0), 2) >= c_paid_in_full_tolerance then
      raise exception 'BILL_EXCESS_UNSETTLED' using errcode = 'P0001',
        detail = jsonb_build_object('billid', new.billid, 'held', v_held, 'net', new.net_amount,
                                    'excess', v_held - round(coalesce(new.net_amount, 0), 2))::text;
    end if;
  end if;

  if new.paymentstatus is null or new.paymentstatus not in ('partial', 'finalized')
     or (new.payment_amount is not distinct from old.payment_amount
         and new.paymentstatus is not distinct from old.paymentstatus
         and new.net_amount is not distinct from old.net_amount) then
    return new;
  end if;

  select count(*), round(coalesce(sum(p.amount), 0), 2) into v_rows, v_paid
    from public.bill_payments p where p.billid = new.billid;
  if v_rows = 0 then
    return new;
  end if;

  v_status := case when round(coalesce(new.net_amount, 0), 2) - v_paid < c_paid_in_full_tolerance
                   then 'finalized' else 'partial' end;
  if new.payment_amount is distinct from v_paid or new.paymentstatus <> v_status then
    raise exception 'BILL_PAYMENTS_MISMATCH' using errcode = 'P0001',
      detail = jsonb_build_object('billid', new.billid, 'paid', v_paid, 'status', v_status,
                                  'payment_amount', new.payment_amount,
                                  'paymentstatus', new.paymentstatus)::text;
  end if;
  return new;
end;
$$;
revoke all on function public._bills_payment_total() from public, anon, authenticated;

drop trigger if exists trg_bills_payment_total on public.bills;
create trigger trg_bills_payment_total
  before update on public.bills
  for each row execute function public._bills_payment_total();
