-- Finish a saved draft in one transaction: bill_save gains finalize_draft and partial_draft.
--
-- The bill screen finished a draft in up to nine separate requests: redeem the voucher, update
-- the bill, save the lines, salespeople, stock, exchange links, the first payment, discount use
-- and store credit. A failure part way left a finalized bill with some of those missing, and:
--   - Finalize on a draft never linked the exchange credit it spent (exchanges.new_billid stayed
--     null) nor wrote exchange_credit_used, so the same credit could pay for another bill.
--   - Part-paid finish linked exchanges with a direct update that did not check they were
--     unspent, so credit already used on another bill was taken again.
--   - The voucher was redeemed before the bill update, and given back by voucher_release when
--     that failed; the release itself could fail and leave the voucher spent on a draft.
-- The new ops do all of it under the bill's row lock, so it happens whole or not at all, and a
-- retry with the same key replays the first result.
--
-- p_payload for finalize_draft and partial_draft:
--   billid   the draft (required).
--   expect   {paymentstatus, payment_amount} as the screen loaded them. The bill must still
--            match and be a draft, or BILL_STALE (another window finished, paid or cancelled it).
--   bill     the bill columns the screen writes, as for the create ops, except document_type
--            (fixed when the draft was numbered). A key left out keeps its column as saved,
--            as the old direct update did. paymentstatus and finalized must be the op's.
--   items    every line the bill keeps. A saved line carries its bill_item_id and is updated in
--            place, so exchange credit pointing at it stays linked; a line without one is
--            inserted; a saved line left out is deleted. trg_bill_items_exchange_lock still
--            guards exchanged lines (BILL_ITEM_EXCHANGED). An id not on this bill: BILL_STALE.
--   skip_stock, voucher_id, exchange_ids, salesperson_ids, discount_codes, as for create;
--   exchange_balance_to_credit (finalize_draft only), first_payment (partial_draft only).
--
-- Stock follows the lines: for each variant, what the saved lines took less what the new lines
-- take is put back (or taken, when negative), as the screen's computeStockDelta did. None moves
-- when skip_stock is set ("Don't reduce stock") or the bill was saved with stock_reduced false.
-- bill_stock_moves rows are written only for a bill that already has some (one saved by
-- bill_save): bill_cancel gives back the moves' sum when a bill has moves, and the saved lines'
-- quantities when it has none, so a move row on a bill without them would make cancel return
-- only the change. Drafts are saved by the screen without moves, so a finished draft keeps
-- none and cancel reads its lines.
--
-- Exchange credit, checked on every op (the create ops too, which only checked new_billid):
--   - each exchange exists and is unspent (new_billid null), as before;
--   - each belongs to the bill's customer, or to no customer: BILL_EXCHANGE_CUSTOMER;
--   - exchange_credit_used + exchange_balance_to_credit + exchange_cash_refund is at most the
--     exchanges' credit (a paisa of rounding allowed): BILL_EXCHANGE_OVER. Before, a save could
--     put exchange balance on store credit with no exchange behind it.
-- The voucher must be available, or already redeemed on this same draft (a finish of the old
-- screen that redeemed and then failed): BILL_VOUCHER_REFUSED otherwise.
--
-- Store credit, on every op: the bill records exactly what the ledger takes. Before, the create
-- ops recorded the client's store_credit_used but took only what the balance held (floored at 0,
-- as the screen's storeCreditDeductionDelta), so the same credit could pay for two bills from two
-- windows or a stale draft, and bill_cancel or bill_edit then gave back credit that never left.
-- Now store_credit_used above the customer's balance, read under the customer lock, or on a bill
-- with no customer, is refused: BILL_CREDIT_SHORT, detail {balance, requested}. No tolerance: the
-- screen sends either the balance as it read it or the bill total, both in paise. A draft op with
-- store_credit_used left out takes the figure the draft row holds, which it keeps.
--
-- Lock order for the draft ops: bill, voucher, lines, variants, customer, exchanges. bill_cancel
-- and bill_edit take the bill first too; exchange_record takes the bill before its lines.
--
-- Also adds _bill_lines_save, which bill_edit uses for the same line diff
-- (schema/migration_bill_edit_atomic.sql).
--
-- Body copied from schema/migration_bill_save_app_callers.sql (the latest definition); the create
-- ops are unchanged apart from the exchange and store credit checks above. Same signature, grants
-- and error codes, plus BILL_STALE, BILL_EXCHANGE_CUSTOMER, BILL_EXCHANGE_OVER and
-- BILL_CREDIT_SHORT.
--
-- Run after schema/migration_voucher_states.sql (voucher_state) and before the app version that
-- calls these ops.

set local lock_timeout = '3s';

-- Saves an opened bill's lines as a diff and moves stock for the change. The caller holds the
-- bill's row lock and has checked the bill may be edited. Returns the variants left below zero,
-- as [{variantid, stock}]. Billing never stops on stock, so nothing here floors it.
create or replace function public._bill_lines_save(p_billid int, p_items jsonb, p_skip_stock boolean,
                                                   p_reason text, p_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_item_keys constant text[] := array[
    'bill_item_id', 'billid', 'quantity', 'mrp', 'variantid', 'product_name', 'product_code',
    'category', 'cost_price', 'alteration_charge', 'discount_total', 'subtotal', 'gst_rate',
    'gst_amount', 'total', 'stitch_type', 'unit_type', 'salesperson_id'];
  v_ids int[];
  v_found int;
  v_has_moves boolean;
  v_variants uuid[];
  v_count int;
  v_delta_variants uuid[];
  v_deltas numeric[];
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
    if p_skip_stock then
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
  return v_negative;
end;
$$;
revoke all on function public._bill_lines_save(int, jsonb, boolean, text, uuid) from public, anon, authenticated;

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
  c_expect_keys constant text[] := array['paymentstatus', 'payment_amount'];
  c_payment_keys constant text[] := array['amount', 'salesmethodid', 'recorded_at'];
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
  v_variants uuid[];
  v_count int;
  v_linked int;
  v_billid int;
  v_bill_number text;
  v_variant uuid;
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
    -- A bill saved with "Don't reduce stock" moves none on later saves either.
    v_skip_stock := coalesce((p_payload ->> 'skip_stock')::boolean, false)
                    or (v_draft and v_draft_row.stock_reduced is false);
    -- A draft op keeps a store_credit_used left out of the payload, so it takes that figure too.
    v_credit_used := round(coalesce((v_bill ->> 'store_credit_used')::numeric,
                                    case when v_draft then v_draft_row.store_credit_used end, 0), 2);
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
        net_amount = case when v_bill ? 'net_amount' then (v_bill ->> 'net_amount')::numeric else b.net_amount end,
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

      v_negative := public._bill_lines_save(v_billid, v_items, v_skip_stock, v_reason, p_key);
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
    if round(coalesce((v_bill ->> 'exchange_credit_used')::numeric,
                      case when v_draft then v_draft_row.exchange_credit_used end, 0), 2)
       + round(v_exchange_balance, 2)
       + round(coalesce((v_bill ->> 'exchange_cash_refund')::numeric,
                        case when v_draft then v_draft_row.exchange_cash_refund end, 0), 2)
       - round(v_exchange_total, 2) > c_exchange_rounding then
      raise exception 'BILL_EXCHANGE_OVER' using errcode = 'P0001',
        detail = jsonb_build_object('exchange_credit', round(v_exchange_total, 2))::text;
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
$$;

revoke all on function public.bill_save(uuid, text, jsonb) from public, anon;
grant execute on function public.bill_save(uuid, text, jsonb) to authenticated, service_role;
