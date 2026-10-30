-- Store pickup (owner decisions 2026-10-29/30; tasks/fulfilment-plan.md §4, PR C).
-- The shopper picks "Ship to me" or "Pick up at the shop" at checkout. Pickup is prepaid
-- online like shipping, costs ₹0 shipping and needs only the contact (name + phone).
-- Admin flow: shelf check (online_order_set_availability, unchanged) → online_order_mark_ready
-- (Bill of Supply, email) → online_order_mark_collected (delivered + delivered_at, so returns
-- and in-store exchanges work as for a delivered parcel). No Shiprocket for pickup orders.
-- Run after migration_online_returns.sql (and _any_state.sql). Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- orders.fulfilment text not null default 'ship', check in ('ship', 'pickup').
-- orders.status gains 'ready_for_pickup'.
-- online_order_create(p_order jsonb, p_items jsonb, p_auth_user uuid): signature unchanged
--   (so existing grants stay); p_order.fulfilment 'ship' (default) | 'pickup'. Pickup: shipping
--   must be 0 at any amount, address may be contact-only (no pincode check). Ship: unchanged.
-- online_order_confirm_payment: unchanged except no shiprocket_create job for pickup.
-- _order_public_json: adds 'fulfilment' (online_order_lookup, my_online_orders).
-- online_order_claim: a pickup order can only be claimed for 'cancel' (process / send_back /
--   rebook → {claimed:false, reason:'status'}); cancel may also claim from 'ready_for_pickup'.
-- online_order_cancel: unchanged except the bill offset reason is 'Pickup cancelled' for a
--   pickup order that already has its bill (cancelled from ready_for_pickup).
-- online_order_mark_ready(p_order_id uuid, p_actor uuid) returns jsonb
--   {status, bill_id, refund_id, all_unavailable}. Pickup order in 'paid' with no op and
--   availability set for every item that took stock. Like prepare_process: units not available
--   are refunded ('unavailable'); none available → 'cancelled'. Otherwise shipped_qty :=
--   available_qty, Bill of Supply (online_order_create_bos), status 'ready_for_pickup', job
--   email_ready_for_pickup. Plan stored in process_plan; a repeat after success returns the
--   same result.
-- online_order_mark_collected(p_order_id uuid, p_actor uuid) returns jsonb {status, delivered_at}.
--   'ready_for_pickup' → 'delivered', delivered_at = now(), event delivered {collected:true},
--   job email_delivered. A repeat on a delivered pickup order returns the stored result.
-- Admin-only is enforced in admin-order-action; execute granted to service_role only.
-- =====================================================================
set local lock_timeout = '3s';

alter table public.orders add column if not exists fulfilment text not null default 'ship';
alter table public.orders drop constraint if exists online_orders_fulfilment_check;
alter table public.orders add constraint online_orders_fulfilment_check check (fulfilment in ('ship', 'pickup'));

alter table public.orders drop constraint if exists online_orders_status_check;
alter table public.orders add constraint online_orders_status_check check (status in (
  'pending_payment', 'paid', 'processing', 'cancelling', 'packed', 'shipped',
  'out_for_delivery', 'delivered', 'payment_failed', 'expired', 'cancelled',
  'rto', 'rto_received', 'ready_for_pickup'));

