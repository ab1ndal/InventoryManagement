-- Record a later payment on a part-paid bill in one transaction.
--
-- The bill screen inserted the bill_payments row, then wrote payment_amount and paymentstatus
-- in a second request, working the status out from the payments it had loaded. A failure in
-- between left a payment with the old status, two screens open on one bill each judged it from
-- a stale list, and nothing stopped a payment on a draft or cancelled bill.
-- bill_add_payment locks the bill, refuses unless it is partial or finalized, inserts the
-- payment, and sets payment_amount and paymentstatus from all of the bill's bill_payments rows.
-- An idempotency key makes a retry after a lost response replay the first result instead of
-- recording the payment twice.
--
-- Paid in full mirrors tallyPayment in src/admin/components/billing/paymentHelpers.js exactly:
-- both sides rounded to paise, and a shortfall under one rupee counts as paid (bill totals
-- carry paise from item rounding, payments are whole rupees). Change both together.
--
-- Like the screen, the status is judged from bill_payments alone: a bill paid in one go has
-- no rows, and the screen only offers this on part-paid bills.
--
-- A payment may not take the bill past its net amount: anything more than the balance by a
-- rupee or more is refused (BILL_OVERPAID, detail has the remaining balance), and so is any
-- payment on a bill with nothing left to pay (BILL_NOTHING_DUE). A finalized bill with no
-- bill_payments rows was paid in one go, so it has nothing due. Money taken beyond the net
-- would otherwise have no record of being owed back, and cancelling the bill would then
-- refund it as if it were part of the sale.
--
-- Not enforced as a table rule: "partial exactly when payments fall short of net_amount".
-- A bill paid in one go keeps its total in payment_amount with no bill_payments rows, and an
-- edit that raises its total keeps it finalized (paymentStatusAfterEdit), so the rule would
-- refuse writes the screens make on purpose.
--
-- p_recorded_at: null records now (database time), as the screen does for today's date.
-- Result: billid, payment (payment_id, amount, salesmethodid, recorded_at, salesmethods),
-- total_paid, remaining, paymentstatus, replayed.
-- Errors use SQLSTATE P0001 with the code as the message and the cause in detail:
--   BILL_NOT_PAYABLE (draft or cancelled), BILL_ONLINE, BILL_NOTHING_DUE, BILL_OVERPAID,
--   BILL_KEY_CONFLICT, BILL_BAD_PAYLOAD.
-- A caller without access gets 42501. Lock and timeout errors pass through unchanged.
--
-- Needs schema/migration_bill_save.sql (bill_save_log, _bill_claim_key), live on 2026-11-12.
-- The insert sets app.bill_payment_writer, the marker schema/migration_bill_payments_ledger.sql
-- requires of every bill_payments insert.

set local lock_timeout = '3s';

create or replace function public.bill_add_payment(p_key uuid, p_billid int, p_amount numeric,
                                                   p_salesmethodid int, p_recorded_at timestamp)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js.
  c_paid_in_full_tolerance constant numeric := 1;

  v_saved jsonb;
  v_bill public.bills;
  v_first boolean;
  v_paid_before numeric;
  v_remaining numeric;
  v_payment public.bill_payments;
  v_total numeric;
  v_net numeric;
  v_paid boolean;
  v_status text;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or p_billid is null or p_amount is null or p_salesmethodid is null then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = 'key, billid, amount and salesmethodid are required';
  end if;

  begin
    v_saved := public._bill_claim_key(p_key, 'add_payment',
      jsonb_build_object('billid', p_billid, 'amount', p_amount,
                         'salesmethodid', p_salesmethodid, 'recorded_at', p_recorded_at));
    if v_saved is not null then
      return v_saved;
    end if;

    -- NO KEY UPDATE still serializes with bill_cancel and other payments on this bill, and
    -- does not block foreign key checks from rows that reference it.
    select * into v_bill from public.bills where billid = p_billid for no key update;
    if not found then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('bill %s not found', p_billid);
    end if;
    if v_bill.paymentstatus is null or v_bill.paymentstatus not in ('partial', 'finalized') then
      raise exception 'BILL_NOT_PAYABLE' using errcode = 'P0001',
        detail = format('bill %s is %s', p_billid, coalesce(v_bill.paymentstatus, 'null'));
    end if;
    -- Website bills are paid through the payment gateway and changed from the Orders screen.
    if exists (select 1 from public.orders o where o.bill_id = p_billid) then
      raise exception 'BILL_ONLINE' using errcode = 'P0001', detail = p_billid::text;
    end if;

    v_first := not exists (select 1 from public.bill_payments p where p.billid = p_billid);
    v_net := round(coalesce(v_bill.net_amount, 0), 2);
    select coalesce(round(sum(p.amount), 2), 0) into v_paid_before
      from public.bill_payments p where p.billid = p_billid;
    v_remaining := v_net - v_paid_before;
    if (v_first and v_bill.paymentstatus = 'finalized')
       or v_remaining < c_paid_in_full_tolerance then
      raise exception 'BILL_NOTHING_DUE' using errcode = 'P0001',
        detail = format('bill %s is paid (net %s, received %s)', p_billid, v_net, v_paid_before);
    end if;
    if p_amount - v_remaining >= c_paid_in_full_tolerance then
      raise exception 'BILL_OVERPAID' using errcode = 'P0001',
        detail = jsonb_build_object('remaining', v_remaining, 'amount', p_amount)::text;
    end if;

    perform set_config('app.bill_payment_writer', 'on', true);
    insert into public.bill_payments (billid, amount, salesmethodid, recorded_at)
    values (p_billid, p_amount, p_salesmethodid, coalesce(p_recorded_at, localtimestamp))
    returning * into v_payment;
    perform set_config('app.bill_payment_writer', '', true);

    select round(sum(p.amount), 2) into v_total from public.bill_payments p where p.billid = p_billid;
    v_paid := v_net - v_total < c_paid_in_full_tolerance;
    v_status := case when v_paid then 'finalized' else 'partial' end;

    -- A bill finalized with nothing paid has no method until its first payment; later
    -- payments keep the bill's method, since each one's own is on its bill_payments row.
    update public.bills
       set payment_amount = v_total,
           paymentstatus = v_status,
           salesmethodid = case when v_first then p_salesmethodid else salesmethodid end
     where billid = p_billid;

    v_result := jsonb_build_object(
      'billid', p_billid,
      'payment', jsonb_build_object(
        'payment_id', v_payment.payment_id,
        'amount', v_payment.amount,
        'salesmethodid', v_payment.salesmethodid,
        'recorded_at', v_payment.recorded_at,
        'salesmethods', (select jsonb_build_object('methodname', m.methodname)
                           from public.salesmethods m
                          where m.salesmethodid = v_payment.salesmethodid)),
      'total_paid', v_total,
      'remaining', case when v_paid then 0 else round(v_net - v_total, 2) end,
      'paymentstatus', v_status,
      'replayed', false);
    update public.bill_save_log
       set billid = p_billid, result = v_result
     where idempotency_key = p_key;
    return v_result;
  exception
    when data_exception or integrity_constraint_violation then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('%s: %s', v_sqlstate, v_message);
  end;
end;
$$;

revoke all on function public.bill_add_payment(uuid, int, numeric, int, timestamp) from public, anon;
grant execute on function public.bill_add_payment(uuid, int, numeric, int, timestamp) to authenticated, service_role;
