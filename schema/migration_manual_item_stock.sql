-- Billing a manual item (BCX…, manual_items) takes its stock, as a product variant's is taken, and
-- a cancel, edit or exchange gives it back. Plan and live findings: tasks/manual-item-stock-plan.md.
--
-- Before this, no sale path touched manual_items.stock: every item read 1, sold or not, and
-- exchange_record's manual branch never ran (the Exchange page and CLI always sent a null
-- manual_item_id), so a returned piece was not counted twice.
--
-- A manual line is a bill line with no variantid whose product_code is a manual_items id (there is
-- no foreign key; the screen and CLI join them this way). Its quantity moves stock exactly: fabric
-- is sold by the metre, so 3.5 m sold lowers stock by 3.5 (owner, 2026-11-22). No manual move is
-- logged in bill_stock_moves (variantid is uuid not null there); the stock a live bill holds is its
-- manual lines' quantity less what was exchanged from them, the rule bill_cancel already uses for a
-- bill without moves.
--
-- Changes:
--   - manual_items.stock: int4 -> numeric(10,3), as bill_items.quantity. Default 1 and not null
--     stay. No view, trigger or function body depends on the type.
--   - _manual_stock_apply(id, delta): internal, as _stock_apply. Returns the new stock, or null when
--     the id is not a manual item (a line with no variant that is not one moves nothing).
--   - manual_item_stock_adjust(id, delta, reason, ref): staff RPC, as stock_adjust, for the new
--     draft the screen and CLI insert directly (BillingForm.handleSaveDraft, bills.js insertDraft).
--   - bill_save (finalize_create, partial_create): takes each manual item's quantity unless
--     skip_stock. Below 0 is allowed, as for variants, and listed in negative_stock as
--     { manual_item_id, stock }.
--   - _bill_lines_save (finishing a draft, bill_edit): moves the difference between the saved lines
--     and the new ones (read from the rows after the change), unless the bill's stock_reduced is
--     false. Below 0 listed as above.
--   - bill_cancel: gives back each item's line quantity less what was exchanged from those lines,
--     when variants are given back (v_restock) and stock_reduced is not false. Listed in the
--     result's stock as { manual_item_id, qty }.
--   - exchange_record: a returned manual line puts its quantity back on the item named by the
--     line's product_code, as a variant line does (whatever the bill's stock_reduced). The client's
--     manual_item_id key is no longer read: the line itself says which item it was. Quantities
--     stay whole numbers (exchanges.quantity is int); returning part of a metre is not supported.
-- Everything else in the four bodies is the live definition as of 2026-11-22 (pg_get_functiondef),
-- unchanged: checks, locks, error codes, security definer, search_path, owner and grants
-- (create or replace keeps grants).
--
-- Run schema/migration_manual_item_stock_backfill.sql right after this: it sets the stock of items
-- already sold. Merge the app and CLI changes only after both (the new draft path calls
-- manual_item_stock_adjust, and a fabric item is created with a fractional stock).
-- Read-only checks after:
--   select data_type, numeric_precision, numeric_scale from information_schema.columns
--    where table_name = 'manual_items' and column_name = 'stock';          -- numeric 10 3
--   select p.proname, p.proacl from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('_manual_stock_apply', 'manual_item_stock_adjust');
--   -- _manual_stock_apply: postgres and service_role only; manual_item_stock_adjust: + authenticated
-- Tests: schema/test_manual_item_stock.sql.

begin;
set local lock_timeout = '3s';

alter table public.manual_items alter column stock type numeric(10,3) using stock::numeric(10,3);

