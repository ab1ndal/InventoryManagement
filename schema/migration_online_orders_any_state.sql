-- Any-state checkout (2026-10-30): the owner now accepts orders to any Indian address and
-- decides fulfilment for out-of-UP orders in admin (site copy still says "we ship within UP").
-- online_order_create stops rejecting non-UP pincodes and only checks a 6-digit Indian
-- pincode. Supersedes the online_order_create in schema/migration_online_orders_r7.sql;
-- body otherwise identical to it. create or replace keeps the existing grants.
set local lock_timeout = '3s';

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
  if v_address is null or jsonb_typeof(v_address) <> 'object' then raise exception 'address is required'; end if;
  if v_pin !~ '^[1-9][0-9]{5}$' then raise exception 'invalid pincode %', v_pin; end if;
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
  if v_goods >= 5000 then
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
      quoted_courier_id, access_token_hash)
  values (v_attempt, v_cust, case when v_verified then p_auth_user end, v_verified, v_name,
      v_phone, v_email, v_address, v_subtotal, v_promo, v_shipping, v_nongw - v_sum_credit,
      v_shipping - (v_nongw - v_sum_credit), v_voucher_applied, v_credit, v_gateway, v_promo_code,
      v_voucher_code, nullif(p_order ->> 'quoted_courier_id', '')::int,
      nullif(lower(p_order ->> 'access_token_hash'), ''))
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
                       'promo_code', v_promo_code, 'verified', v_verified));
  return query select v_order.id, v_order.order_ref, true;
end;
$$;


