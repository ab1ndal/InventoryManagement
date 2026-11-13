-- exchange_record gives credit only for what the bill's line is worth and what the shop still holds.
--
-- exchange_record took credit_amount from the client as sent, and did not count money that had
-- already left the bill. A direct API call (2026-11-12 gate review, "Hole B") could so pay out
-- more than the customer paid:
--   1. A bill paid 1000 was edited down to 600 (bill_edit put 400 on store credit), and then both
--      lines were exchanged at 500 each: 1400 out for 1000 in.
--   2. A line exchanged once had its quantity raised, then was exchanged again: 1000 credit for
--      one 500 item. (schema/migration_bill_item_exchange_lock.sql now refuses the raise too.)
--   3. A part-paid bill (100 of 1000 paid) was exchanged for 1000 credit; cancel then refunded 0.
--
-- Owner rule: credit is never cashed twice. So, under the bill's row lock, exchange_record now:
--   - takes only paid bills (paymentstatus 'finalized'; website bills are created finalized).
--     A part-paid bill is not an exchange source, as ExchangePage only lists paid bills:
--     EXCHANGE_BILL_NOT_FINAL.
--   - caps each item's credit at what the line is worth for those units, as ExchangePage works it
--     out (calcItemCredit in exchangeHelpers.js): round(total * qty / quantity, 2). Earlier
--     exchanges of the same line count too, so a line never gives out more than its total in all:
--       cap = least(round(total * qty / quantity, 2),
--                   round(total * (exchanged + qty) / quantity, 2) - credit already given on it)
--     Without the second term, partial exchanges rounding up (200 over 3 units: 66.67 three
--     times) would give out 200.01. A lower amount is accepted (the client may round down).
--     Over the cap: EXCHANGE_OVER_LINE.
--   - caps the bill's exchange credit in total (every exchanges row on its lines, online refund
--     offsets included, plus this call) at what the shop holds for it, read as bill_cancel reads
--     it: the bill_payments sum (refund and store credit rows from bill_edit are negative, so they
--     are already taken off), or payment_amount for a bill paid in one go. Credit and vouchers
--     used to pay the bill are not counted: bill_cancel gives those back in full, so credit
--     given against them would be cashed twice at a cancel. A website bill is cancelled from the
--     Orders screen, never by bill_cancel; what it holds is what the order paid, online plus
--     store credit (payment_amount + store_credit_used, as online_order_create_bos sets them).
--     Over the cap, by a rupee or more: EXCHANGE_OVER_HELD. The rupee is the paid-in-full
--     tolerance (bill_add_payment, paymentHelpers.js): a bill short by paise was accepted as paid,
--     so its lines are exchanged at their full value.
-- Errors are P0001 with the code as message and the numbers in detail, as bill_edit raises them.
-- Item and quantity errors keep their earlier messages.
--
-- Body copied from schema/migration_online_returns.sql (Task 7, the latest definition); same
-- signature and grants. The bill row is locked FOR NO KEY UPDATE after the order row and before
-- the lines, the order bill_edit and bill_cancel follow (bill, then lines), so it serializes with
-- them, bill_add_payment and the online return functions without deadlocking.
--
-- Run after schema/migration_bill_edit_excess.sql. Read-only check first: paid bills from the
-- last 30 days whose recorded payment is below their lines' total, which this caps lower than
-- before (credit, vouchers, bill discounts, or a missing payment_amount):
--   select b.billid, b.bill_number, b.payment_amount, b.store_credit_used, b.exchange_credit_used,
--          sum(bi.total) as lines_total
--     from public.bills b join public.bill_items bi on bi.billid = b.billid
--    where b.paymentstatus = 'finalized' and b.orderdate > now() - interval '30 days'
--    group by b.billid having coalesce(b.payment_amount, 0) < sum(bi.total) - 1
--    order by b.billid desc;

set local lock_timeout = '3s';

create or replace function public.exchange_record(p_billid int, p_customerid int, p_items jsonb)
returns int[]
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js and bill_add_payment.
  c_paid_in_full_tolerance constant numeric := 1;
  o public.orders;
  b public.bills;
  e jsonb;
  bi public.bill_items;
  v_qty int;
  v_used numeric;
  v_given numeric;
  v_credit numeric;
  v_cap numeric;
  v_held numeric;
  v_out numeric;
  v_shipped int;
  v_free int;
  v_id int;
  v_ids int[] := '{}';
