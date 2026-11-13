-- bill_edit saves the lines too: one transaction for an opened bill's lines, stock, salespeople,
-- bill row and any excess.
--
-- The bill screen's Save Changes wrote the lines (delete, update, insert), then called bill_edit
-- for the bill row and the excess, then rewrote the salespeople and moved stock with one
-- stock_adjust per variant. A bill_edit refusal (another window paid the bill, the excess moved)
-- came after the lines were saved, so the bill was left with new lines and its old total ("the
-- item changes were saved, but the bill total wasn't"); a failure after it left stock unmoved.
--
-- p_payload gains three keys, sent together by the screen:
--   items            every line the bill keeps, as for bill_save's draft ops: a saved line carries
--                    its bill_item_id and is updated in place, a line without one is inserted, a
--                    saved line left out is deleted (schema/migration_bill_save_drafts.sql,
--                    _bill_lines_save). trg_bill_items_exchange_lock still guards exchanged lines.
--   salesperson_ids  replaces the bill's salespeople.
--   skip_stock       "Don't reduce stock": no stock moves. None moves either for a bill saved with
--                    stock_reduced false.
-- Stock follows the change in lines, as the screen's computeStockDelta did, recorded in
-- bill_stock_moves only for a bill that already has moves (why: _bill_lines_save).
-- A payload without items leaves lines, salespeople and stock alone, as before, so the screen
-- from before this change keeps working until it reloads.
--
-- Store credit an edit cuts goes back to the customer. The screen keeps store credit paying for
-- as much of the new total as it can (store_credit_used = least(used, new total)) and sends the
-- net as the total less that credit, so a cut comes off the cash first: the excess over the net
-- is cash (refunded or put on credit, as above), and credit goes back only for the part of the
-- total cut below the credit used. Example, 1000 paid as 400 credit and 600 cash: an edit to 700
-- gives back 300 cash and keeps the 400 credit; an edit to 300 gives back all 600 cash and 100
-- credit (ledger reason bill_edit_credit_back). Either way edit then cancel returns 400 credit
-- and 600 cash, the same as cancelling at once (bill_cancel returns credit in full and cash held).
-- Also refused: store_credit_used on a draft (BILL_BAD_PAYLOAD; bill_cancel would give it back
-- though none was taken), store_credit_used going up (BILL_BAD_PAYLOAD), and a new customer on a
-- bill that used credit (BILL_CREDIT_CUSTOMER; cancel would give the first customer's credit to
-- the second). The result gains store_credit_back.
--
-- What a part-paid or paid bill holds (payment_amount) changes only by recorded money. bill_edit
-- refuses lowering it (BILL_RECEIVED_CHANGED: give money back by taking items off, which records
-- the excess) and raising it on a bill paid in instalments (Add Payment records those). On a bill
-- paid in one go, Finalize after adding items may raise it: the increase is recorded as a
-- bill_payments row (after a row for what was received before), up to the net amount
-- (BILL_OVERPAID beyond it), and the status follows the rows. The screen's Finalize on an opened
-- bill comes here now, instead of updating bills directly; schema/migration_bill_money_rpc_only.sql
-- then refuses direct writes of these columns. It also sends discount_codes, which replace the
-- bill's discount_usage rows (refused on a draft).
--
-- A draft stays a draft here: paymentstatus and finalized cannot change on one (BILL_BAD_PAYLOAD).
-- Finishing it is bill_save's finalize_draft or partial_draft, which record the payment, credit,
-- voucher and exchanges; the screen's Save Changes on a draft sends it back as a draft.
--
-- Body copied from schema/migration_bill_edit_excess.sql with the changes above. Same signature,
-- grants and error codes, plus BILL_ITEM_EXCHANGED and BILL_STALE (a line this window shows was
-- removed in another) from _bill_lines_save, BILL_CREDIT_CUSTOMER, BILL_RECEIVED_CHANGED and
-- BILL_OVERPAID. The result gains negative_stock.
--
-- Money figures: totalamount, store_credit_used, payment_amount, net_amount and the excess amount
-- must each be 0 or more and finite (BILL_BAD_PAYLOAD naming the field). A negative
-- store_credit_used read as a cut below what the bill took and gave the difference to the
-- customer as credit (0 -> -500 credited 500). The net is not the one sent: it is totalamount
-- less the store_credit_used sent and the bill's exchange_credit_used, floored at 0, as the
-- screen works it out (computeCreditsApplied over the same total and credits). A lower net sent
-- would make an excess to refund or credit that the lines do not; a higher one, room to record
-- more received. The bill stores this net. totalamount may not be more than the bill's lines add
-- up to (as saved by this edit, or as saved before when items are left out) plus a rupee, as in
-- bill_save (schema/migration_bill_save_drafts.sql): BILL_BAD_PAYLOAD.
--
-- Run after schema/migration_bill_save_drafts.sql (_bill_lines_save).

set local lock_timeout = '3s';

create or replace function public.bill_edit(p_key uuid, p_billid int, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js and bill_add_payment.
  c_paid_in_full_tolerance constant numeric := 1;
  -- As bill_save: rounding, line by line versus once.
  c_total_over_lines constant numeric := 1;
  c_payload_keys constant text[] := array['expect', 'bill', 'excess', 'items', 'salesperson_ids', 'skip_stock',
                                          'discount_codes'];
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
  v_exchange_out numeric;
  v_payment_amount numeric;
  v_status text;
  v_negative jsonb := '[]'::jsonb;
  v_credit_old numeric;
  v_credit_new numeric;
  v_credit_back numeric := 0;
  v_paid_new numeric;
  v_bad_field text;
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
    if (p_payload ? 'items' or p_payload ? 'salesperson_ids')
       and (jsonb_typeof(p_payload -> 'items') is distinct from 'array'
            or jsonb_typeof(p_payload -> 'salesperson_ids') is distinct from 'array') then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'items and salesperson_ids are sent together, as arrays';
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

    -- A draft has recorded no payment, taken no credit and spent no voucher or exchange. Finishing
    -- one does all of that and is bill_save's finalize_draft or partial_draft; here it would let a
    -- draft become paid with any payment_amount and no payment row, which bill_cancel pays out.
    if v_bill.paymentstatus = 'draft'
       and (v_new ->> 'paymentstatus' is distinct from 'draft'
            or (v_new ->> 'finalized')::boolean is distinct from false) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'a draft is finished only by bill_save';
    end if;

    -- The lines first, under the bill lock: a refusal below undoes them with everything else.
    if p_payload ? 'items' then
      v_negative := public._bill_lines_save(
        p_billid, p_payload -> 'items',
        coalesce((p_payload ->> 'skip_stock')::boolean, false) or v_bill.stock_reduced is false,
        'bill_edit', p_key);
      delete from public.bill_salespersons where billid = p_billid;
      insert into public.bill_salespersons (billid, salesperson_id)
      select distinct p_billid, s::int from jsonb_array_elements_text(p_payload -> 'salesperson_ids') s;
    end if;

    if (v_new ->> 'totalamount')::numeric
       - (select coalesce(sum(bi.total), 0) from public.bill_items bi where bi.billid = p_billid)
       > c_total_over_lines then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'totalamount is more than the lines add up to';
    end if;

    -- What the shop holds: the payment rows' sum, or what was entered for a bill paid in one go.
    v_has_rows := exists (select 1 from public.bill_payments p where p.billid = p_billid);
    if v_has_rows then
      select round(sum(p.amount), 2) into v_held from public.bill_payments p where p.billid = p_billid;
    else
      v_held := round(coalesce(v_bill.payment_amount, 0), 2);
    end if;
    -- NaN sorts above Infinity, so ">= Infinity" refuses both (see the header).
    select f into v_bad_field
      from (values (1, 'totalamount', (v_new ->> 'totalamount')::numeric),
                   (2, 'store_credit_used', (v_new ->> 'store_credit_used')::numeric),
                   (3, 'payment_amount', (v_new ->> 'payment_amount')::numeric),
                   (4, 'net_amount', (v_new ->> 'net_amount')::numeric),
                   (5, 'excess amount', (v_choice ->> 'amount')::numeric)) x(n, f, v)
     where v < 0 or v >= 'Infinity'::numeric
     order by n
     limit 1;
    if v_bad_field is not null then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('%s must be 0 or more', v_bad_field);
    end if;
    -- Worked out as the screen does, never the net_amount sent (see the header).
    v_net := round(greatest(0, coalesce((v_new ->> 'totalamount')::numeric, 0)
                               - coalesce((v_new ->> 'store_credit_used')::numeric, 0)
                               - coalesce(v_bill.exchange_credit_used, 0)), 2);
    if v_bill.paymentstatus in ('partial', 'finalized') and v_held - v_net >= c_paid_in_full_tolerance then
      v_excess := v_held - v_net;
    end if;

    -- exchange_record takes these lines FOR UPDATE, so no exchange lands between this count
    -- and the commit.
    perform 1 from public.bill_items bi where bi.billid = p_billid order by bi.bill_item_id for share;
    select coalesce(sum(e.credit_amount), 0) into v_exchange_out
      from public.exchanges e
      join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
     where bi.billid = p_billid;
    if v_excess > 0 and v_net < round(v_exchange_out, 2) then
      raise exception 'BILL_EXCHANGE_COUNTED' using errcode = 'P0001',
        detail = jsonb_build_object('exchange_credit_given', round(v_exchange_out, 2),
                                    'net', v_net, 'excess', v_excess)::text;
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

    -- What a part-paid or paid bill holds changes only by recorded money: a payment, or the refund
    -- or credit of an excess above. Lowering payment_amount by hand would be an unrecorded refund;
    -- raising it would make bill_cancel pay out money never received. Finalize on an opened bill
    -- paid in one go (the screen's re-finalize) may raise it when more was taken for added items:
    -- that is recorded as a payment, after a row for what was received before, as for an excess.
    if v_excess = 0 and v_bill.paymentstatus in ('partial', 'finalized') then
      v_paid_new := round(coalesce(v_payment_amount, 0), 2);
      if v_paid_new < v_held or (v_paid_new > v_held and v_has_rows) then
        raise exception 'BILL_RECEIVED_CHANGED' using errcode = 'P0001',
          detail = jsonb_build_object('held', v_held, 'payment_amount', v_paid_new)::text;
      end if;
      if v_paid_new > v_held then
        if exists (select 1 from public.orders o where o.bill_id = p_billid) then
          raise exception 'BILL_ONLINE' using errcode = 'P0001', detail = p_billid::text;
        end if;
        if v_paid_new - v_net >= c_paid_in_full_tolerance then
          raise exception 'BILL_OVERPAID' using errcode = 'P0001',
            detail = jsonb_build_object('net', v_net, 'payment_amount', v_paid_new)::text;
        end if;
        if v_new ->> 'salesmethodid' is null then
          raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
            detail = 'a payment method is needed for the money received';
        end if;
        perform set_config('app.bill_payment_writer', 'on', true);
        if v_held > 0 then
          insert into public.bill_payments (billid, amount, salesmethodid, recorded_at, kind)
          values (p_billid, v_held, coalesce(v_bill.salesmethodid, (v_new ->> 'salesmethodid')::int),
                  coalesce(v_bill.orderdate, localtimestamp), 'payment');
        end if;
        insert into public.bill_payments (billid, amount, salesmethodid, recorded_at, kind)
        values (p_billid, v_paid_new - v_held, (v_new ->> 'salesmethodid')::int, localtimestamp, 'payment');
        perform set_config('app.bill_payment_writer', '', true);
        v_payment_amount := v_paid_new;
        v_status := case when v_net - v_paid_new < c_paid_in_full_tolerance then 'finalized' else 'partial' end;
      else
        -- Unchanged, kept exactly as stored (null stays null).
        v_payment_amount := v_bill.payment_amount;
      end if;
    end if;

    -- Store credit (never below 0: refused with the other money figures above). A part-paid or
    -- paid bill took store_credit_used from its customer when it was finished; an edit that
    -- lowers it gives the cut back to that customer's credit here, in the same transaction (it
    -- used to be dropped). A draft has taken none, so it must hold none: bill_cancel gives
    -- store_credit_used back on any bill, a draft too. A draft saved before may still hold some:
    -- schema/preflight_bill_money_rpc_only.sql check 1 lists them (none on prod, 2026-11-13), and
    -- schema/migration_bill_money_rpc_only.sql stops new direct writes of it.
    v_credit_old := round(coalesce(v_bill.store_credit_used, 0), 2);
    v_credit_new := round(coalesce((v_new ->> 'store_credit_used')::numeric, 0), 2);
    if v_bill.paymentstatus = 'draft' and v_credit_new <> 0 then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'a draft takes no store credit until it is finished';
    end if;
    if v_bill.paymentstatus in ('partial', 'finalized') then
      -- bill_cancel gives store_credit_used back to the bill's customer at the time, so the credit
      -- would land with someone else.
      if v_credit_old > 0 and v_customer is distinct from v_bill.customerid then
        raise exception 'BILL_CREDIT_CUSTOMER' using errcode = 'P0001',
          detail = jsonb_build_object('customerid', v_bill.customerid, 'store_credit_used', v_credit_old)::text;
      end if;
      -- Taking more would need the customer's balance, which only finishing a bill takes.
      if v_credit_new > v_credit_old then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
          detail = format('store_credit_used cannot go up on an edit (%s -> %s)', v_credit_old, v_credit_new);
      end if;
      if v_credit_new < v_credit_old then
        -- Website bills are refunded from the Orders screen.
        if exists (select 1 from public.orders o where o.bill_id = p_billid) then
          raise exception 'BILL_ONLINE' using errcode = 'P0001', detail = p_billid::text;
        end if;
        v_credit_back := v_credit_old - v_credit_new;
        perform public._store_credit_apply(v_bill.customerid, v_credit_back, 'bill_edit_credit_back',
                                           p_billid::text, 'instore', 'bill');
      end if;
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
      net_amount = v_net,
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

    -- Re-finalize records the bill's discount codes again; a draft records none until finished.
    if p_payload ? 'discount_codes' then
      if v_bill.paymentstatus = 'draft' or jsonb_typeof(p_payload -> 'discount_codes') is distinct from 'array' then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
          detail = 'discount_codes is an array, for a part-paid or paid bill';
      end if;
      delete from public.discount_usage where billid = p_billid;
      insert into public.discount_usage (customerid, code, billid)
      select v_customer, c, p_billid from jsonb_array_elements_text(p_payload -> 'discount_codes') c;
    end if;

    v_result := jsonb_build_object(
      'billid', p_billid,
      'bill_number', v_bill.bill_number,
      'paymentstatus', v_status,
      'payment_amount', v_payment_amount,
      'excess', case when v_excess > 0 then jsonb_build_object(
                  'mode', v_choice ->> 'mode', 'amount', v_excess, 'customerid',
                  case when v_choice ->> 'mode' = 'store_credit' then v_customer end) end,
      'negative_stock', v_negative,
      'store_credit_back', v_credit_back,
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
