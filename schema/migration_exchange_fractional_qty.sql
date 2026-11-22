-- Fabric sold by the metre can be returned whole: exchanges.quantity takes the line's quantity.
--
-- Owner decision 2026-11-22: fabric sold by the metre is returned whole (the full quantity on the
-- bill line, e.g. 3.5 m) or not at all. exchanges.quantity was int4 and exchange_record cast the
-- quantity to int, so a 3.5 m line could not be returned at all (22P02 from the cast).
--
--   - exchanges.quantity becomes numeric(10,3), as bill_items.quantity. No view, index, trigger
--     or policy reads the column; every function that does (bill_cancel, _bill_items_exchange_lock,
--     _online_return_free_units) already works in numeric. 11 rows on 2026-11-22.
--   - exchange_record reads the quantity as numeric. A metre line (bill_items.unit_type =
--     'meter') is returned only whole: the quantity must be all that is left on it (the line's
--     quantity less earlier exchanges), fractional or not, so 1 m of 3.5 m and 1 m of 2 m are
--     refused. Any other line takes whole numbers only, partial returns allowed, exactly as before.
--     Refusals: EXCHANGE_WHOLE_LINE (P0001, detail {bill_item_id, quantity, left}). A fraction with
--     more than 3 decimals can never equal a numeric(10,3) line, so nothing is rounded on insert.
--     Live 2026-11-22: no exchange on a metre line yet, so no earlier part return conflicts.
--   - Credit caps unchanged (they were already numeric): a whole-line return's cap is the line's
--     total, exactly.
-- Nothing else changes: body copied from live (schema/migration_manual_item_stock.sql's
-- definition), same signature, security definer, search_path and grants (create or replace keeps
-- them). Tests: schema/test_exchange_fractional_qty.sql.
--
-- Safe before or after the app/CLI change (tasks/fabric-return-plan.md section 3).
-- Read-only checks after:
--   select data_type, numeric_precision, numeric_scale from information_schema.columns
--    where table_schema = 'public' and table_name = 'exchanges' and column_name = 'quantity';
--   (numeric, 10, 3)
--   select count(*) from public.exchanges;  -- same count as before

begin;
set local lock_timeout = '3s';

alter table public.exchanges alter column quantity type numeric(10,3);

CREATE OR REPLACE FUNCTION public.exchange_record(p_billid integer, p_customerid integer, p_items jsonb, p_returndate timestamp without time zone DEFAULT NULL::timestamp without time zone)
 RETURNS integer[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js and bill_add_payment.
  c_paid_in_full_tolerance constant numeric := 1;
  o public.orders;
  b public.bills;
  e jsonb;
  bi public.bill_items;
  v_qty numeric;
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
  -- Left out: the time of the call, as the column default gave before.
  v_returndate timestamp := coalesce(p_returndate, current_timestamp::timestamp);
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
  -- A return cannot be dated before the sale, nor after today at the shop.
  if p_returndate is not null
     and (p_returndate::date < b.orderdate::date
          or p_returndate::date > (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'EXCHANGE_BAD_DATE' using errcode = 'P0001',
      detail = jsonb_build_object('billid', p_billid, 'orderdate', b.orderdate,
                                  'returndate', p_returndate)::text;
  end if;
  perform 1 from public.bill_items
   where bill_item_id in (select (x ->> 'bill_item_id')::int from jsonb_array_elements(p_items) x)
   order by bill_item_id for update;

  for e in select * from jsonb_array_elements(p_items) loop
    select * into bi from public.bill_items where bill_item_id = (e ->> 'bill_item_id')::int;
    if not found or bi.billid <> p_billid then
      raise exception 'item % is not on bill %', e ->> 'bill_item_id', p_billid;
    end if;
    v_qty := (e ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'item %: quantity must be positive', bi.bill_item_id;
    end if;

    -- every exchanges row on the line counts, online refund offsets included
    select coalesce(sum(quantity), 0), coalesce(sum(credit_amount), 0) into v_used, v_given
      from public.exchanges where original_bill_item_id = bi.bill_item_id;
    if v_used + v_qty > bi.quantity then
      raise exception 'item % already returned (% of %)', bi.bill_item_id, trim_scale(v_used), trim_scale(bi.quantity);
    end if;
    -- Fabric by the metre goes back whole (owner, 2026-11-22): a metre line only as all that is
    -- left on it, whole number or not. Any other line in whole numbers, as before.
    if (bi.unit_type = 'meter' and v_qty <> bi.quantity - v_used)
       or (bi.unit_type is distinct from 'meter' and v_qty <> trunc(v_qty)) then
      raise exception 'EXCHANGE_WHOLE_LINE' using errcode = 'P0001',
        detail = jsonb_build_object('bill_item_id', bi.bill_item_id, 'quantity', v_qty,
                                    'left', trim_scale(bi.quantity - v_used))::text;
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
    elsif bi.product_code is not null then
      -- A manual item (schema/migration_manual_item_stock.sql), named by the line itself, not by
      -- the caller. A code that is not a manual item moves nothing.
      perform public._manual_stock_apply(bi.product_code, v_qty);
    end if;

    insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount, voucher_id,
                                  product_name, product_code, returndate)
    values (bi.bill_item_id, v_qty, e ->> 'reason', p_customerid, v_credit, null,
            e ->> 'product_name', e ->> 'product_code', v_returndate)
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
$function$
;

-- PostgREST picks up the column type.
notify pgrst, 'reload schema';

commit;