begin
  -- same guard as stock_adjust: active admins (and service_role) only
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or p_items = '[]'::jsonb then
    raise exception 'exchange_record: no items';
  end if;

  select * into o from public.orders where bill_id = p_billid for update;
  -- in transit: a later RTO would restock and offset the same unit again (ruling RA6)
  if o.id is not null and o.delivered_at is null then
    raise exception 'online order not delivered yet';
  end if;
  -- Serializes with bill_edit, bill_add_payment and bill_cancel, so what the bill holds cannot
  -- change between the check below and the commit.
  select * into b from public.bills where billid = p_billid for no key update;
  if not found or b.paymentstatus is distinct from 'finalized' then
    raise exception 'EXCHANGE_BILL_NOT_FINAL' using errcode = 'P0001',
      detail = jsonb_build_object('billid', p_billid, 'paymentstatus', b.paymentstatus)::text;
  end if;
  perform 1 from public.bill_items
   where bill_item_id in (select (x ->> 'bill_item_id')::int from jsonb_array_elements(p_items) x)
   order by bill_item_id for update;

  for e in select * from jsonb_array_elements(p_items) loop
    select * into bi from public.bill_items where bill_item_id = (e ->> 'bill_item_id')::int;
    if not found or bi.billid <> p_billid then
      raise exception 'item % is not on bill %', e ->> 'bill_item_id', p_billid;
    end if;
    v_qty := (e ->> 'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'item %: quantity must be positive', bi.bill_item_id;
    end if;

    -- every exchanges row on the line counts, online refund offsets included
    select coalesce(sum(quantity), 0), coalesce(sum(credit_amount), 0) into v_used, v_given
      from public.exchanges where original_bill_item_id = bi.bill_item_id;
    if v_used + v_qty > bi.quantity then
      raise exception 'item % already returned (% of %)', bi.bill_item_id, v_used, trim_scale(bi.quantity);
    end if;

    -- online bill: units in an open return or already refunded are not free either (ruling RA3)
    if o.id is not null then
      -- a line with no order_items row (Shipping) has no unit accounting: refusing it keeps shipping
      -- from being credited in store and then refunded again by a whole-order damaged return (M3)
      if not exists (select 1 from public.order_items where order_id = o.id and bill_item_id = bi.bill_item_id) then
        raise exception 'item % is not a returnable line of online order', bi.bill_item_id;
      end if;
      select sum(i.shipped_qty), sum(f.units) into v_shipped, v_free
        from public._online_return_free_units(o.id, null) f
        join public.order_items i on i.id = f.item_id
       where i.bill_item_id = bi.bill_item_id;
      if v_free is not null and v_qty > v_free then
        raise exception 'item % already returned (% of %)', bi.bill_item_id, v_shipped - v_free, v_shipped;
      end if;
    end if;

    -- A negative amount would lower the credit counted out of the bill.
    v_credit := (e ->> 'credit_amount')::numeric;
    if v_credit is null or v_credit < 0 then
      raise exception 'item %: credit_amount must be zero or more', bi.bill_item_id;
    end if;
    v_cap := greatest(0, least(round(coalesce(bi.total, 0) * v_qty / bi.quantity, 2),
                               round(coalesce(bi.total, 0) * (v_used + v_qty) / bi.quantity, 2) - v_given));
    if v_credit > v_cap then
      raise exception 'EXCHANGE_OVER_LINE' using errcode = 'P0001',
        detail = jsonb_build_object('bill_item_id', bi.bill_item_id, 'quantity', v_qty,
                                    'credit_amount', v_credit, 'cap', v_cap)::text;
    end if;

    if bi.variantid is not null then
      perform public._stock_apply(bi.variantid, v_qty);
    elsif nullif(e ->> 'manual_item_id', '') is not null then
      update public.manual_items set stock = coalesce(stock, 0) + v_qty
       where manual_item_id = e ->> 'manual_item_id';
    end if;

    insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount, voucher_id,
                                  product_name, product_code)
    values (bi.bill_item_id, v_qty, e ->> 'reason', p_customerid, v_credit, null,
            e ->> 'product_name', e ->> 'product_code')
    returning exchangeid into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- After the inserts, so the sum includes this call's items.
  if o.id is not null then
    v_held := coalesce(b.payment_amount, 0) + coalesce(b.store_credit_used, 0);
  elsif exists (select 1 from public.bill_payments p where p.billid = p_billid) then
    select sum(p.amount) into v_held from public.bill_payments p where p.billid = p_billid;
  else
    v_held := coalesce(b.payment_amount, 0);
  end if;
  select coalesce(sum(x.credit_amount), 0) into v_out
    from public.exchanges x
    join public.bill_items l on l.bill_item_id = x.original_bill_item_id
   where l.billid = p_billid;
  if round(v_out, 2) - round(v_held, 2) >= c_paid_in_full_tolerance then
    raise exception 'EXCHANGE_OVER_HELD' using errcode = 'P0001',
      detail = jsonb_build_object('billid', p_billid, 'held', round(v_held, 2),
                                  'exchange_credit', round(v_out, 2))::text;
  end if;
  return v_ids;
end;
$$;
revoke all on function public.exchange_record(int, int, jsonb) from public, anon;
grant execute on function public.exchange_record(int, int, jsonb) to authenticated, service_role;