-- ---------- create (supersedes migration_online_orders_any_state.sql) ----------
create or replace function public.online_order_create(p_order jsonb, p_items jsonb, p_auth_user uuid)
returns table (order_id uuid, order_ref text, created boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_existing public.orders;
  v_order public.orders;
  v_attempt uuid := nullif(p_order ->> 'attempt_key', '')::uuid;
  v_phone text := public._normalize_phone(p_order #>> '{contact,phone}');
  v_name text := btrim(coalesce(p_order #>> '{contact,name}', ''));
  v_email text := nullif(btrim(coalesce(p_order #>> '{contact,email}', '')), '');
  v_address jsonb := p_order -> 'address';
  v_promo_code text := nullif(btrim(coalesce(p_order ->> 'promo_code', '')), '');
  v_voucher_code text := nullif(btrim(coalesce(p_order ->> 'voucher_code', '')), '');
  v_subtotal numeric(12,2) := (p_order ->> 'subtotal')::numeric;
  v_promo numeric(12,2) := coalesce((p_order ->> 'promo_discount')::numeric, 0);
  v_shipping numeric(12,2) := coalesce((p_order ->> 'shipping')::numeric, 0);
  v_voucher_applied numeric(12,2) := coalesce((p_order ->> 'voucher_applied')::numeric, 0);
  v_credit numeric(12,2) := coalesce((p_order ->> 'credit_applied')::numeric, 0);
  v_gateway numeric(12,2) := (p_order ->> 'gateway_amount')::numeric;
  v_cust int;
  v_verified boolean := false;
  v_balance numeric;
  v_disc public.discounts;
  v_voucher public.vouchers;
  v_due numeric(12,2);
  v_goods numeric(12,2);
  v_nongw numeric(12,2);
  v_sum_sub numeric(12,2) := 0;
  v_sum_promo numeric(12,2) := 0;
  v_sum_credit numeric(12,2) := 0;
  v_line record;
  v_var record;
  v_lines jsonb := '[]'::jsonb;
  v_pin text := regexp_replace(coalesce(v_address ->> 'pincode', ''), '\D', '', 'g');
  v_fulfilment text := coalesce(nullif(btrim(coalesce(p_order ->> 'fulfilment', '')), ''), 'ship');
begin
  if not coalesce((select s.checkout_live from public.storefront_settings s where s.id = 1), false) then
    raise exception 'checkout is not live' using errcode = '42501';
  end if;

  if v_attempt is not null then
    -- serialise concurrent retries of the same checkout attempt
    perform pg_advisory_xact_lock(hashtextextended('online_order_create:' || v_attempt::text, 0));
    select * into v_existing from public.orders o where o.attempt_key = v_attempt;
    if found then
      return query select v_existing.id, v_existing.order_ref, false;
      return;
    end if;
  end if;

  -- contact / address
  if v_phone is null then raise exception 'invalid phone'; end if;
  if v_name = '' then raise exception 'name is required'; end if;
  if v_fulfilment not in ('ship', 'pickup') then raise exception 'bad fulfilment %', v_fulfilment; end if;
  if v_address is null or jsonb_typeof(v_address) <> 'object' then raise exception 'address is required'; end if;
  -- Pickup orders carry only the contact; nothing is delivered to an address.
  if v_fulfilment = 'ship' and v_pin !~ '^[1-9][0-9]{5}$' then raise exception 'invalid pincode %', v_pin; end if;
  if v_promo_code is not null and v_voucher_code is not null then raise exception 'only one code per order'; end if;
  if v_subtotal is null or v_gateway is null then raise exception 'subtotal and gateway_amount are required'; end if;

  -- identity (R8): only a verified auth user unlocks credit / owned vouchers
  if p_auth_user is not null then
    select c.customerid into v_cust from public.customers c where c.auth_user_id = p_auth_user;
    v_verified := found;
  end if;
  if not v_verified then
    select c.customerid into v_cust from public.customers c where c.phone = v_phone order by c.customerid limit 1;
    if not found then
      insert into public.customers (first_name, last_name, phone, email, customer_ulid, is_guest)
      values (left(split_part(v_name, ' ', 1), 50),
              nullif(left(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)), 50), ''),
              v_phone, left(v_email, 100), left(replace(gen_random_uuid()::text, '-', ''), 26), true)
      returning customerid into v_cust;
    end if;
  end if;

  -- lines: price from the database, shares from the quote
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order has no items';
  end if;
  for v_line in
    select x.ord::int as line_no, (x.e ->> 'variant_id')::uuid as variant_id, (x.e ->> 'qty')::int as qty,
           (x.e ->> 'unit_price')::numeric as unit_price,
           coalesce((x.e ->> 'promo_share')::numeric, 0) as promo_share,
           coalesce((x.e ->> 'credit_part')::numeric, 0) as credit_part
      from jsonb_array_elements(p_items) with ordinality as x(e, ord)
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'line %: bad qty', v_line.line_no; end if;
    select psc.productid, psc.size, psc.color, p.name, p.retailprice, p.categoryid, c.name as category_name
      into v_var
      from public.productsizecolors psc
      join public.products p on p.productid = psc.productid
      left join public.categories c on c.categoryid = p.categoryid
     where psc.variantid = v_line.variant_id;
    if not found then raise exception 'line %: variant % not found', v_line.line_no, v_line.variant_id; end if;
    if v_line.unit_price is distinct from v_var.retailprice then
      raise exception 'line %: price changed (% vs %)', v_line.line_no, v_line.unit_price, v_var.retailprice;
    end if;
    if v_line.promo_share < 0 or v_line.promo_share > v_line.unit_price * v_line.qty then
      raise exception 'line %: bad promo share', v_line.line_no;
    end if;
    if v_line.credit_part < 0 or v_line.credit_part > v_line.unit_price * v_line.qty - v_line.promo_share then
      raise exception 'line %: bad credit part', v_line.line_no;
    end if;
    v_sum_sub := v_sum_sub + v_line.unit_price * v_line.qty;
    v_sum_promo := v_sum_promo + v_line.promo_share;
    v_sum_credit := v_sum_credit + v_line.credit_part;
    v_lines := v_lines || jsonb_build_object('line_no', v_line.line_no, 'variant_id', v_line.variant_id,
      'productid', v_var.productid, 'name', v_var.name, 'size', v_var.size, 'color', v_var.color,
      'category_id', v_var.categoryid, 'category_name', v_var.category_name,
      'unit_price', v_line.unit_price, 'qty', v_line.qty, 'promo_share', v_line.promo_share,
      'credit_part', v_line.credit_part);
  end loop;

  if v_sum_sub <> v_subtotal then raise exception 'subtotal mismatch (% vs %)', v_subtotal, v_sum_sub; end if;
  if v_sum_promo <> v_promo then raise exception 'promo shares do not sum to promo_discount'; end if;

  -- promo
  if v_promo_code is not null then
    select * into v_disc from public.discounts d where d.code = v_promo_code;
    if not found or not public._promo_usable_online(v_disc) then raise exception 'code not valid'; end if;
    if public._promo_value(v_disc, v_subtotal) <> v_promo then
      raise exception 'promo discount mismatch (% vs %)', v_promo, public._promo_value(v_disc, v_subtotal);
    end if;
    if coalesce(v_disc.once_per_customer, false) and exists (
         select 1 from public.discount_usage du where du.code = v_disc.code and du.customerid = v_cust) then
      raise exception 'code not valid';
    end if;
  elsif v_promo <> 0 then
    raise exception 'promo discount without a code';
  end if;

  -- shipping rule (spec §7): free at >= 5000, else courier rate rounded to 10, or flat 99
  v_goods := v_subtotal - v_promo;
  if v_fulfilment = 'pickup' then
    if v_shipping <> 0 then raise exception 'shipping must be free for store pickup'; end if;
  elsif v_goods >= 5000 then
    if v_shipping <> 0 then raise exception 'shipping must be free at or above 5000'; end if;
  elsif v_shipping <= 0 or (v_shipping <> 99 and mod(v_shipping, 10) <> 0) then
    raise exception 'bad shipping amount %', v_shipping;
  end if;
  v_due := v_goods + v_shipping;

  -- voucher
  if v_voucher_code is not null then
    select * into v_voucher from public.vouchers vc where vc.voucher_id = v_voucher_code for update;
    if not found or coalesce(v_voucher.redeemed, false) or v_voucher.held_order_id is not null
       or v_voucher.expiry_date < current_date
       or not (v_voucher.source = 'online_refund' or (v_verified and v_voucher.customerid = v_cust)) then
      raise exception 'code not valid';
    end if;
    -- R7: the voucher may stop ₹1 short of covering everything so Cashfree's ₹1 minimum holds
    if v_voucher_applied <> least(v_voucher.value, v_due)
       and not (v_credit = 0 and v_voucher_applied = v_due - 1
                and least(v_voucher.value, v_due) > v_due - 1 and v_voucher.value < v_due) then
      raise exception 'voucher amount mismatch (% vs %)', v_voucher_applied, least(v_voucher.value, v_due);
    end if;
  elsif v_voucher_applied <> 0 then
    raise exception 'voucher amount without a code';
  end if;

  -- store credit
  if v_credit < 0 then raise exception 'bad credit amount'; end if;
  if v_credit > 0 then
    if not v_verified then raise exception 'store credit needs a signed-in customer'; end if;
    select round(coalesce(c.store_credit, 0)::numeric, 2) into v_balance from public.customers c where c.customerid = v_cust;
    if v_credit > v_balance then raise exception 'store credit balance is lower than requested'; end if;
    if v_credit > v_due - v_voucher_applied then raise exception 'credit exceeds amount due'; end if;
  end if;

  if v_gateway <> v_due - v_voucher_applied - v_credit then
    raise exception 'gateway amount mismatch (% vs %)', v_gateway, v_due - v_voucher_applied - v_credit;
  end if;
  if v_gateway > 0 and v_gateway < 1 and v_voucher_applied + v_credit > 0 then
    raise exception 'gateway amount must be 0 or at least 1.00';
  end if;
  v_nongw := v_voucher_applied + v_credit;
  if v_sum_credit <> least(v_nongw, v_goods) then
    raise exception 'credit parts must sum to % (got %)', least(v_nongw, v_goods), v_sum_credit;
  end if;

  insert into public.orders (attempt_key, customerid, auth_user_id, identity_verified, contact_name,
      contact_phone, contact_email, address, subtotal, promo_discount, shipping, shipping_credit_part,
      shipping_gateway_part, voucher_applied, credit_applied, gateway_amount, promo_code, voucher_code,
      quoted_courier_id, access_token_hash, fulfilment)
  values (v_attempt, v_cust, case when v_verified then p_auth_user end, v_verified, v_name,
      v_phone, v_email, v_address, v_subtotal, v_promo, v_shipping, v_nongw - v_sum_credit,
      v_shipping - (v_nongw - v_sum_credit), v_voucher_applied, v_credit, v_gateway, v_promo_code,
      v_voucher_code, nullif(p_order ->> 'quoted_courier_id', '')::int,
      nullif(lower(p_order ->> 'access_token_hash'), ''), v_fulfilment)
  returning * into v_order;

  insert into public.order_items (order_id, line_no, variantid, productid, product_name, size, color,
      category_id, category_name, unit_price, qty, promo_share, paid_value, credit_part, gateway_part)
  select v_order.id, (l ->> 'line_no')::int, (l ->> 'variant_id')::uuid, l ->> 'productid', l ->> 'name',
         l ->> 'size', l ->> 'color', l ->> 'category_id', l ->> 'category_name',
         (l ->> 'unit_price')::numeric, (l ->> 'qty')::int, (l ->> 'promo_share')::numeric,
         (l ->> 'unit_price')::numeric * (l ->> 'qty')::int - (l ->> 'promo_share')::numeric,
         (l ->> 'credit_part')::numeric,
         (l ->> 'unit_price')::numeric * (l ->> 'qty')::int - (l ->> 'promo_share')::numeric - (l ->> 'credit_part')::numeric
    from jsonb_array_elements(v_lines) l;

  -- holds
  if v_credit > 0 then
    perform public._store_credit_apply(v_cust, -v_credit, 'hold', v_order.id::text, 'online', 'order');
  end if;
  if v_voucher_code is not null then
    update public.vouchers set held_order_id = v_order.id where voucher_id = v_voucher_code;
  end if;
  if v_promo_code is not null and coalesce(v_disc.once_per_customer, false) then
    begin
      insert into public.promo_reservations (code, identity_key, order_id) values (v_promo_code, 'p:' || v_phone, v_order.id);
      if v_verified then
        insert into public.promo_reservations (code, identity_key, order_id) values (v_promo_code, 'c:' || v_cust, v_order.id);
      end if;
    exception when unique_violation then
      raise exception 'code not valid' using errcode = 'P0001';
    end;
  end if;

  perform public._online_event(v_order.id, 'created', null, 'pending_payment', p_auth_user,
    jsonb_build_object('gateway_amount', v_gateway, 'credit', v_credit, 'voucher', v_voucher_applied,
                       'promo_code', v_promo_code, 'verified', v_verified, 'fulfilment', v_fulfilment));
  return query select v_order.id, v_order.order_ref, true;
end;
$$;

-- ---------- confirm payment: no Shiprocket booking for pickup ----------
create or replace function public.online_order_confirm_payment(
  p_order_ref text, p_cf_payment_id text, p_amount numeric, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_no_gateway boolean := p_cf_payment_id is null or p_cf_payment_id = 'NO_GATEWAY';
  v_pay_id text := case when p_cf_payment_id is null or p_cf_payment_id = 'NO_GATEWAY' then null else p_cf_payment_id end;
  v_from text;
  v_stock numeric;
  v_take int;
  v_race jsonb := '[]'::jsonb;
  v_total_taken int := 0;
  v_refund uuid;
  v_voucher public.vouchers;
  v_left numeric(12,2);
  v_left_code text;
  v_usage bigint;
  v_cancel boolean;
begin
  select * into o from public.orders where order_ref = p_order_ref for update;
  if not found then
    raise exception 'order % not found', p_order_ref;
  end if;

  if o.status not in ('pending_payment', 'expired', 'payment_failed') then
    if (v_no_gateway and o.gateway_amount = 0) or o.cf_payment_id is not distinct from v_pay_id then
      return jsonb_build_object('result', 'already', 'order_id', o.id, 'order_ref', o.order_ref, 'status', o.status);
    end if;
    if v_no_gateway then
      raise exception 'payment mismatch: NO_GATEWAY confirm for order % that needs a gateway payment', o.order_ref;
    end if;
    perform public._online_event(o.id, 'duplicate_payment', o.status, o.status, null,
      jsonb_build_object('cf_payment_id', p_cf_payment_id, 'amount', p_amount));
    return jsonb_build_object('result', 'refund_required', 'reason', 'duplicate_payment',
      'amount', p_amount, 'order_ref', o.order_ref);
  end if;

  -- A late payment already judged unrecoverable stays refunded: a retried webhook
  -- must not confirm it later (the edge function has refunded it by then).
  if o.status in ('expired', 'payment_failed') and o.cf_payment_id is not null then
    return jsonb_build_object('result', 'refund_required',
      'reason', case when o.cf_payment_id = v_pay_id then 'holds_unavailable' else 'duplicate_payment' end,
      'amount', coalesce(p_amount, 0), 'order_ref', o.order_ref);
  end if;

  -- R4: the money must match exactly
  if v_no_gateway then
    if o.gateway_amount <> 0 or coalesce(p_amount, 0) <> 0 then
      raise exception 'payment mismatch: order % needs a gateway payment of %', o.order_ref, o.gateway_amount;
    end if;
  else
    if upper(coalesce(p_currency, '')) <> 'INR' then
      raise exception 'payment mismatch: currency % for order %', p_currency, o.order_ref;
    end if;
    if p_amount is null or round(p_amount, 2) <> o.gateway_amount then
      raise exception 'payment mismatch: amount % for order % (expected %)', p_amount, o.order_ref, o.gateway_amount;
    end if;
    if exists (select 1 from public.orders x where x.cf_payment_id = v_pay_id and x.id <> o.id) then
      raise exception 'payment mismatch: cf_payment_id % already used by another order', v_pay_id;
    end if;
  end if;

  -- B1 (review): the held voucher must still be ours and unredeemed. If it was spent
  -- elsewhere, fail the order (releasing its other holds) and have the caller refund.
  if o.status = 'pending_payment' and o.voucher_code is not null then
    perform 1 from public.vouchers v
     where v.voucher_id = o.voucher_code and v.held_order_id = o.id and coalesce(v.redeemed, false) = false
       for update;
    if not found then
      perform public.online_order_fail(o.order_ref, 'payment_failed', 'voucher no longer available');
      update public.orders set cf_payment_id = v_pay_id where id = o.id;
      return jsonb_build_object('result', 'refund_required', 'reason', 'holds_unavailable',
        'amount', coalesce(p_amount, 0), 'order_ref', o.order_ref);
    end if;
  end if;

  v_from := o.status;
  if o.status in ('expired', 'payment_failed') then
    -- Late payment: holds were released. Re-take them all or refund the payment.
    begin
      if o.credit_applied > 0 then
        perform public._store_credit_apply(o.customerid, -o.credit_applied, 'hold_retake', o.id::text, 'online', 'order');
      end if;
      if o.voucher_code is not null then
        update public.vouchers set held_order_id = o.id
         where voucher_id = o.voucher_code and coalesce(redeemed, false) = false
           and (held_order_id is null or held_order_id = o.id) and expiry_date >= current_date;
        if not found then raise exception 'voucher no longer available'; end if;
      end if;
      if o.promo_code is not null then
        update public.promo_reservations set status = 'held', updated_at = now()
         where order_id = o.id and status = 'released';
        if exists (select 1 from public.discounts d join public.discount_usage du on du.code = d.code
                    where d.code = o.promo_code and d.once_per_customer and du.customerid = o.customerid) then
          raise exception 'promo already used';
        end if;
      end if;
    exception when unique_violation or check_violation or raise_exception then
      update public.orders set cf_payment_id = v_pay_id,
             problem = 'Paid after expiry; credit/voucher/promo no longer available; payment refund required',
             updated_at = now() where id = o.id;
      perform public._online_event(o.id, 'refund_required', o.status, o.status, null,
        jsonb_build_object('reason', 'holds_unavailable', 'detail', sqlerrm, 'amount', p_amount,
                           'cf_payment_id', p_cf_payment_id));
      return jsonb_build_object('result', 'refund_required', 'reason', 'holds_unavailable',
        'amount', coalesce(p_amount, 0), 'order_ref', o.order_ref);
    end;
  end if;

  update public.orders set status = 'paid', paid_at = now(), cf_payment_id = v_pay_id, problem = null,
         updated_at = now()
   where id = o.id returning * into o;

  -- credit hold becomes spent (audit row; the balance was debited at the hold)
  if o.credit_applied > 0 then
    insert into public.store_credit_ledger (customerid, delta, balance_after, source, reason, ref_type, ref_id)
    select o.customerid, 0, round(coalesce(c.store_credit, 0)::numeric, 2), 'online', 'spent', 'order', o.id::text
      from public.customers c where c.customerid = o.customerid
    on conflict do nothing;
  end if;

  -- voucher consumed; unused value reissued (same expiry)
  if o.voucher_code is not null then
    update public.vouchers set redeemed = true, redeemed_at = now()
     where voucher_id = o.voucher_code and held_order_id = o.id and coalesce(redeemed, false) = false
    returning * into v_voucher;
    if not found then
      raise exception 'voucher % is no longer held by order %', o.voucher_code, o.order_ref;
    end if;
    v_left := v_voucher.value - o.voucher_applied;
    if v_left > 0 then
      v_left_code := public._issue_voucher(o.customerid, v_left, v_voucher.expiry_date,
                                           'Balance of voucher ' || o.voucher_code || ' from ' || o.order_ref);
      update public.orders set leftover_voucher_id = v_left_code where id = o.id;
    end if;
  end if;

  -- promo usage
  if o.promo_code is not null and o.customerid is not null and o.promo_usage_id is null then
    insert into public.discount_usage (customerid, code) values (o.customerid, o.promo_code)
    returning id into v_usage;
    update public.orders set promo_usage_id = v_usage where id = o.id;
    update public.promo_reservations set status = 'used', updated_at = now() where order_id = o.id and status = 'held';
  end if;

  -- stock: first paid wins, per unit; variants locked in a fixed order (no deadlocks)
  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    select stock into v_stock from public.productsizecolors where variantid = it.variantid for update;
    v_take := least(it.qty, greatest(floor(coalesce(v_stock, 0)), 0)::int);
    if v_take > 0 then
      perform public._stock_apply(it.variantid, -v_take);
    end if;
    update public.order_items set stock_taken = v_take where id = it.id;
    v_total_taken := v_total_taken + v_take;
    if v_take < it.qty then
      v_race := v_race || jsonb_build_object('item_id', it.id, 'units', it.qty - v_take);
    end if;
  end loop;

  v_cancel := v_total_taken = 0;
  if jsonb_array_length(v_race) > 0 then
    v_refund := public._online_refund_create(o.id, 'stock_race', v_race, v_cancel, null);
  end if;
  if v_cancel then
    update public.orders set status = 'cancelled', updated_at = now() where id = o.id;
  end if;

  perform public._online_event(o.id, 'paid', v_from, 'paid', null,
    jsonb_build_object('cf_payment_id', p_cf_payment_id, 'amount', p_amount, 'race_units', v_race));
  if v_cancel then
    perform public._online_event(o.id, 'cancelled', 'paid', 'cancelled', null,
      jsonb_build_object('reason', 'no stock for any item', 'refund_id', v_refund));
  elsif o.fulfilment = 'ship' then
    perform public._enqueue_job(o.id, 'shiprocket_create');
  end if;
  perform public._enqueue_job(o.id, 'email_confirmed');
  perform public._enqueue_job(o.id, 'email_shop');

  return jsonb_build_object('result', 'confirmed', 'order_id', o.id, 'order_ref', o.order_ref,
    'status', case when v_cancel then 'cancelled' else 'paid' end, 'race_units', v_race, 'refund_id', v_refund,
    'leftover_voucher', case when v_left_code is not null
      then jsonb_build_object('code', v_left_code, 'value', v_left) end);
end;
$$;

-- ---------- public order JSON (lookup, my orders) ----------
create or replace function public._order_public_json(o public.orders)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_ref', o.order_ref, 'status', o.status, 'fulfilment', o.fulfilment,
    'created_at', o.created_at, 'paid_at', o.paid_at,
    'subtotal', o.subtotal, 'promo_discount', o.promo_discount, 'shipping', o.shipping,
    'voucher_applied', o.voucher_applied, 'credit_applied', o.credit_applied,
    'gateway_amount', o.gateway_amount, 'courier_name', o.courier_name, 'awb', o.awb,
    'tracking_label', o.tracking_label,
    'tracking_url', case when o.awb is not null then 'https://shiprocket.co/tracking/' || o.awb end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.product_name, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'status', i.status, 'refunded_qty', i.refunded_qty)
        order by i.line_no) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
$$;


-- ---------- claim and cancel: pickup orders ----------
create or replace function public.online_order_claim(
  p_order_id uuid, p_action text, p_actor uuid, p_op_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_target text;
  v_from text;
begin
  if p_action is null or p_action not in ('process', 'cancel', 'send_back', 'rebook') then
    raise exception 'online_order_claim: bad action %', p_action;
  end if;
  v_target := case p_action when 'process' then 'processing' when 'cancel' then 'cancelling' end;
  if p_op_key is null or p_op_key = '' then raise exception 'online_order_claim: op key required'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  v_from := o.status;

  -- Store pickup never goes through Shiprocket: only cancel may claim a pickup order.
  if o.fulfilment = 'pickup' and p_action <> 'cancel' then
    return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  -- Admin ops on an order that already holds the same kind of op: resume / busy / take over.
  if p_action in ('send_back', 'rebook') and o.op_action = p_action then
    if o.op_key = p_op_key then
      update public.orders set op_lease_until = now() + interval '5 minutes', updated_at = now()
       where id = o.id returning * into o;
      return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if not coalesce(o.op_lease_until < now(), false) then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'busy',
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claim_takeover', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  if p_action = 'send_back' then
    if o.status <> 'processing' then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_action is distinct from 'process' or not coalesce(o.op_lease_until < now(), false) then
      return jsonb_build_object('claimed', false, 'resumed', false,
        'reason', case when o.op_action is distinct from 'process' then 'other_action' else 'busy' end,
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    -- A fresh key is what fences out the stalled Process worker.
    if o.op_key = p_op_key then raise exception 'online_order_claim: send_back needs a new op key'; end if;
    update public.orders set op_key = p_op_key, op_action = 'send_back', op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claimed', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  if p_action = 'rebook' then
    if o.status not in ('packed', 'shipped', 'out_for_delivery') then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_action is not null then
      return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'other_action',
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_action = 'rebook', op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claimed', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  -- process / cancel (unchanged except: a same-key resume must also be the same action)
  if o.status in ('processing', 'cancelling') then
    if o.op_key = p_op_key and coalesce(o.op_action, '') = p_action then
      update public.orders set op_lease_until = now() + interval '5 minutes', updated_at = now()
       where id = o.id returning * into o;
      return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_lease_until > now() or coalesce(o.op_action, '') <> p_action then
      return jsonb_build_object('claimed', false, 'resumed', false,
        'reason', case when coalesce(o.op_action, '') <> p_action then 'other_action' else 'busy' end,
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claim_takeover', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  -- A pickup order waiting at the counter can still be cancelled (restock + refund).
  if not (o.status = 'paid' or (p_action = 'cancel' and o.status = 'ready_for_pickup')) then
    return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  update public.orders set status = v_target, op_key = p_op_key, op_action = p_action, op_actor = p_actor,
         op_lease_until = now() + interval '5 minutes', process_error = null, updated_at = now()
   where id = o.id returning * into o;
  perform public._online_event(o.id, 'claimed', v_from, v_target, p_actor,
    jsonb_build_object('action', p_action, 'op_key', p_op_key));
  return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
    'status', o.status, 'order', public._order_ops_json(o));
end;
$$;

create or replace function public.online_order_cancel(p_order_id uuid, p_actor uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_back int;
  v_refund uuid;
  v_from text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status = 'cancelled' then
    return (select r.id from public.order_refunds r where r.order_id = o.id and r.reason = 'cancel');
  end if;
  if not (o.status = 'paid' or (o.status = 'cancelling' and o.op_action = 'cancel')) then
    raise exception 'cancel is only allowed for paid orders (now %)', o.status;
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'cancel reason is required'; end if;
  v_from := o.status;

  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    if it.qty - it.refunded_qty > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', it.qty - it.refunded_qty);
    end if;
    -- units marked not available were never on the shelf: no stock back for them
    v_back := coalesce(it.available_qty, it.stock_taken);
    if v_back > 0 then
      perform public._stock_apply(it.variantid, v_back);
    end if;
  end loop;

  v_refund := public._online_refund_create(o.id, 'cancel', v_units, true, p_actor);
  -- Only a rebooked order or a pickup order already marked ready is cancellable while holding a bill.
  if v_refund is not null and o.bill_id is not null then
    perform public._online_bill_offset(v_refund,
      case when o.fulfilment = 'pickup' then 'Pickup cancelled' else 'Cancel after rebook' end, true);
  end if;
  update public.orders set status = 'cancelled', op_key = null, op_action = null, op_actor = null,
         op_lease_until = null, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'cancelled', v_from, 'cancelled', p_actor,
    jsonb_build_object('reason', p_reason, 'refund_id', v_refund));
  return v_refund;
end;
$$;

-- ---------- pickup: ready, collected ----------

-- One transaction under the order row lock: no courier call to fence, so no op lease.
create or replace function public.online_order_mark_ready(p_order_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_ship jsonb := '[]'::jsonb;
  v_avail int := 0;
  v_left int;
  v_refund uuid;
  v_all boolean;
  v_plan jsonb;
  v_bill int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.fulfilment <> 'pickup' then raise exception 'mark_ready: order % is not a store pickup', o.order_ref; end if;
  -- Retry after a lost response: process_plan is only ever written here for a pickup order.
  if o.process_plan is not null and o.status in ('ready_for_pickup', 'delivered', 'cancelled') then
    return jsonb_build_object('status', o.status, 'bill_id', o.bill_id, 'refund_id', o.process_plan -> 'refund_id',
                              'all_unavailable', o.process_plan -> 'all_unavailable');
  end if;
  if o.status <> 'paid' or o.op_action is not null then
    raise exception 'mark_ready: order must be paid with no action in progress (status %, op %)', o.status, o.op_action;
  end if;
  if exists (select 1 from public.order_items i where i.order_id = o.id and i.stock_taken > 0 and i.available_qty is null) then
    raise exception 'availability not set for every item';
  end if;

  -- Same shelf-check outcome as online_order_prepare_process.
  for it in select * from public.order_items where order_id = o.id order by line_no loop
    v_left := it.stock_taken - coalesce(it.available_qty, 0);
    if v_left > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', v_left);
    end if;
    v_avail := v_avail + coalesce(it.available_qty, 0);
    if coalesce(it.available_qty, 0) > 0 then
      v_ship := v_ship || jsonb_build_object('item_id', it.id, 'units', it.available_qty);
    end if;
  end loop;
  v_all := v_avail = 0;
  v_refund := public._online_refund_create(o.id, 'unavailable', v_units, v_all, p_actor);
  v_plan := jsonb_build_object('shippable_items', v_ship, 'all_unavailable', v_all, 'refund_id', v_refund);

  if v_all then
    update public.orders set status = 'cancelled', process_plan = v_plan, updated_at = now() where id = o.id;
    perform public._online_event(o.id, 'cancelled', 'paid', 'cancelled', p_actor,
      jsonb_build_object('reason', 'no item available', 'refund_id', v_refund));
    return jsonb_build_object('status', 'cancelled', 'bill_id', null, 'refund_id', v_refund, 'all_unavailable', true);
  end if;

  -- The bill lists what the shopper takes home: shipped_qty is the "handed over" count that
  -- online_order_create_bos and returns read.
  update public.order_items set shipped_qty = coalesce(available_qty, 0) where order_id = o.id;
  update public.order_items i set status = public._item_status(i) where i.order_id = o.id;
  update public.orders set process_plan = v_plan where id = o.id;
  v_bill := public.online_order_create_bos(o.id);
  update public.orders set status = 'ready_for_pickup', updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'ready_for_pickup', 'paid', 'ready_for_pickup', p_actor,
    jsonb_build_object('bill_id', v_bill, 'refund_id', v_refund));
  perform public._enqueue_job(o.id, 'email_ready_for_pickup');
  return jsonb_build_object('status', 'ready_for_pickup', 'bill_id', v_bill, 'refund_id', v_refund, 'all_unavailable', false);
end;
$$;

create or replace function public.online_order_mark_collected(p_order_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_at timestamptz := now();
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.fulfilment <> 'pickup' then raise exception 'mark_collected: order % is not a store pickup', o.order_ref; end if;
  if o.status = 'delivered' and o.delivered_at is not null then
    return jsonb_build_object('status', o.status, 'delivered_at', o.delivered_at);
  end if;
  if o.status <> 'ready_for_pickup' or o.op_action is not null then
    raise exception 'mark_collected: order must be ready for pickup (status %, op %)', o.status, o.op_action;
  end if;
  -- delivered + delivered_at: the return window and in-store exchanges start at collection.
  update public.orders set status = 'delivered', delivered_at = v_at, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'delivered', 'ready_for_pickup', 'delivered', p_actor,
    jsonb_build_object('collected', true, 'actor', p_actor));
  perform public._enqueue_job(o.id, 'email_delivered');
  return jsonb_build_object('status', 'delivered', 'delivered_at', v_at);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_order_create(jsonb, jsonb, uuid)',
    'public.online_order_confirm_payment(text, text, numeric, text)',
    'public.online_order_claim(uuid, text, uuid, text)',
    'public.online_order_cancel(uuid, uuid, text)',
    'public.online_order_mark_ready(uuid, uuid)',
    'public.online_order_mark_collected(uuid, uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
revoke all on function public._order_public_json(public.orders) from public, anon, authenticated;
