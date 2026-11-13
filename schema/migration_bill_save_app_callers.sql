-- bill_save, ready for its first callers: the bill screen's new Finalize and Partial Payment,
-- and the admin CLI's bill create (owner decision 2026-11-12, double-cash fix).
--
-- Those callers inserted a finalized bill and then, when a later step failed, deleted it again.
-- Deleting a finalized bill set exchanges.new_billid back to null (ON DELETE SET NULL), so its
-- exchange credit could be spent a second time. bill_save does the whole save in one
-- transaction, so nothing is ever deleted to undo it, and bills now refuse deleting anything but
-- a draft (schema/migration_bill_status_states.sql).
--
-- Copied from schema/migration_bill_save.sql (live 2026-11-04) with three changes:
--   1. stock_reduced is written as not skip_stock. It used to take the column default (true)
--      even with skip_stock, so a bill saved with "Don't reduce stock" read as if it took stock.
--      The callers write stock_reduced today, and bill_save refuses it as a bill key, so it
--      follows skip_stock, the one choice that decides whether stock moves.
--   2. partial_create refuses a payment_amount that differs from the first payment (0 when
--      there is none). payment_amount is the sum of bill_payments once a bill has rows, and
--      schema/migration_bill_payments_ledger.sql holds bills to that.
--   3. The first payment's insert sets app.bill_payment_writer for that one insert, the marker
--      schema/migration_bill_payments_ledger.sql requires of every bill_payments insert.
-- Same signature, grants and error codes.
--
-- Run after schema/migration_bill_stock_reduced.sql (the column) and before
-- schema/migration_bill_payments_ledger.sql (which refuses payments without the marker).

set local lock_timeout = '3s';

