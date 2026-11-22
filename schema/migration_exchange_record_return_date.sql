-- exchange_record takes the day the goods came back, so a slip entered late keeps its own date.
--
-- exchanges.returndate was always the column default (current_timestamp), so an exchange entered
-- from a paper slip days later (the admin CLI, docs/admin-cli.md#exchanges) was dated the day it
-- was typed in, while the new bill carries the slip's date.
--
-- New optional last parameter p_returndate timestamp (default null):
--   - null (left out): returndate is current_timestamp, exactly what the column default gave, so
--     the Exchange page (ExchangePage.js, three named arguments, no date field) works unchanged.
--   - given: stored as returndate. Refused with EXCHANGE_BAD_DATE (P0001, detail
--     {billid, orderdate, returndate}) when its day is before the bill's orderdate day or after
--     today in India (Asia/Kolkata). The admin CLI sends the slip date at midday
--     ('YYYY-MM-DDT12:00:00'), as it dates a backdated payment, so no time zone moves the day.
-- Nothing else changes: same checks, locks, caps and error codes as
-- schema/migration_exchange_record_caps.sql (the latest definition, body copied from it), same
-- security definer, search_path, owner and grants.
--
-- Signature change: the old exchange_record(int, int, jsonb) is dropped in the same transaction,
-- or a three-argument call would be ambiguous between the two functions. Safe: no view, trigger
-- or other function references it (only the Exchange page, the admin CLI and schema/test_*.sql
-- call it, all with three or four arguments, which the new one takes). Dropping it drops its
-- grants, so they are given again below: execute for authenticated and service_role only.
--
-- Run after schema/migration_exchange_record_caps.sql. Until it is run, the admin CLI refuses an
-- exchange (it says to run this file) and writes nothing; the Exchange page is unaffected either way.
-- Read-only check after: select pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proacl
--   from pg_proc p where p.proname = 'exchange_record' and p.pronamespace = 'public'::regnamespace;
-- (one row: p_billid integer, p_customerid integer, p_items jsonb, p_returndate timestamp without
-- time zone; prosecdef true; execute for authenticated and service_role, not anon).

begin;
set local lock_timeout = '3s';

drop function if exists public.exchange_record(int, int, jsonb);

create or replace function public.exchange_record(
  p_billid int, p_customerid int, p_items jsonb, p_returndate timestamp default null)
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
$$;
revoke all on function public.exchange_record(int, int, jsonb, timestamp) from public, anon;
grant execute on function public.exchange_record(int, int, jsonb, timestamp) to authenticated, service_role;

-- PostgREST picks up the new signature.
notify pgrst, 'reload schema';

commit;