create or replace function public._manual_stock_apply(p_manual_item_id text, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
begin
  if p_delta is null then
    raise exception 'manual_stock_apply: delta is required';
  end if;
  update public.manual_items
     set stock = stock + p_delta
   where manual_item_id = p_manual_item_id
  returning stock into v_stock;
  -- Null when p_manual_item_id is not a manual item: the caller's line moves no stock.
  return v_stock;
end;
$$;
revoke all on function public._manual_stock_apply(text, numeric) from public, anon, authenticated;

create or replace function public.manual_item_stock_adjust(
  p_manual_item_id text, p_delta numeric, p_reason text, p_ref text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_stock := public._manual_stock_apply(p_manual_item_id, p_delta);
  if v_stock is null then
    raise exception 'manual_item_stock_adjust: manual item % not found', p_manual_item_id;
  end if;
  return v_stock;
end;
$$;
revoke all on function public.manual_item_stock_adjust(text, numeric, text, text) from public, anon;
grant execute on function public.manual_item_stock_adjust(text, numeric, text, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bill_save(p_key uuid, p_op text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  c_expect_keys constant text[] := array['paymentstatus', 'payment_amount'];
  c_payment_keys constant text[] := array['amount', 'salesmethodid', 'recorded_at'];
  -- Same as PAID_IN_FULL_TOLERANCE in paymentHelpers.js and bill_add_payment.
  c_paid_in_full_tolerance constant numeric := 1;
  -- How far a paid bill's amount received may be above its net: the screen's "Must be within
  -- ₹100" (BillingForm.openFinalizeConfirm) and the CLI's PAYMENT_TOLERANCE.
  c_received_over_net constant numeric := 100;
  -- How far totalamount may be above its lines' totals: rounding, line by line versus once.
  c_total_over_lines constant numeric := 1;
  -- Each of the three exchange figures is rounded to paise in the browser.
  c_exchange_rounding constant numeric := 0.01;

  v_saved jsonb;
  v_draft boolean;
  v_status text;
  v_reason text;
  v_bill jsonb;
  v_items jsonb;
  v_payment jsonb;
  v_expect jsonb;
  v_draft_row public.bills;
  v_customer int;
  v_voucher text;
  v_voucher_row public.vouchers;
  v_skip_stock boolean;
  v_exchange_ids int[];
  v_exchange_balance numeric;
  v_exchange_total numeric;
  v_credit_used numeric;
  v_total numeric;
  v_exchange_used numeric;
  v_exchange_cash numeric;
  v_bad_field text;
  v_net numeric;
  v_paid numeric;
  v_variants uuid[];
  v_count int;
  v_linked int;
  v_billid int;
  v_bill_number text;
  v_variant uuid;
  v_manual text;
  v_qty numeric;
  v_after numeric;
  v_balance numeric;
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
  if p_op is null or p_op not in ('finalize_create', 'partial_create', 'finalize_draft', 'partial_draft') then
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

    v_draft := p_op in ('finalize_draft', 'partial_draft');
    if p_op in ('finalize_create', 'finalize_draft') then
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
    if not v_draft and nullif(p_payload -> 'billid', 'null'::jsonb) is not null then
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
    -- A draft's lines are checked by _bill_lines_save, which also takes their bill_item_id.
    if not v_draft then
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
    end if;
    if v_bill ->> 'paymentstatus' is distinct from v_status
       or (v_bill ->> 'finalized')::boolean is not true then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('%s needs finalized true and paymentstatus %s', p_op, v_status);
    end if;

    v_exchange_balance := coalesce((p_payload ->> 'exchange_balance_to_credit')::numeric, 0);
    -- These two steps belong to one path each, as on the screen.
    if v_status = 'finalized' and v_payment is not null then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'first_payment is for the part-paid ops only';
    end if;
    if v_status = 'partial' and v_exchange_balance <> 0 then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'exchange balance is for the finalize ops only';
    end if;
    if v_payment is not null then
      if jsonb_typeof(v_payment) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_payment) k where k <> all (c_payment_keys)) then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'bad first_payment';
      end if;
    end if;
    -- A part-paid bill's payment_amount is the sum of its bill_payments rows, and the first
    -- payment is the only row, so the two must agree from the start.
    if v_status = 'partial'
       and coalesce((v_bill ->> 'payment_amount')::numeric, 0)
           <> coalesce((v_payment ->> 'amount')::numeric, 0) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'payment_amount must equal the first payment';
    end if;

    if v_draft then
      v_expect := p_payload -> 'expect';
      if (p_payload ->> 'billid') is null
         or jsonb_typeof(v_expect) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_expect) k)
            is distinct from (select array_agg(k order by k) from unnest(c_expect_keys) k) then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
          detail = format('%s needs billid and expect (paymentstatus, payment_amount)', p_op);
      end if;
      -- The number series was fixed when the draft was saved.
      if v_bill ? 'document_type' then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'document_type cannot change on a saved bill';
      end if;

      v_billid := (p_payload ->> 'billid')::int;
      -- NO KEY UPDATE, as bill_edit and bill_add_payment: serializes with them and bill_cancel
      -- on this bill without blocking foreign key checks from rows that reference it.
      select * into v_draft_row from public.bills where billid = v_billid for no key update;
      if not found then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
          detail = format('bill %s not found', v_billid);
      end if;
      if v_draft_row.paymentstatus is distinct from v_expect ->> 'paymentstatus'
         or v_draft_row.payment_amount is distinct from (v_expect ->> 'payment_amount')::numeric
         or v_draft_row.paymentstatus is distinct from 'draft'
         or v_draft_row.finalized is not false then
        raise exception 'BILL_STALE' using errcode = 'P0001',
          detail = jsonb_build_object('paymentstatus', v_draft_row.paymentstatus,
                                      'payment_amount', v_draft_row.payment_amount)::text;
      end if;
      v_bill_number := v_draft_row.bill_number;
    end if;

    v_customer := case when v_draft and not (v_bill ? 'customerid') then v_draft_row.customerid
                       else (v_bill ->> 'customerid')::int end;
    v_voucher := p_payload ->> 'voucher_id';
    -- A draft keeps the stock choice it was saved with: _bill_lines_save follows its stock_reduced.
    v_skip_stock := coalesce((p_payload ->> 'skip_stock')::boolean, false);
    -- A draft op keeps a store_credit_used left out of the payload, so it takes that figure too.
    v_credit_used := round(coalesce((v_bill ->> 'store_credit_used')::numeric,
                                    case when v_draft then v_draft_row.store_credit_used end, 0), 2);
    -- Keys left out of a draft op keep the draft's value, so they are read the same way. Not
    -- rounded yet: the net below rounds once, as the screen's figure is rounded on save.
    v_total := coalesce((v_bill ->> 'totalamount')::numeric,
                        case when v_draft then v_draft_row.totalamount end, 0);
    v_exchange_used := coalesce((v_bill ->> 'exchange_credit_used')::numeric,
                                case when v_draft then v_draft_row.exchange_credit_used end, 0);
    v_exchange_cash := coalesce((v_bill ->> 'exchange_cash_refund')::numeric,
                                case when v_draft then v_draft_row.exchange_cash_refund end, 0);
    v_paid := round(coalesce((v_bill ->> 'payment_amount')::numeric,
                             case when v_draft then v_draft_row.payment_amount end, 0), 2);
    -- NaN sorts above Infinity, so ">= Infinity" refuses both (see the header).
    select f into v_bad_field
      from (values (1, 'totalamount', v_total),
                   (2, 'store_credit_used', v_credit_used),
                   (3, 'exchange_credit_used', v_exchange_used),
                   (4, 'exchange_cash_refund', v_exchange_cash),
                   (5, 'exchange_balance_to_credit', v_exchange_balance),
                   (6, 'payment_amount', v_paid),
                   (7, 'net_amount', (v_bill ->> 'net_amount')::numeric),
                   (8, 'first_payment amount', (v_payment ->> 'amount')::numeric)) x(n, f, v)
     where v < 0 or v >= 'Infinity'::numeric
     order by n
     limit 1;
    if v_bad_field is not null then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('%s must be 0 or more', v_bad_field);
    end if;
    -- Worked out as the screen does; never the net_amount sent (see the header), nor the
    -- draft's own (that is the net of its last Save Changes).
    v_net := round(greatest(0, v_total - v_credit_used - v_exchange_used), 2);
    v_exchange_ids := array(
      select distinct e::int
        from jsonb_array_elements_text(coalesce(nullif(p_payload -> 'exchange_ids', 'null'::jsonb), '[]'::jsonb)) e);

    -- Locks run voucher, variants, customer, exchanges, then the bill number counter on the
    -- insert below. That matches online_order_create, and the counter stays last so a refused
    -- save never makes the online bill step wait. A draft has its number already, and its
    -- row lock comes first.
    if v_voucher is not null then
      select * into v_voucher_row from public.vouchers where voucher_id = v_voucher for update;
      if not found
         or not (public.voucher_state(v_voucher_row) = 'available'
                 or (v_draft and v_voucher_row.redeemed and v_voucher_row.redeemed_billid = v_billid
                     and v_voucher_row.held_order_id is null)) then
        raise exception 'BILL_VOUCHER_REFUSED' using errcode = 'P0001', detail = v_voucher;
      end if;
    end if;

    if v_draft then
      -- The bill row first: the payment trigger refuses a payment on a draft, and the lines
      -- below are this bill's.
      update public.bills b set
        customerid = v_customer,
        notes = case when v_bill ? 'notes' then v_bill ->> 'notes' else b.notes end,
        totalamount = case when v_bill ? 'totalamount' then (v_bill ->> 'totalamount')::numeric else b.totalamount end,
        gst_total = case when v_bill ? 'gst_total' then (v_bill ->> 'gst_total')::numeric else b.gst_total end,
        discount_total = case when v_bill ? 'discount_total' then (v_bill ->> 'discount_total')::numeric else b.discount_total end,
        taxable_total = case when v_bill ? 'taxable_total' then (v_bill ->> 'taxable_total')::numeric else b.taxable_total end,
        paymentstatus = v_status,
        finalized = true,
        applied_codes = case when not (v_bill ? 'applied_codes') then b.applied_codes
                             when v_bill -> 'applied_codes' = 'null'::jsonb then null
                             else array(select jsonb_array_elements_text(v_bill -> 'applied_codes')) end,
        payment_amount = case when v_bill ? 'payment_amount' then (v_bill ->> 'payment_amount')::numeric else b.payment_amount end,
        -- Not the draft's own: that is the net of its last Save Changes, which may be stale.
        net_amount = v_net,
        final_amount = case when v_bill ? 'final_amount' then (v_bill ->> 'final_amount')::numeric else b.final_amount end,
        store_credit_used = case when v_bill ? 'store_credit_used' then (v_bill ->> 'store_credit_used')::numeric else b.store_credit_used end,
        exchange_credit_used = case when v_bill ? 'exchange_credit_used' then (v_bill ->> 'exchange_credit_used')::numeric else b.exchange_credit_used end,
        exchange_source_bill = case when v_bill ? 'exchange_source_bill' then v_bill ->> 'exchange_source_bill' else b.exchange_source_bill end,
        exchange_cash_refund = case when v_bill ? 'exchange_cash_refund' then (v_bill ->> 'exchange_cash_refund')::numeric else b.exchange_cash_refund end,
        saleslocationid = case when v_bill ? 'saleslocationid' then (v_bill ->> 'saleslocationid')::int else b.saleslocationid end,
        salesmethodid = case when v_bill ? 'salesmethodid' then (v_bill ->> 'salesmethodid')::int else b.salesmethodid end,
        -- Cast straight to timestamp, as on insert below.
        orderdate = case when v_bill ? 'orderdate' then (v_bill ->> 'orderdate')::timestamp else b.orderdate end
      where b.billid = v_billid
      returning * into v_draft_row;

      v_negative := public._bill_lines_save(v_billid, v_items, (p_payload ->> 'skip_stock')::boolean,
                                            v_reason, p_key);
    else
      v_variants := array(
        select distinct (i ->> 'variantid')::uuid
          from jsonb_array_elements(v_items) i
         where i ->> 'variantid' is not null);
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
    end if;

    if v_customer is not null and (v_credit_used > 0 or v_exchange_balance > 0) then
      select round(c.store_credit::numeric, 2) into v_balance from public.customers c
       where c.customerid = v_customer
         for no key update;
    end if;
    -- Another window or a stale draft may have spent the credit since the screen read it.
    if v_credit_used > 0 and (v_customer is null or v_credit_used > coalesce(v_balance, 0)) then
      raise exception 'BILL_CREDIT_SHORT' using errcode = 'P0001',
        detail = jsonb_build_object('balance', coalesce(v_balance, 0), 'requested', v_credit_used)::text;
    end if;

    v_exchange_total := 0;
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
      -- Credit from an exchange is the customer's who returned the goods. One recorded with no
      -- customer cannot be told apart, so any customer may use it, once.
      if exists (select 1 from public.exchanges e
                  where e.exchangeid = any (v_exchange_ids)
                    and e.customerid is not null and e.customerid is distinct from v_customer) then
        raise exception 'BILL_EXCHANGE_CUSTOMER' using errcode = 'P0001',
          detail = jsonb_build_object('customerid', v_customer)::text;
      end if;
      select coalesce(sum(e.credit_amount), 0) into v_exchange_total
        from public.exchanges e where e.exchangeid = any (v_exchange_ids);
    end if;
    -- What the bill takes from the exchanges, puts on store credit and pays out in cash cannot
    -- add up to more than they hold.
    if round(v_exchange_used, 2) + round(v_exchange_balance, 2) + round(v_exchange_cash, 2)
       - round(v_exchange_total, 2) > c_exchange_rounding then
      raise exception 'BILL_EXCHANGE_OVER' using errcode = 'P0001',
        detail = jsonb_build_object('exchange_credit', round(v_exchange_total, 2))::text;
    end if;

    if (v_status = 'finalized' and v_paid - v_net > c_received_over_net)
       or (v_status = 'partial' and v_paid - v_net >= c_paid_in_full_tolerance) then
      raise exception 'BILL_OVERPAID' using errcode = 'P0001',
        detail = jsonb_build_object('net', v_net, 'payment_amount', v_paid)::text;
    end if;

    if not v_draft then
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
        v_net,
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
    end if;

    if v_voucher is not null and public.voucher_state(v_voucher_row) = 'available'
       and not public.voucher_redeem(v_voucher, v_billid) then
      raise exception 'BILL_VOUCHER_REFUSED' using errcode = 'P0001', detail = v_voucher;
    end if;

    if coalesce(array_length(v_exchange_ids, 1), 0) > 0 then
      update public.exchanges set new_billid = v_billid where exchangeid = any (v_exchange_ids);
    end if;

    if not v_draft then
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
    end if;

    if v_total - (select coalesce(sum(bi.total), 0) from public.bill_items bi where bi.billid = v_billid)
       > c_total_over_lines then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'totalamount is more than the lines add up to';
    end if;

    -- A draft's salespeople are replaced, as the screen did.
    if v_draft then
      delete from public.bill_salespersons where billid = v_billid;
    end if;
    insert into public.bill_salespersons (billid, salesperson_id)
    select distinct v_billid, s::int
      from jsonb_array_elements_text(coalesce(nullif(p_payload -> 'salesperson_ids', 'null'::jsonb), '[]'::jsonb)) s;

    if not v_draft then
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
    end if;

    -- Manual items (schema/migration_manual_item_stock.sql): a line with no variant whose
    -- product_code is a manual item takes its exact quantity. In id order, so two saves lock the
    -- same items in the same order. A draft's lines are moved by _bill_lines_save above.
    if not v_draft and not v_skip_stock then
      for v_manual, v_qty in
        select i ->> 'product_code', sum((i ->> 'quantity')::numeric)
          from jsonb_array_elements(v_items) i
         where i ->> 'variantid' is null and i ->> 'product_code' is not null
         group by 1
         order by 1
      loop
        v_after := public._manual_stock_apply(v_manual, -v_qty);
        if v_after < 0 then
          v_negative := v_negative || jsonb_build_object('manual_item_id', v_manual, 'stock', v_after);
        end if;
      end loop;
    end if;

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

    -- A draft records no use; any left by an earlier finish of the old screen is replaced.
    if v_draft then
      delete from public.discount_usage where billid = v_billid;
    end if;
    insert into public.discount_usage (customerid, code, billid)
    select v_customer, c, v_billid
      from jsonb_array_elements_text(coalesce(nullif(p_payload -> 'discount_codes', 'null'::jsonb), '[]'::jsonb)) c;

    -- Exactly what the bill records: the balance was checked above, under the same lock.
    if v_credit_used > 0 then
      perform public._store_credit_apply(v_customer, -v_credit_used, v_reason, v_billid::text, 'instore', 'bill');
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
$function$
;