-- p_payload keys: bill, items, salesperson_ids, skip_stock, voucher_id, exchange_ids,
-- exchange_balance_to_credit (finalize_create only), first_payment (partial_create only),
-- discount_codes. expect and billid are reserved for the update ops.
--
-- A bill or item key that is absent gets the column default, as a direct insert would, so
-- the defaults are coded by hand here: a missing key would otherwise become NULL. An unknown
-- key is refused, since dropping it silently would change a stored value.
--
-- Going negative is allowed: billing must never stop on stock, so nothing here floors it.
-- The result reports any such variant in negative_stock.
create or replace function public.bill_save(p_key uuid, p_op text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_bill_keys constant text[] := array[
    'customerid', 'notes', 'document_type', 'totalamount', 'gst_total', 'discount_total',
    'taxable_total', 'paymentstatus', 'finalized', 'applied_codes', 'payment_amount',
    'net_amount', 'final_amount', 'store_credit_used', 'exchange_credit_used',
    'exchange_source_bill', 'exchange_cash_refund', 'saleslocationid', 'salesmethodid',
    'orderdate'];
  c_item_keys constant text[] := array[
    'billid', 'quantity', 'mrp', 'variantid', 'product_name', 'product_code', 'category',
    'cost_price', 'alteration_charge', 'discount_total', 'subtotal', 'gst_rate', 'gst_amount',
    'total', 'stitch_type', 'unit_type', 'salesperson_id'];
  c_payload_keys constant text[] := array[
    'expect', 'bill', 'items', 'salesperson_ids', 'skip_stock', 'voucher_id', 'exchange_ids',
    'exchange_balance_to_credit', 'first_payment', 'discount_codes', 'billid'];
  c_payment_keys constant text[] := array['amount', 'salesmethodid', 'recorded_at'];
  -- Matches Number.EPSILON in the browser's round2, so the credit floor rounds identically.
  c_js_epsilon constant double precision := 2.220446049250313e-16;

  v_saved jsonb;
  v_status text;
  v_reason text;
  v_bill jsonb;
  v_items jsonb;
  v_payment jsonb;
  v_customer int;
  v_voucher text;
  v_skip_stock boolean;
  v_exchange_ids int[];
  v_exchange_balance numeric;
  v_credit_used numeric;
  v_variants uuid[];
  v_count int;
  v_linked int;
  v_billid int;
  v_bill_number text;
  v_variant uuid;
  v_qty numeric;
  v_after numeric;
  v_balance double precision;
  v_delta numeric;
  v_negative jsonb := '[]'::jsonb;
  v_payment_row public.bill_payments;
  v_payment_result jsonb;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = 'key and payload object are required';
  end if;
  if p_op is null or p_op not in ('finalize_create', 'partial_create') then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = format('unsupported op: %s', p_op);
  end if;

  -- Bad values and rejected rows surface below as data and integrity errors. The handler
  -- at the end turns them into BILL_BAD_PAYLOAD, and everything here rolls back with it.
  begin
    v_saved := public._bill_claim_key(p_key, p_op, p_payload);
    if v_saved is not null then
      return v_saved;
    end if;

    if p_op = 'finalize_create' then
      v_status := 'finalized';
      v_reason := 'bill_finalize';
    else
      v_status := 'partial';
      v_reason := 'bill_partial_finalize';
    end if;

    v_bill := nullif(p_payload -> 'bill', 'null'::jsonb);
    v_items := nullif(p_payload -> 'items', 'null'::jsonb);
    v_payment := nullif(p_payload -> 'first_payment', 'null'::jsonb);

    if exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (c_payload_keys)) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown payload key';
    end if;
    if nullif(p_payload -> 'billid', 'null'::jsonb) is not null then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'billid is assigned by the server';
    end if;
    if v_bill is null or jsonb_typeof(v_bill) <> 'object' then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'bill object is required';
    end if;
    -- bill_number and billid fail this check, so the trigger always assigns the number.
    if exists (select 1 from jsonb_object_keys(v_bill) k where k <> all (c_bill_keys)) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown or refused bill key';
    end if;
    if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'at least one item is required';
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) i where jsonb_typeof(i) <> 'object') then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'each item must be an object';
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) i, jsonb_object_keys(i) k
                where k <> all (c_item_keys)) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown or refused item key';
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) i where i ->> 'billid' is not null) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'item billid is assigned by the server';
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) i
                where coalesce((i ->> 'quantity')::numeric, 0) <= 0) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'item quantity must be above 0';
    end if;
    if v_bill ->> 'paymentstatus' is distinct from v_status
       or (v_bill ->> 'finalized')::boolean is not true then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('%s needs finalized true and paymentstatus %s', p_op, v_status);
    end if;

    v_exchange_balance := coalesce((p_payload ->> 'exchange_balance_to_credit')::numeric, 0);
    -- These two steps belong to one path each, as on the screen.
    if p_op = 'finalize_create' and v_payment is not null then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'first_payment is for partial_create only';
    end if;
    if p_op = 'partial_create' and v_exchange_balance <> 0 then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'exchange balance is for finalize_create only';
    end if;
    if v_payment is not null then
      if jsonb_typeof(v_payment) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_payment) k where k <> all (c_payment_keys)) then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'bad first_payment';
      end if;
    end if;
    -- A part-paid bill's payment_amount is the sum of its bill_payments rows, and the first
    -- payment is the only row, so the two must agree from the start.
    if p_op = 'partial_create'
       and coalesce((v_bill ->> 'payment_amount')::numeric, 0)
           <> coalesce((v_payment ->> 'amount')::numeric, 0) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'payment_amount must equal the first payment';
    end if;

    v_customer := (v_bill ->> 'customerid')::int;
    v_voucher := p_payload ->> 'voucher_id';
    v_skip_stock := coalesce((p_payload ->> 'skip_stock')::boolean, false);
    v_credit_used := coalesce((v_bill ->> 'store_credit_used')::numeric, 0);
    v_exchange_ids := array(
      select distinct e::int
        from jsonb_array_elements_text(coalesce(nullif(p_payload -> 'exchange_ids', 'null'::jsonb), '[]'::jsonb)) e);
    v_variants := array(
      select distinct (i ->> 'variantid')::uuid
        from jsonb_array_elements(v_items) i
       where i ->> 'variantid' is not null);

    -- Locks run voucher, variants, customer, exchanges, then the bill number counter on the
    -- insert below. That matches online_order_create, and the counter stays last so a refused
    -- save never makes the online bill step wait.
    if v_voucher is not null then
      perform 1 from public.vouchers
        where voucher_id = v_voucher
          and coalesce(redeemed, false) = false
          and held_order_id is null
          and expiry_date >= current_date
        for update;
      if not found then
        raise exception 'BILL_VOUCHER_REFUSED' using errcode = 'P0001', detail = v_voucher;
      end if;
    end if;

    -- FOR NO KEY UPDATE, not FOR UPDATE: online_order_create_bos holds the counter and then
    -- takes foreign key locks on these same variants and customer. FOR UPDATE here would make
    -- the two wait on each other. This strength still serializes every stock and credit change.
    select count(*) into v_count from (
      select 1 from public.productsizecolors
       where variantid = any (v_variants)
       order by variantid
       for no key update) locked;
    if v_count <> coalesce(array_length(v_variants, 1), 0) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown variant';
    end if;

    if v_customer is not null and (v_credit_used > 0 or v_exchange_balance > 0) then
      select c.store_credit into v_balance from public.customers c
       where c.customerid = v_customer
         for no key update;
    end if;

    if coalesce(array_length(v_exchange_ids, 1), 0) > 0 then
      select count(*), count(new_billid) into v_count, v_linked from (
        select new_billid from public.exchanges
         where exchangeid = any (v_exchange_ids)
         order by exchangeid
         for no key update) locked;
      if v_count <> array_length(v_exchange_ids, 1) then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown exchange';
      end if;
      if v_linked > 0 then
        raise exception 'BILL_EXCHANGE_USED' using errcode = 'P0001';
      end if;
    end if;

    -- orderdate is cast straight to timestamp, which drops the +05:30 and keeps the date the
    -- client sent. Going through timestamptz would move it to the previous day, which can
    -- change the bill's financial year.
    insert into public.bills (
      customerid, notes, document_type, totalamount, gst_total, discount_total, taxable_total,
      paymentstatus, finalized, applied_codes, payment_amount, net_amount, final_amount,
      store_credit_used, exchange_credit_used, exchange_source_bill, exchange_cash_refund,
      saleslocationid, salesmethodid, orderdate, stock_reduced)
    values (
      v_customer,
      v_bill ->> 'notes',
      case when v_bill ? 'document_type' then v_bill ->> 'document_type' else 'bos' end,
      (v_bill ->> 'totalamount')::numeric,
      (v_bill ->> 'gst_total')::numeric,
      (v_bill ->> 'discount_total')::numeric,
      (v_bill ->> 'taxable_total')::numeric,
      v_bill ->> 'paymentstatus',
      (v_bill ->> 'finalized')::boolean,
      case when not (v_bill ? 'applied_codes') then '{}'::text[]
           when v_bill -> 'applied_codes' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(v_bill -> 'applied_codes')) end,
      (v_bill ->> 'payment_amount')::numeric,
      (v_bill ->> 'net_amount')::numeric,
      (v_bill ->> 'final_amount')::numeric,
      case when v_bill ? 'store_credit_used' then (v_bill ->> 'store_credit_used')::numeric else 0 end,
      case when v_bill ? 'exchange_credit_used' then (v_bill ->> 'exchange_credit_used')::numeric else 0 end,
      v_bill ->> 'exchange_source_bill',
      case when v_bill ? 'exchange_cash_refund' then (v_bill ->> 'exchange_cash_refund')::numeric else 0 end,
      (v_bill ->> 'saleslocationid')::int,
      (v_bill ->> 'salesmethodid')::int,
      case when v_bill ? 'orderdate' then (v_bill ->> 'orderdate')::timestamp else localtimestamp end,
      not v_skip_stock)
    returning billid, bill_number into v_billid, v_bill_number;

    if v_voucher is not null and not public.voucher_redeem(v_voucher, v_billid) then
      raise exception 'BILL_VOUCHER_REFUSED' using errcode = 'P0001', detail = v_voucher;
    end if;

    if coalesce(array_length(v_exchange_ids, 1), 0) > 0 then
      update public.exchanges set new_billid = v_billid where exchangeid = any (v_exchange_ids);
    end if;

    insert into public.bill_items (
      billid, quantity, mrp, variantid, product_name, product_code, category, cost_price,
      alteration_charge, discount_total, subtotal, gst_rate, gst_amount, total, stitch_type,
      unit_type, salesperson_id)
    select
      v_billid,
      (i ->> 'quantity')::numeric,
      (i ->> 'mrp')::numeric,
      (i ->> 'variantid')::uuid,
      i ->> 'product_name',
      i ->> 'product_code',
      i ->> 'category',
      (i ->> 'cost_price')::numeric,
      case when i ? 'alteration_charge' then (i ->> 'alteration_charge')::numeric else 0 end,
      case when i ? 'discount_total' then (i ->> 'discount_total')::numeric else 0 end,
      (i ->> 'subtotal')::numeric,
      (i ->> 'gst_rate')::numeric,
      (i ->> 'gst_amount')::numeric,
      (i ->> 'total')::numeric,
      case when i ? 'stitch_type' then i ->> 'stitch_type' else 'unstitched' end,
      case when i ? 'unit_type' then i ->> 'unit_type' else 'piece' end,
      (i ->> 'salesperson_id')::int
    from jsonb_array_elements(v_items) with ordinality as t(i, ord)
    order by ord;

    insert into public.bill_salespersons (billid, salesperson_id)
    select distinct v_billid, s::int
      from jsonb_array_elements_text(coalesce(nullif(p_payload -> 'salesperson_ids', 'null'::jsonb), '[]'::jsonb)) s;

    for v_variant, v_qty in
      select (i ->> 'variantid')::uuid, sum((i ->> 'quantity')::numeric)
        from jsonb_array_elements(v_items) i
       where i ->> 'variantid' is not null
       group by 1
       order by 1
    loop
      if v_skip_stock then
        select stock into v_after from public.productsizecolors where variantid = v_variant;
        insert into public.bill_stock_moves (billid, variantid, delta, stock_after, reason, idempotency_key)
        values (v_billid, v_variant, 0, v_after, v_reason, p_key);
      else
        v_after := public._stock_apply(v_variant, -v_qty);
        insert into public.bill_stock_moves (billid, variantid, delta, stock_after, reason, idempotency_key)
        values (v_billid, v_variant, -v_qty, v_after, v_reason, p_key);
        if v_after < 0 then
          v_negative := v_negative || jsonb_build_object('variantid', v_variant, 'stock', v_after);
        end if;
      end if;
    end loop;

    if v_payment is not null then
      -- bill_payments takes rows only from bill_save and bill_add_payment, which set this for
      -- their own insert (schema/migration_bill_payments_ledger.sql).
      perform set_config('app.bill_payment_writer', 'on', true);
      insert into public.bill_payments (billid, amount, salesmethodid, recorded_at)
      values (
        v_billid,
        (v_payment ->> 'amount')::numeric,
        (v_payment ->> 'salesmethodid')::int,
        coalesce((v_payment ->> 'recorded_at')::timestamp, localtimestamp))
      returning * into v_payment_row;
      perform set_config('app.bill_payment_writer', '', true);
      v_payment_result := jsonb_build_object(
        'payment_id', v_payment_row.payment_id,
        'amount', v_payment_row.amount,
        'salesmethodid', v_payment_row.salesmethodid,
        'recorded_at', v_payment_row.recorded_at,
        'salesmethods', (select jsonb_build_object('methodname', m.methodname)
                           from public.salesmethods m
                          where m.salesmethodid = v_payment_row.salesmethodid));
    end if;

    insert into public.discount_usage (customerid, code, billid)
    select v_customer, c, v_billid
      from jsonb_array_elements_text(coalesce(nullif(p_payload -> 'discount_codes', 'null'::jsonb), '[]'::jsonb)) c;

    if v_customer is not null and v_credit_used > 0 then
      -- Same formula and double precision arithmetic as storeCreditDeductionDelta in the
      -- browser, so the floor at 0 gives the same paise, now read under the customer lock.
      v_balance := coalesce(v_balance, 0);
      v_delta := (floor(((greatest(0::double precision, v_balance - v_credit_used::double precision) - v_balance)
                         + c_js_epsilon) * 100 + 0.5) / 100)::numeric;
      perform public._store_credit_apply(v_customer, v_delta, v_reason, v_billid::text, 'instore', 'bill');
    end if;

    if v_customer is not null and v_exchange_balance > 0 then
      perform public._store_credit_apply(v_customer, v_exchange_balance, 'exchange_credit', v_billid::text, 'instore', 'bill');
    end if;

    v_result := jsonb_build_object(
      'op', p_op,
      'billid', v_billid,
      'bill_number', v_bill_number,
      'replayed', false,
      'negative_stock', v_negative,
      'payment', v_payment_result);
    update public.bill_save_log
       set billid = v_billid, result = v_result
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

revoke all on function public.bill_save(uuid, text, jsonb) from public, anon;
grant execute on function public.bill_save(uuid, text, jsonb) to authenticated, service_role;
