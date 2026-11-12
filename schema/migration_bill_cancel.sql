-- Bill cancel in one transaction.
--
-- The bills screen cancelled a bill in many separate requests: stock back per variant, store
-- credit back, voucher released, discount usage removed, then the status. A failure part way
-- left a bill half cancelled, and nothing stopped a second cancel from restocking twice.
-- bill_cancel does all of it in one transaction, refuses a bill that is already cancelled, and
-- an idempotency key makes a retry after a lost response replay the first result.
--
-- Owner decisions 2026-11-12:
--   1. A bill with exchanged items refunds what was received minus the exchange credit
--      already given for those items (never below 0).
--   2. Exchange credit used to pay this bill becomes pending again (exchanges.new_billid = null).
--   3. Cancelled bills are locked; the screens refuse to edit them.
--   4. Stock back is only what the bill took: bill_stock_moves when the bill has rows there,
--      else bills.stock_reduced, else (older bills, null) the caller's restore_older_stock.
--
-- p_mode: draft | no_customer | return_payment | store_credit
--   draft          bill not finalized
--   no_customer    finalized, no customer: refund reported for staff to hand back
--   return_payment finalized with customer: refund reported for staff to hand back
--   store_credit   finalized with customer: refund added to the customer's store credit
-- p_options: { "expect": { "finalized": bool, "paymentstatus": text }, "restore_older_stock": bool }
--   expect is what the screen showed; a bill that has changed since is refused (BILL_STALE).
--
-- Errors use SQLSTATE P0001 with the code as the message and the cause in detail:
--   BILL_ALREADY_CANCELLED, BILL_STALE, BILL_ONLINE, BILL_KEY_CONFLICT, BILL_BAD_PAYLOAD.
-- A caller without access gets 42501. Lock and timeout errors pass through unchanged.
--
-- Needs schema/migration_atomic_shared_writes.sql, schema/migration_bill_save.sql and
-- schema/migration_bill_stock_reduced.sql (all live on 2026-11-12).

set local lock_timeout = '3s';

create or replace function public.bill_cancel(p_key uuid, p_billid int, p_mode text, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_qty numeric;
  v_after numeric;
  v_stock jsonb := '[]'::jsonb;
  v_received numeric;
  v_exchange_out numeric;
  v_refund numeric;
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

    update public.bills set paymentstatus = 'cancelled' where billid = p_billid;

    v_result := jsonb_build_object(
      'billid', p_billid,
      'bill_number', v_bill.bill_number,
      'mode', p_mode,
      'received', v_received,
      'exchange_credit_given', v_exchange_out,
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
$$;

revoke all on function public.bill_cancel(uuid, int, text, jsonb) from public, anon;
grant execute on function public.bill_cancel(uuid, int, text, jsonb) to authenticated, service_role;