CREATE OR REPLACE FUNCTION public._bill_lines_save(p_billid integer, p_items jsonb, p_skip_stock boolean, p_reason text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_item_keys constant text[] := array[
    'bill_item_id', 'billid', 'quantity', 'mrp', 'variantid', 'product_name', 'product_code',
    'category', 'cost_price', 'alteration_charge', 'discount_total', 'subtotal', 'gst_rate',
    'gst_amount', 'total', 'stitch_type', 'unit_type', 'salesperson_id'];
  v_ids int[];
  v_found int;
  v_has_moves boolean;
  v_skip_stock boolean;
  v_variants uuid[];
  v_count int;
  v_delta_variants uuid[];
  v_deltas numeric[];
  v_manual_before jsonb;
  v_manual text;
  v_variant uuid;
  v_delta numeric;
  v_after numeric;
  v_negative jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'at least one item is required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) <> 'object') then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'each item must be an object';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i, jsonb_object_keys(i) k
              where k <> all (c_item_keys)) then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown or refused item key';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where i ->> 'billid' is not null) then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'item billid is assigned by the server';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
              where coalesce((i ->> 'quantity')::numeric, 0) <= 0) then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'item quantity must be above 0';
  end if;
  v_ids := array(select (i ->> 'bill_item_id')::int from jsonb_array_elements(p_items) i
                  where i ->> 'bill_item_id' is not null);
  if (select count(distinct x) from unnest(v_ids) x) <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'a line is listed twice';
  end if;

  -- FOR UPDATE, as exchange_record takes them: no exchange lands on a line while it changes.
  perform 1 from public.bill_items bi where bi.billid = p_billid order by bi.bill_item_id for update;
  select count(*) into v_found from public.bill_items bi
   where bi.billid = p_billid and bi.bill_item_id = any (v_ids);
  if v_found <> coalesce(array_length(v_ids, 1), 0) then
    -- Another window removed a line this one still shows.
    raise exception 'BILL_STALE' using errcode = 'P0001',
      detail = format('bill %s no longer has every line this save names', p_billid);
  end if;
  v_has_moves := exists (select 1 from public.bill_stock_moves m where m.billid = p_billid);
  -- Bills from before stock_reduced (null) kept moving stock on edits, so they still do.
  select b.stock_reduced is false into v_skip_stock from public.bills b where b.billid = p_billid;
  if p_skip_stock is not null and p_skip_stock is distinct from v_skip_stock then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = 'Don''t reduce stock can''t change after the bill is saved';
  end if;

  -- Every variant the old or new lines name, locked in one order (as bill_save and bill_cancel).
  -- NO KEY UPDATE for the same reason as bill_save: online_order_create_bos holds the bill
  -- counter and then takes foreign key locks on variants.
  v_variants := array(
    select variantid from public.bill_items where billid = p_billid and variantid is not null
    union
    select (i ->> 'variantid')::uuid from jsonb_array_elements(p_items) i where i ->> 'variantid' is not null);
  select count(*) into v_count from (
    select 1 from public.productsizecolors
     where variantid = any (v_variants)
     order by variantid
     for no key update) locked;
  if exists (select 1 from jsonb_array_elements(p_items) i
              where i ->> 'variantid' is not null
                and not exists (select 1 from public.productsizecolors p
                                 where p.variantid = (i ->> 'variantid')::uuid)) then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown variant';
  end if;

  -- What the saved lines took, less what the new ones take, read before any line changes.
  select coalesce(array_agg(v order by v), '{}'), coalesce(array_agg(d order by v), '{}')
    into v_delta_variants, v_deltas
    from (select v, sum(q) as d from (
            select bi.variantid as v, bi.quantity as q
              from public.bill_items bi where bi.billid = p_billid and bi.variantid is not null
            union all
            select (i ->> 'variantid')::uuid, -(i ->> 'quantity')::numeric
              from jsonb_array_elements(p_items) i where i ->> 'variantid' is not null) moved
          group by v) per_variant
   where d <> 0;
  -- Manual items: what the saved lines hold, by item, to set against the lines once changed.
  select coalesce(jsonb_object_agg(c, q), '{}'::jsonb) into v_manual_before
    from (select bi.product_code as c, sum(bi.quantity) as q
            from public.bill_items bi
           where bi.billid = p_billid and bi.variantid is null and bi.product_code is not null
           group by bi.product_code) saved;

  delete from public.bill_items bi
   where bi.billid = p_billid and not (bi.bill_item_id = any (v_ids));

  -- A key left out keeps the saved value, as the screen's direct update did.
  update public.bill_items bi set
    quantity = case when i ? 'quantity' then (i ->> 'quantity')::numeric else bi.quantity end,
    mrp = case when i ? 'mrp' then (i ->> 'mrp')::numeric else bi.mrp end,
    variantid = case when i ? 'variantid' then (i ->> 'variantid')::uuid else bi.variantid end,
    product_name = case when i ? 'product_name' then i ->> 'product_name' else bi.product_name end,
    product_code = case when i ? 'product_code' then i ->> 'product_code' else bi.product_code end,
    category = case when i ? 'category' then i ->> 'category' else bi.category end,
    cost_price = case when i ? 'cost_price' then (i ->> 'cost_price')::numeric else bi.cost_price end,
    alteration_charge = case when i ? 'alteration_charge' then (i ->> 'alteration_charge')::numeric else bi.alteration_charge end,
    discount_total = case when i ? 'discount_total' then (i ->> 'discount_total')::numeric else bi.discount_total end,
    subtotal = case when i ? 'subtotal' then (i ->> 'subtotal')::numeric else bi.subtotal end,
    gst_rate = case when i ? 'gst_rate' then (i ->> 'gst_rate')::numeric else bi.gst_rate end,
    gst_amount = case when i ? 'gst_amount' then (i ->> 'gst_amount')::numeric else bi.gst_amount end,
    total = case when i ? 'total' then (i ->> 'total')::numeric else bi.total end,
    stitch_type = case when i ? 'stitch_type' then i ->> 'stitch_type' else bi.stitch_type end,
    unit_type = case when i ? 'unit_type' then i ->> 'unit_type' else bi.unit_type end,
    salesperson_id = case when i ? 'salesperson_id' then (i ->> 'salesperson_id')::int else bi.salesperson_id end
  from jsonb_array_elements(p_items) i
  where i ->> 'bill_item_id' is not null
    and bi.bill_item_id = (i ->> 'bill_item_id')::int
    and bi.billid = p_billid;

  -- Defaults as bill_save's insert, which match the columns'.
  insert into public.bill_items (
    billid, quantity, mrp, variantid, product_name, product_code, category, cost_price,
    alteration_charge, discount_total, subtotal, gst_rate, gst_amount, total, stitch_type,
    unit_type, salesperson_id)
  select
    p_billid,
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
  from jsonb_array_elements(p_items) with ordinality as t(i, ord)
  where i ->> 'bill_item_id' is null
  order by ord;

  for v_variant, v_delta in
    select * from unnest(v_delta_variants, v_deltas)
  loop
    if v_skip_stock then
      if v_has_moves then
        select stock into v_after from public.productsizecolors where variantid = v_variant;
        insert into public.bill_stock_moves (billid, variantid, delta, stock_after, reason, idempotency_key)
        values (p_billid, v_variant, 0, v_after, p_reason, p_key);
      end if;
    else
      v_after := public._stock_apply(v_variant, v_delta);
      if v_has_moves then
        insert into public.bill_stock_moves (billid, variantid, delta, stock_after, reason, idempotency_key)
        values (p_billid, v_variant, v_delta, v_after, p_reason, p_key);
      end if;
      if v_after < 0 then
        v_negative := v_negative || jsonb_build_object('variantid', v_variant, 'stock', v_after);
      end if;
    end if;
  end loop;

  -- Manual items (schema/migration_manual_item_stock.sql): the saved lines' quantity less the
  -- changed lines', exactly (fabric is sold by the metre), in id order. Read from the rows, so a
  -- line that left product_code out keeps its saved item. Never for "Don't reduce stock".
  if not v_skip_stock then
    for v_manual, v_delta in
      select c, sum(q) from (
          select s.key as c, s.value::numeric as q from jsonb_each_text(v_manual_before) s
          union all
          select bi.product_code, -bi.quantity
            from public.bill_items bi
           where bi.billid = p_billid and bi.variantid is null and bi.product_code is not null) moved
       group by c
      having sum(q) <> 0
       order by c
    loop
      v_after := public._manual_stock_apply(v_manual, v_delta);
      if v_after < 0 then
        v_negative := v_negative || jsonb_build_object('manual_item_id', v_manual, 'stock', v_after);
      end if;
    end loop;
  end if;
  return v_negative;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bill_cancel(p_key uuid, p_billid integer, p_mode text, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_option_keys constant text[] := array['expect', 'restore_older_stock'];
  c_expect_keys constant text[] := array['finalized', 'paymentstatus'];

  v_saved jsonb;
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_expect jsonb;
  v_restore_older boolean;
  v_bill public.bills;
  v_has_moves boolean;
  v_restock boolean;
  v_variant uuid;
  v_manual text;
  v_qty numeric;
  v_after numeric;
  v_stock jsonb := '[]'::jsonb;
  v_received numeric;
  v_exchange_out numeric;
  v_refund numeric;
  v_released numeric;
  v_paid_out numeric;
  v_from_refund numeric;
  v_from_credit numeric := 0;
  v_balance numeric;
  v_credit_refunded numeric := 0;
  v_credit_added numeric := 0;
  v_exchanges_released int;
  v_voucher_released boolean;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key is null or p_billid is null or jsonb_typeof(v_options) <> 'object' then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = 'key, billid and an options object are required';
  end if;
  if p_mode is null or p_mode not in ('draft', 'no_customer', 'return_payment', 'store_credit') then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
      detail = format('unsupported mode: %s', p_mode);
  end if;

  begin
    v_saved := public._bill_claim_key(p_key, 'cancel_' || p_mode,
      jsonb_build_object('billid', p_billid, 'options', v_options));
    if v_saved is not null then
      return v_saved;
    end if;

    v_expect := nullif(v_options -> 'expect', 'null'::jsonb);
    if exists (select 1 from jsonb_object_keys(v_options) k where k <> all (c_option_keys)) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'unknown option key';
    end if;
    if v_expect is null or jsonb_typeof(v_expect) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_expect) k where k <> all (c_expect_keys))
       or not (v_expect ? 'finalized' and v_expect ? 'paymentstatus') then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = 'expect needs exactly finalized and paymentstatus';
    end if;
    v_restore_older := coalesce((v_options ->> 'restore_older_stock')::boolean, false);

    select * into v_bill from public.bills where billid = p_billid for update;
    if not found then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('bill %s not found', p_billid);
    end if;

    if v_bill.paymentstatus = 'cancelled' then
      raise exception 'BILL_ALREADY_CANCELLED' using errcode = 'P0001', detail = p_billid::text;
    end if;

    if coalesce(v_bill.finalized, false) is distinct from (v_expect ->> 'finalized')::boolean
       or v_bill.paymentstatus is distinct from v_expect ->> 'paymentstatus' then
      raise exception 'BILL_STALE' using errcode = 'P0001',
        detail = jsonb_build_object('finalized', coalesce(v_bill.finalized, false),
                                    'paymentstatus', v_bill.paymentstatus)::text;
    end if;

    -- Website bills are cancelled from the Orders screen, which also handles the payment gateway.
    if exists (select 1 from public.orders o where o.bill_id = p_billid) then
      raise exception 'BILL_ONLINE' using errcode = 'P0001', detail = p_billid::text;
    end if;

    if (p_mode = 'draft' and coalesce(v_bill.finalized, false))
       or (p_mode <> 'draft' and not coalesce(v_bill.finalized, false))
       or (p_mode = 'no_customer' and v_bill.customerid is not null)
       or (p_mode in ('return_payment', 'store_credit') and v_bill.customerid is null) then
      raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001',
        detail = format('mode %s does not fit this bill (finalized %s, customer %s)',
                        p_mode, coalesce(v_bill.finalized, false), v_bill.customerid);
    end if;

    -- Stock. Exchanged quantities went back to stock when the exchange was made, so they are
    -- taken off what this bill returns.
    v_has_moves := exists (select 1 from public.bill_stock_moves m where m.billid = p_billid);
    v_restock := v_has_moves or coalesce(v_bill.stock_reduced, v_restore_older);

    if v_restock then
      for v_variant, v_qty in
        with taken as (
          select m.variantid, -sum(m.delta) as qty
            from public.bill_stock_moves m
           where v_has_moves and m.billid = p_billid
           group by m.variantid
          union all
          select bi.variantid, sum(bi.quantity)
            from public.bill_items bi
           where not v_has_moves and bi.billid = p_billid and bi.variantid is not null
           group by bi.variantid
        ), exchanged as (
          select bi.variantid, sum(e.quantity) as qty
            from public.exchanges e
            join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
           where bi.billid = p_billid and bi.variantid is not null
           group by bi.variantid
        )
        select t.variantid, greatest(0, t.qty - coalesce(x.qty, 0))
          from taken t left join exchanged x using (variantid)
         order by t.variantid
      loop
        continue when v_qty <= 0;
        -- Rows come in variantid order, so the row locks taken here never cross another cancel's.
        v_after := public._stock_apply(v_variant, v_qty);
        insert into public.bill_stock_moves (billid, variantid, delta, stock_after, reason, idempotency_key)
        values (p_billid, v_variant, v_qty, v_after, 'bill_cancel', p_key);
        v_stock := v_stock || jsonb_build_object('variantid', v_variant, 'qty', v_qty);
      end loop;
    end if;

    -- Manual items (schema/migration_manual_item_stock.sql): each item's line quantity less what
    -- was exchanged from those lines (exchange_record put that back), exactly, in id order. Never
    -- for a bill saved with "Don't reduce stock", which took none.
    if v_restock and v_bill.stock_reduced is distinct from false then
      for v_manual, v_qty in
        select l.code, sum(l.qty)
          from (select bi.product_code as code, bi.quantity as qty
                  from public.bill_items bi
                 where bi.billid = p_billid and bi.variantid is null and bi.product_code is not null
                union all
                select bi.product_code, -e.quantity
                  from public.exchanges e
                  join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
                 where bi.billid = p_billid and bi.variantid is null and bi.product_code is not null) l
         group by l.code
         order by l.code
      loop
        continue when v_qty <= 0;
        v_after := public._manual_stock_apply(v_manual, v_qty);
        -- Null: the line's code is not a manual item, so nothing moved.
        continue when v_after is null;
        v_stock := v_stock || jsonb_build_object('manual_item_id', v_manual, 'qty', v_qty);
      end loop;
    end if;

    if v_bill.customerid is not null and coalesce(v_bill.store_credit_used, 0) > 0 then
      v_credit_refunded := round(v_bill.store_credit_used, 2);
      perform public._store_credit_apply(v_bill.customerid, v_credit_refunded, 'bill_cancel_refund',
                                         p_billid::text, 'instore', 'bill');
    end if;

    if exists (select 1 from public.bill_payments p where p.billid = p_billid) then
      select sum(p.amount) into v_received from public.bill_payments p where p.billid = p_billid;
    else
      v_received := coalesce(v_bill.payment_amount, 0);
    end if;
    select coalesce(sum(e.credit_amount), 0) into v_exchange_out
      from public.exchanges e
      join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
     where bi.billid = p_billid;
    v_refund := round(greatest(0, v_received - v_exchange_out), 2);

    -- Exchange credit used to pay this bill goes back to pending below at its full value. Any
    -- part of it the customer already took out at this bill (cash back, or the balance put on
    -- store credit) would then be cashed twice, so it is taken back: first from this refund,
    -- then from the customer's store credit. If neither covers it, the cancel is refused.
    select coalesce(sum(e.credit_amount), 0) into v_released
      from public.exchanges e where e.new_billid = p_billid;
    v_paid_out := round(greatest(0, v_released - coalesce(v_bill.exchange_credit_used, 0)), 2);
    v_from_refund := least(v_paid_out, v_refund);
    v_refund := v_refund - v_from_refund;
    v_from_credit := v_paid_out - v_from_refund;
    if v_from_credit > 0 then
      if v_bill.customerid is not null then
        select round(coalesce(c.store_credit, 0)::numeric, 2) into v_balance
          from public.customers c where c.customerid = v_bill.customerid for update;
      end if;
      if v_bill.customerid is null or coalesce(v_balance, 0) < v_from_credit then
        raise exception 'BILL_EXCHANGE_PAID_OUT' using errcode = 'P0001',
          detail = jsonb_build_object('paid_out', v_paid_out, 'uncovered', v_from_credit)::text;
      end if;
      perform public._store_credit_apply(v_bill.customerid, -v_from_credit, 'bill_cancel_exchange_paid_out',
                                         p_billid::text, 'instore', 'bill');
    end if;

    if p_mode = 'store_credit' and v_refund > 0 then
      v_credit_added := v_refund;
      perform public._store_credit_apply(v_bill.customerid, v_credit_added, 'bill_cancel_credit',
                                         p_billid::text, 'instore', 'bill');
    end if;

    update public.exchanges set new_billid = null where new_billid = p_billid;
    get diagnostics v_exchanges_released = row_count;

    update public.vouchers
       set redeemed = false, redeemed_at = null, redeemed_billid = null
     where redeemed_billid = p_billid;
    v_voucher_released := found;

    delete from public.discount_usage where billid = p_billid;

    -- Only this function may cancel a bill: it is what undoes the stock, credit and voucher. The
    -- bills trigger refuses the change without this marker, which lasts for this update only.
    perform set_config('app.bill_cancel', 'on', true);
    update public.bills set paymentstatus = 'cancelled' where billid = p_billid;
    perform set_config('app.bill_cancel', '', true);

    v_result := jsonb_build_object(
      'billid', p_billid,
      'bill_number', v_bill.bill_number,
      'mode', p_mode,
      'received', v_received,
      'exchange_credit_given', v_exchange_out,
      'exchange_paid_out', v_paid_out,
      'store_credit_taken', v_from_credit,
      'refund', v_refund,
      'credit_added', v_credit_added,
      'store_credit_refunded', v_credit_refunded,
      'stock', v_stock,
      'exchanges_released', v_exchanges_released,
      'voucher_released', v_voucher_released,
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
$function$
;

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

-- PostgREST picks up manual_item_stock_adjust.
notify pgrst, 'reload schema';

commit;
