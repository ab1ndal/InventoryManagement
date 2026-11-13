-- Edit a saved bill in one call, and settle any money the edit leaves the shop holding over.
--
-- Owner decision 2026-11-12: a customer who has paid (in part or in full) may return an item;
-- staff edit the bill to remove it, or swap it for other items in the same edit. When the new
-- net amount is below what the shop holds for the bill by a rupee or more, staff choose, for
-- that edit, to pay the difference back (cash refund, with its method and date) or to add it to
-- the customer's store credit. A walk-in bill (no customer) can only be refunded, or have a
-- customer attached first. The excess is never kept silently.
--
-- How it is recorded: as a negative bill_payments row in the same transaction as the bill
-- update, under the bill's row lock.
--   kind 'payment'       amount > 0, salesmethodid set    money received (as before)
--   kind 'refund'        amount < 0, salesmethodid set    money paid back to the customer
--   kind 'store_credit'  amount < 0, salesmethodid null   money moved to the customer's credit
-- So bills.payment_amount stays the sum of the bill's bill_payments rows, and that sum is what
-- the shop still holds for the bill. Everything that already reads that sum keeps working:
--   - bill_add_payment: remaining = net - sum, so an edit back up after a refund or credit
--     leaves the bill part-paid with the difference due.
--   - bill_cancel: refunds sum(bill_payments) less exchange credit given, so money already
--     refunded or credited at an edit is never paid out a second time.
--   - _bills_payment_total: status judged from the sum.
-- A bill paid in one go has no rows. Before its first refund or credit row, bill_edit records
-- what was received (payment_amount, the bill's method and date) as its first payment row, so
-- the sum rule holds for it from then on.
--
-- A refund or credit is final. Editing the bill back up later does not take it back: the bill
-- becomes part-paid and the difference is collected as a new payment.
--
-- bill_edit(p_key, p_billid, p_payload) replaces the bill screen's direct update of an opened
-- bill (BillingForm.handleSaveDraft). p_payload:
--   expect  {paymentstatus, payment_amount} as the screen loaded them; anything else is
--           BILL_STALE (another window recorded a payment, settled, or cancelled).
--   bill    every column the screen writes (c_bill_keys); a missing key would null a column,
--           so all are required.
--   excess  null, or {mode: 'refund' | 'store_credit', amount, salesmethodid, recorded_at}.
--           amount must equal the excess the database works out; salesmethodid is required
--           for a refund and ignored for credit; recorded_at null means now.
-- Errors (P0001, code as message, cause in detail): BILL_STALE, BILL_EXCESS_UNSETTLED (an
-- excess and no choice), BILL_EXCESS_CHANGED (choice amount differs, or a choice with no
-- excess), BILL_EXCESS_NEEDS_CUSTOMER (store credit on a walk-in bill), BILL_ONLINE,
-- BILL_KEY_CONFLICT, BILL_BAD_PAYLOAD. A replay of the same key returns the first result.
--
-- schema/migration_bill_payments_ledger.sql (run after this) also refuses any other update
-- that drops a paid bill's net below what it holds (BILL_EXCESS_UNSETTLED), so a direct write
-- cannot skip the choice.
--
-- Run after schema/migration_bill_add_payment.sql and before
-- schema/migration_bill_payments_ledger.sql. Read-only check first: the check constraints this
-- replaces.
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.bill_payments'::regclass and contype = 'c';

set local lock_timeout = '3s';

alter table public.bill_payments add column if not exists kind text not null default 'payment';
alter table public.bill_payments alter column salesmethodid drop not null;

-- The old "amount > 0" check is replaced by one per kind. Dropped by definition, not name, in
-- case the live name differs from the bootstrap's.
do $$
declare
  r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.bill_payments'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~ '\(amount > '
  loop
    execute format('alter table public.bill_payments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.bill_payments drop constraint if exists bill_payments_kind_check;
alter table public.bill_payments add constraint bill_payments_kind_check
  check ((kind = 'payment' and amount > 0 and salesmethodid is not null)
         or (kind = 'refund' and amount < 0 and salesmethodid is not null)
         or (kind = 'store_credit' and amount < 0 and salesmethodid is null));

create or replace function public.bill_edit(p_key uuid, p_billid int, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js and bill_add_payment.
  c_paid_in_full_tolerance constant numeric := 1;
  c_payload_keys constant text[] := array['expect', 'bill', 'excess'];
  c_expect_keys constant text[] := array['paymentstatus', 'payment_amount'];
  c_bill_keys constant text[] := array[
    'customerid', 'notes', 'totalamount', 'gst_total', 'discount_total', 'taxable_total',
    'net_amount', 'applied_codes', 'payment_amount', 'final_amount', 'saleslocationid',
    'salesmethodid', 'paymentstatus', 'finalized', 'store_credit_used', 'orderdate'];
  c_excess_keys constant text[] := array['mode', 'amount', 'salesmethodid', 'recorded_at'];

  v_saved jsonb;
  v_expect jsonb;
  v_new jsonb;
  v_choice jsonb;
  v_bill public.bills;
  v_customer int;
  v_has_rows boolean;
  v_held numeric;
  v_net numeric;
  v_excess numeric := 0;
  v_payment_amount numeric;
  v_status text;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or p_billid is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = 'key, billid and a payload object are required';
  end if;

  begin
    v_saved := public._bill_claim_key(p_key, 'edit',
      jsonb_build_object('billid', p_billid, 'payload', p_payload));
    if v_saved is not null then
      return v_saved;
    end if;

    v_expect := p_payload -> 'expect';
    v_new := p_payload -> 'bill';
    v_choice := nullif(p_payload -> 'excess', 'null'::jsonb);
    if exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (c_payload_keys))
       or jsonb_typeof(v_expect) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_expect) k)
          is distinct from (select array_agg(k order by k) from unnest(c_expect_keys) k)
       or jsonb_typeof(v_new) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_new) k)
          is distinct from (select array_agg(k order by k) from unnest(c_bill_keys) k) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'payload needs expect (paymentstatus, payment_amount) and every bill key';
    end if;
    if v_choice is not null
       and (jsonb_typeof(v_choice) <> 'object'
            or exists (select 1 from jsonb_object_keys(v_choice) k where k <> all (c_excess_keys))
            or v_choice ->> 'mode' is null or v_choice ->> 'mode' not in ('refund', 'store_credit')
            or v_choice ->> 'amount' is null
            or (v_choice ->> 'mode' = 'refund' and v_choice ->> 'salesmethodid' is null)) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'excess needs mode refund or store_credit, the amount, and a method for a refund';
    end if;

    -- NO KEY UPDATE serializes with bill_add_payment and bill_cancel on this bill without
    -- blocking foreign key checks from rows that reference it.
    select * into v_bill from public.bills where billid = p_billid for no key update;
    if not found then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('bill %s not found', p_billid);
    end if;

    if v_bill.paymentstatus is distinct from v_expect ->> 'paymentstatus'
       or v_bill.payment_amount is distinct from (v_expect ->> 'payment_amount')::numeric then
      raise exception 'BILL_STALE' using errcode = 'P0001',
        detail = jsonb_build_object('paymentstatus', v_bill.paymentstatus,
                                    'payment_amount', v_bill.payment_amount)::text;
    end if;

    -- What the shop holds: the payment rows' sum, or what was entered for a bill paid in one go.
    v_has_rows := exists (select 1 from public.bill_payments p where p.billid = p_billid);
    if v_has_rows then
      select round(sum(p.amount), 2) into v_held from public.bill_payments p where p.billid = p_billid;
    else
      v_held := round(coalesce(v_bill.payment_amount, 0), 2);
    end if;
    v_net := round(coalesce((v_new ->> 'net_amount')::numeric, 0), 2);
    if v_bill.paymentstatus in ('partial', 'finalized') and v_held - v_net >= c_paid_in_full_tolerance then
      v_excess := v_held - v_net;
    end if;

    v_customer := (v_new ->> 'customerid')::int;
    v_payment_amount := (v_new ->> 'payment_amount')::numeric;
    v_status := v_new ->> 'paymentstatus';

    if v_excess = 0 and v_choice is not null then
      raise exception 'BILL_EXCESS_CHANGED' using errcode = 'P0001',
        detail = jsonb_build_object('excess', 0)::text;
    end if;
    if v_excess > 0 then
      if v_choice is null then
        raise exception 'BILL_EXCESS_UNSETTLED' using errcode = 'P0001',
          detail = jsonb_build_object('excess', v_excess)::text;
      end if;
      -- Staff chose for the amount they were shown; a different amount means the bill moved.
      if round((v_choice ->> 'amount')::numeric, 2) <> v_excess then
        raise exception 'BILL_EXCESS_CHANGED' using errcode = 'P0001',
          detail = jsonb_build_object('excess', v_excess)::text;
      end if;
      -- Website bills are refunded through the payment gateway from the Orders screen.
      if exists (select 1 from public.orders o where o.bill_id = p_billid) then
        raise exception 'BILL_ONLINE' using errcode = 'P0001', detail = p_billid::text;
      end if;
      if v_choice ->> 'mode' = 'store_credit' and v_customer is null then
        raise exception 'BILL_EXCESS_NEEDS_CUSTOMER' using errcode = 'P0001',
          detail = jsonb_build_object('excess', v_excess)::text;
      end if;

      -- bill_payments takes rows only from the bill RPCs, which set this for their own inserts
      -- (schema/migration_bill_payments_ledger.sql).
      perform set_config('app.bill_payment_writer', 'on', true);
      if not v_has_rows then
        if v_bill.salesmethodid is null then
          raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
            detail = format('bill %s has no payment method to record what was received', p_billid);
        end if;
        insert into public.bill_payments (billid, amount, salesmethodid, recorded_at, kind)
        values (p_billid, v_held, v_bill.salesmethodid, coalesce(v_bill.orderdate, localtimestamp), 'payment');
      end if;
      insert into public.bill_payments (billid, amount, salesmethodid, recorded_at, kind)
      values (p_billid, -v_excess,
              case when v_choice ->> 'mode' = 'refund' then (v_choice ->> 'salesmethodid')::int end,
              coalesce((v_choice ->> 'recorded_at')::timestamp, localtimestamp),
              v_choice ->> 'mode');
      perform set_config('app.bill_payment_writer', '', true);

      if v_choice ->> 'mode' = 'store_credit' then
        perform public._store_credit_apply(v_customer, v_excess, 'bill_edit_excess',
                                           p_billid::text, 'instore', 'bill');
      end if;
      v_payment_amount := v_net;
      v_status := 'finalized';
    end if;

    -- orderdate is cast straight to timestamp, which keeps the date the client sent (as in
    -- bill_save); going through timestamptz could move it to the previous day.
    update public.bills set
      customerid = v_customer,
      notes = v_new ->> 'notes',
      totalamount = (v_new ->> 'totalamount')::numeric,
      gst_total = (v_new ->> 'gst_total')::numeric,
      discount_total = (v_new ->> 'discount_total')::numeric,
      taxable_total = (v_new ->> 'taxable_total')::numeric,
      net_amount = (v_new ->> 'net_amount')::numeric,
      applied_codes = case when v_new -> 'applied_codes' = 'null'::jsonb then null
                           else array(select jsonb_array_elements_text(v_new -> 'applied_codes')) end,
      payment_amount = v_payment_amount,
      final_amount = (v_new ->> 'final_amount')::numeric,
      saleslocationid = (v_new ->> 'saleslocationid')::int,
      salesmethodid = (v_new ->> 'salesmethodid')::int,
      paymentstatus = v_status,
      finalized = (v_new ->> 'finalized')::boolean,
      store_credit_used = (v_new ->> 'store_credit_used')::numeric,
      orderdate = (v_new ->> 'orderdate')::timestamp
    where billid = p_billid;

    v_result := jsonb_build_object(
      'billid', p_billid,
      'bill_number', v_bill.bill_number,
      'paymentstatus', v_status,
      'payment_amount', v_payment_amount,
      'excess', case when v_excess > 0 then jsonb_build_object(
                  'mode', v_choice ->> 'mode', 'amount', v_excess, 'customerid',
                  case when v_choice ->> 'mode' = 'store_credit' then v_customer end) end,
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

revoke all on function public.bill_edit(uuid, int, jsonb) from public, anon;
grant execute on function public.bill_edit(uuid, int, jsonb) to authenticated, service_role;
