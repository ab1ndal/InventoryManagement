-- 15-minute cart hold (owner request 2026-10-30; tasks/fulfilment-plan.md "PR E design").
-- Adding a variant to the cart reserves it for that shopper for 15 minutes, so a second shopper
-- can no longer put the last piece in their cart and both pay for it. Checkout turns the
-- shopper's holds into order holds (45 min: Cashfree's 30-min window + the expiry sweep), and
-- payment takes only stock not held by someone else.
-- In-store POS (stock_adjust) ignores holds by design: a physical sale wins and the online
-- holder then sees "no longer available" at quote / create / confirm.
-- Run after migration_online_orders_porter.sql. Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- stock_holds(id, variant_id, holder_key, qty > 0, expires_at, order_id null, ip_hash null,
--   created_at, updated_at). Active = expires_at > now(); nothing depends on a sweeper.
--   holder_key: 'u:<auth uid>' (signed in; derived from the JWT by the edge function),
--   'g:<uuid>' (guest; random key in the browser), 'o:<order id>' (order created without a key).
--   One cart hold (order_id null) per (holder_key, variant_id); one order hold per (order, variant).
--   RLS on, no anon/authenticated access: only the functions below and the service role.
-- Others' holds for a holder = active holds (cart or order) with a different holder_key.
-- stock_hold_set(p_holder text, p_items jsonb [{variant_id, qty 0..20}], p_ip_hash text,
--   p_replace boolean) returns jsonb {rate_limited, items:[{variant_id, requested, held,
--   available, reason}], expires_at}. Sets each listed cart hold to min(qty, stock − others'
--   holds, holder cap, IP cap) and renews it to now() + 15 min; qty 0 releases. p_replace also
--   releases the holder's cart holds on variants not listed. Caps: 5 held units per holder,
--   10 active held units per IP hash (off when p_ip_hash is null), 30 calls per holder per
--   minute (code_attempts scope 'hold'; over it → rate_limited, nothing changed).
--   reason: null | 'unavailable' (available < qty) | 'holder_cap' | 'ip_cap'. service_role only.
-- stock_hold_adopt(p_from 'g:..', p_to 'u:..') returns int: on sign-in, moves the guest's holds
--   to the user key (cart holds merged by max qty, as the cart merge does). service_role only.
-- variant_availability(p_variant_ids uuid[], p_holder_key text default null) returns table
--   (variant_id, stock, held_by_others, available, my_held, others_expire_at). stock is floored
--   at 0; available = stock − others' holds (floor 0). anon + authenticated (stock is public).
-- stock_holds_purge() returns int: deletes holds expired over a day ago and 'hold' rate-limit
--   rows over a day old (tidiness only). service_role only; run by run-jobs expire.
-- online_order_create: signature unchanged; p_order.holder_key ('u:'/'g:' key, optional).
--   Per variant (locked FOR UPDATE in variantid order) raises 'out of stock' when stock −
--   others' holds < qty; otherwise replaces the holder's cart hold with an order hold for the
--   ordered qty expiring now() + 45 min.
-- online_order_confirm_payment: per item takes at most
--   greatest(stock − active holds of other orders/holders, least(this order's held units, stock))
--   — a non-holder can't pay away a held unit, and a holder keeps priority if a shop sale
--   oversold the holds. Shortfall → the existing stock_race refund. Then deletes the order's holds.
-- _online_release_holds (online_order_fail: payment_failed / expired): also deletes the order's
--   stock holds.
-- =====================================================================
set local lock_timeout = '3s';

create table if not exists public.stock_holds (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.productsizecolors(variantid) on delete cascade,
  holder_key text not null
    check (holder_key ~ '^[ugo]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  qty int not null check (qty > 0),
  expires_at timestamptz not null,
  order_id uuid references public.orders(id) on delete cascade,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists stock_holds_cart_key on public.stock_holds (holder_key, variant_id)
  where order_id is null;
create unique index if not exists stock_holds_order_key on public.stock_holds (order_id, variant_id)
  where order_id is not null;
create index if not exists stock_holds_variant_idx on public.stock_holds (variant_id, expires_at);
create index if not exists stock_holds_ip_idx on public.stock_holds (ip_hash, expires_at) where ip_hash is not null;

alter table public.stock_holds enable row level security;
revoke all on table public.stock_holds from public, anon, authenticated;
grant all on table public.stock_holds to service_role;

-- Hold calls are rate limited in the same table as code / lookup / refund attempts.
alter table public.code_attempts drop constraint if exists code_attempts_scope_check;
alter table public.code_attempts add constraint code_attempts_scope_check
  check (scope in ('code', 'lookup', 'refund', 'hold'));

-- Units of a variant held by anyone but p_holder (null p_holder: by anyone).
create or replace function public._stock_held_by_others(p_variant uuid, p_holder text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(h.qty), 0)::int from public.stock_holds h
   where h.variant_id = p_variant and h.expires_at > now() and h.holder_key is distinct from p_holder
$$;

-- ---------- cart holds (edge function cart-hold) ----------
create or replace function public.stock_hold_set(p_holder text, p_items jsonb, p_ip_hash text, p_replace boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ttl constant interval := interval '15 minutes';
  c_holder_max constant int := 5;   -- held units per holder, across variants
  c_ip_max constant int := 10;      -- active held units per IP hash
  c_calls_per_min constant int := 30;
  v_it record;
  v_stock int;
  v_avail int;
  v_mine_else int;
  v_ip_room int;
  v_held int;
  v_exp timestamptz;
  v_reason text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_holder is null or p_holder !~ '^[ug]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'stock_hold_set: bad holder key';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'stock_hold_set: items must be an array of at most 30';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
              where jsonb_typeof(e -> 'qty') <> 'number' or (e ->> 'qty')::numeric not between 0 and 20
                 or (e ->> 'qty')::numeric <> floor((e ->> 'qty')::numeric)
                 or coalesce(e ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'stock_hold_set: each item needs a variant_id and a qty 0..20';
  end if;

  -- One call per holder at a time, so the per-holder cap can't be raced past.
  perform pg_advisory_xact_lock(hashtextextended('stock_hold:' || p_holder, 0));
  if (select count(*) from public.code_attempts a
       where a.scope = 'hold' and a.key = p_holder and a.created_at > now() - interval '1 minute') >= c_calls_per_min then
    return jsonb_build_object('rate_limited', true, 'items', '[]'::jsonb,
      'expires_at', (select min(h.expires_at) from public.stock_holds h
                      where h.holder_key = p_holder and h.order_id is null and h.expires_at > now()));
  end if;
  insert into public.code_attempts (scope, key, success) values ('hold', p_holder, true);

  if p_replace then
    delete from public.stock_holds h
     where h.holder_key = p_holder and h.order_id is null
       and h.variant_id not in (select (e ->> 'variant_id')::uuid from jsonb_array_elements(p_items) e);
  end if;

  -- Variant rows locked in variantid order, like confirm_payment / online_order_create (no deadlocks).
  for v_it in
    select (e ->> 'variant_id')::uuid as variant_id, max((e ->> 'qty')::int) as qty
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    select floor(greatest(psc.stock, 0))::int into v_stock
      from public.productsizecolors psc where psc.variantid = v_it.variant_id for update;
    v_stock := coalesce(v_stock, 0);
    v_avail := greatest(v_stock - public._stock_held_by_others(v_it.variant_id, p_holder), 0);
    v_reason := null;
    if v_it.qty = 0 then
      v_held := 0;
    else
      select coalesce(sum(h.qty), 0)::int into v_mine_else from public.stock_holds h
       where h.holder_key = p_holder and h.order_id is null and h.expires_at > now() and h.variant_id <> v_it.variant_id;
      v_ip_room := v_it.qty;
      if p_ip_hash is not null then
        select greatest(c_ip_max - coalesce(sum(h.qty), 0), 0)::int into v_ip_room from public.stock_holds h
         where h.ip_hash = p_ip_hash and h.order_id is null and h.expires_at > now()
           and not (h.holder_key = p_holder and h.variant_id = v_it.variant_id);
      end if;
      v_held := least(v_it.qty, v_avail, greatest(c_holder_max - v_mine_else, 0), v_ip_room);
      if v_held < v_it.qty then
        v_reason := case when v_held = v_avail then 'unavailable'
                         when v_held = greatest(c_holder_max - v_mine_else, 0) then 'holder_cap'
                         else 'ip_cap' end;
      end if;
    end if;

    v_exp := null;
    if v_held = 0 then
      delete from public.stock_holds h
       where h.holder_key = p_holder and h.variant_id = v_it.variant_id and h.order_id is null;
    else
      insert into public.stock_holds as h (variant_id, holder_key, qty, expires_at, ip_hash)
      values (v_it.variant_id, p_holder, v_held, now() + c_ttl, p_ip_hash)
      on conflict (holder_key, variant_id) where order_id is null do update
        set qty = excluded.qty, expires_at = excluded.expires_at,
            ip_hash = coalesce(excluded.ip_hash, h.ip_hash), updated_at = now()
      returning h.expires_at into v_exp;
    end if;
    v_out := v_out || jsonb_build_object('variant_id', v_it.variant_id, 'requested', v_it.qty, 'held', v_held,
      'available', v_avail, 'reason', v_reason, 'expires_at', v_exp);
  end loop;

  return jsonb_build_object('rate_limited', false, 'items', v_out,
    'expires_at', (select min(h.expires_at) from public.stock_holds h
                    where h.holder_key = p_holder and h.order_id is null and h.expires_at > now()));
end;
$$;

-- On sign-in the guest's holds become the user's, so the shopper's own guest holds never count
-- as "someone else's" against their signed-in cart. Never adds held units (max, not sum).
create or replace function public.stock_hold_adopt(p_from text, p_to text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if p_from is null or p_from !~ '^g:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_to is null or p_to !~ '^u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'stock_hold_adopt: bad holder key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stock_hold:' || p_to, 0));
  perform pg_advisory_xact_lock(hashtextextended('stock_hold:' || p_from, 0));
  update public.stock_holds t
     set qty = greatest(t.qty, f.qty), expires_at = greatest(t.expires_at, f.expires_at), updated_at = now()
    from public.stock_holds f
   where f.holder_key = p_from and f.order_id is null and f.expires_at > now()
     and t.holder_key = p_to and t.order_id is null and t.variant_id = f.variant_id;
  delete from public.stock_holds f
   where f.holder_key = p_from and f.order_id is null
     and exists (select 1 from public.stock_holds t
                  where t.holder_key = p_to and t.order_id is null and t.variant_id = f.variant_id);
  update public.stock_holds set holder_key = p_to, updated_at = now() where holder_key = p_from;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.variant_availability(p_variant_ids uuid[], p_holder_key text default null)
returns table (variant_id uuid, stock int, held_by_others int, available int, my_held int,
               others_expire_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select psc.variantid, s.stock, o.qty, greatest(s.stock - o.qty, 0), coalesce(m.qty, 0), o.expire_at
    from public.productsizecolors psc
   cross join lateral (select floor(greatest(coalesce(psc.stock, 0), 0))::int as stock) s
   cross join lateral (select coalesce(sum(h.qty), 0)::int as qty, min(h.expires_at) as expire_at
                         from public.stock_holds h
                        where h.variant_id = psc.variantid and h.expires_at > now()
                          and h.holder_key is distinct from p_holder_key) o
    left join lateral (select sum(h.qty)::int as qty from public.stock_holds h
                        where h.variant_id = psc.variantid and h.expires_at > now()
                          and h.holder_key = p_holder_key) m on true
   where psc.variantid = any(p_variant_ids[1:200])
$$;

create or replace function public.stock_holds_purge()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_m int;
begin
  delete from public.stock_holds where expires_at < now() - interval '1 day';
  get diagnostics v_n = row_count;
  delete from public.code_attempts where scope = 'hold' and created_at < now() - interval '1 day';
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

-- ---------- order holds released with the credit / voucher / promo holds ----------
create or replace function public._online_release_holds(o public.orders)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if o.credit_applied > 0 and o.customerid is not null then
    perform public._store_credit_apply(o.customerid, o.credit_applied, 'release', o.id::text, 'online', 'order');
  end if;
  update public.vouchers set held_order_id = null
   where held_order_id = o.id and coalesce(redeemed, false) = false;
  update public.promo_reservations set status = 'released', updated_at = now()
   where order_id = o.id and status = 'held';
  delete from public.stock_holds where order_id = o.id;
end;
$$;

-- ---------- create: holds become order holds (supersedes migration_online_orders_pickup.sql) ----------
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
  v_holder text := nullif(btrim(coalesce(p_order ->> 'holder_key', '')), '');
  v_hold record;
  v_stock int;
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
  if v_holder is not null and v_holder !~ '^[ug]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'bad holder key';
  end if;
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

  -- stock holds: the shopper's cart holds become this order's holds until payment settles.
  -- Variant rows are locked in variantid order, as confirm_payment does (no deadlocks).
  v_holder := coalesce(v_holder, 'o:' || v_order.id);
  for v_hold in
    select (l ->> 'variant_id')::uuid as variant_id, sum((l ->> 'qty')::int)::int as qty
      from jsonb_array_elements(v_lines) l group by 1 order by 1
  loop
    select floor(greatest(psc.stock, 0))::int into v_stock
      from public.productsizecolors psc where psc.variantid = v_hold.variant_id for update;
    if v_stock - public._stock_held_by_others(v_hold.variant_id, v_holder) < v_hold.qty then
      raise exception 'out of stock: variant %', v_hold.variant_id;
    end if;
    delete from public.stock_holds h
     where h.holder_key = v_holder and h.variant_id = v_hold.variant_id and h.order_id is null;
    -- 45 min: Cashfree's 30-min payment window plus the 10-min expiry sweep.
    insert into public.stock_holds (variant_id, holder_key, qty, expires_at, order_id)
    values (v_hold.variant_id, v_holder, v_hold.qty, now() + interval '45 minutes', v_order.id);
  end loop;

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

-- ---------- confirm payment: held units go to their order (supersedes migration_online_orders_pickup.sql) ----------
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
  v_others int;
  v_mine int;
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

  -- stock: first paid wins, per unit; variants locked in a fixed order (no deadlocks).
  -- Units held for other shoppers / orders are not ours to take. This order's own held units
  -- are, even past their expiry, and win over other holds if a shop sale left fewer units
  -- than holds (least(v_mine, stock)). Without any holds this is the old rule.
  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    select stock into v_stock from public.productsizecolors where variantid = it.variantid for update;
    select coalesce(sum(h.qty) filter (where h.order_id is distinct from o.id and h.expires_at > now()), 0)::int,
           coalesce(sum(h.qty) filter (where h.order_id = o.id), 0)::int
      into v_others, v_mine
      from public.stock_holds h where h.variant_id = it.variantid;
    -- a variant on two lines: units taken by the earlier line used up that much of the hold
    v_mine := greatest(v_mine - coalesce((select sum(x.stock_taken) from public.order_items x
                                           where x.order_id = o.id and x.variantid = it.variantid
                                             and x.id <> it.id), 0)::int, 0);
    v_take := least(it.qty, greatest(floor(coalesce(v_stock, 0))::int - v_others,
                                     least(v_mine, floor(coalesce(v_stock, 0))::int), 0));
    if v_take > 0 then
      perform public._stock_apply(it.variantid, -v_take);
    end if;
    update public.order_items set stock_taken = v_take where id = it.id;
    v_total_taken := v_total_taken + v_take;
    if v_take < it.qty then
      v_race := v_race || jsonb_build_object('item_id', it.id, 'units', it.qty - v_take);
    end if;
  end loop;
  -- Taken (or lost to the race): either way the order no longer reserves anything.
  delete from public.stock_holds where order_id = o.id;

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

revoke all on function public._stock_held_by_others(uuid, text) from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_order_create(jsonb, jsonb, uuid)',
    'public.online_order_confirm_payment(text, text, numeric, text)',
    'public.stock_hold_set(text, jsonb, text, boolean)',
    'public.stock_hold_adopt(text, text)',
    'public.stock_holds_purge()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
revoke all on function public._online_release_holds(public.orders) from public, anon, authenticated;
revoke all on function public.variant_availability(uuid[], text) from public;
grant execute on function public.variant_availability(uuid[], text) to anon, authenticated, service_role;
