-- Cart holds get a hard time limit (owner 2026-10-30: "the checkout clock restarts every time I
-- reload the page"). Before this, every cart-hold call (cart open, checkout load, reload) renewed
-- the hold to now() + 15 min with no ceiling, so one shopper could keep units away from everyone
-- else indefinitely just by reloading.
--
-- Pattern: the cart is a wish list, a hold is a short reservation with a hard limit.
--   * A hold session per (holder, variant) lasts at most 30 min from when it started.
--   * Within a session a hold is extended (to min(now + 15 min, start + 30 min)) only when its
--     quantity changes or it is being re-taken after lapsing; re-sending the same quantity
--     (reload, cart open, checkout load) keeps the current expiry, so the clock doesn't jump.
--   * After the 30 min the holder gets no hold on that variant for a 10-min cooldown
--     (reason 'cooldown'), then a fresh session may start. The cart line itself is never removed:
--     the item stays in the cart unreserved, and checkout can still buy it if nobody else holds it.
--   * Releasing (qty 0, or replace dropping a variant) ends the hold but keeps the row as the
--     session marker, so remove-and-re-add can't reset the 30 min.
-- Order holds (checkout → payment, 45 min) are unchanged.
-- Run after migration_online_orders_holds.sql. Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- stock_holds.hold_started_at timestamptz not null default now(): start of the cart-hold session.
-- stock_hold_set: signature and response unchanged; reason gains 'cooldown'. A row whose hold has
--   lapsed (expires_at <= now()) is inactive exactly as before; it no longer counts for anything
--   but the session clock.
-- stock_hold_adopt: merged rows keep the earlier session start.
-- =====================================================================
set local lock_timeout = '3s';

alter table public.stock_holds add column if not exists hold_started_at timestamptz not null default now();

create or replace function public.stock_hold_set(p_holder text, p_items jsonb, p_ip_hash text, p_replace boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ttl constant interval := interval '15 minutes';
  c_session_max constant interval := interval '30 minutes';  -- total hold time per session
  c_cooldown constant interval := interval '10 minutes';     -- no hold after a session ends
  c_holder_max constant int := 5;   -- held units per holder, across variants
  c_ip_max constant int := 10;      -- active held units per IP hash
  c_calls_per_min constant int := 30;
  v_it record;
  v_row public.stock_holds;
  v_start timestamptz;
  v_cooldown boolean;
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

  -- Released, not deleted: the row keeps the session clock.
  if p_replace then
    update public.stock_holds h set expires_at = now(), updated_at = now()
     where h.holder_key = p_holder and h.order_id is null and h.expires_at > now()
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

    select h.* into v_row from public.stock_holds h
     where h.holder_key = p_holder and h.variant_id = v_it.variant_id and h.order_id is null;
    -- Session: carry on within 30 min of its start, cool down for the 10 min after, else start anew.
    v_start := now();
    v_cooldown := false;
    if v_row.id is not null and now() < v_row.hold_started_at + c_session_max then
      v_start := v_row.hold_started_at;
    elsif v_row.id is not null and now() < v_row.hold_started_at + c_session_max + c_cooldown then
      v_cooldown := true;
    end if;

    v_reason := null;
    if v_it.qty = 0 then
      v_held := 0;
    elsif v_cooldown then
      v_held := 0;
      v_reason := 'cooldown';
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
      if v_row.id is not null and v_row.expires_at > now() then
        update public.stock_holds h set expires_at = now(), updated_at = now() where h.id = v_row.id;
      end if;
    elsif v_row.id is not null and v_row.expires_at > now() and v_row.qty = v_held then
      -- Same quantity, still held: a reload or cart open must not move the clock.
      v_exp := v_row.expires_at;
    else
      insert into public.stock_holds as h (variant_id, holder_key, qty, expires_at, ip_hash, hold_started_at)
      values (v_it.variant_id, p_holder, v_held, least(now() + c_ttl, v_start + c_session_max), p_ip_hash, v_start)
      on conflict (holder_key, variant_id) where order_id is null do update
        set qty = excluded.qty, expires_at = excluded.expires_at, hold_started_at = excluded.hold_started_at,
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
-- as "someone else's" against their signed-in cart. Never adds held units (max, not sum), and a
-- merged row keeps the earlier session start so signing in can't reset the 30 min.
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
     set qty = greatest(t.qty, f.qty), expires_at = greatest(t.expires_at, f.expires_at),
         hold_started_at = least(t.hold_started_at, f.hold_started_at), updated_at = now()
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.stock_hold_set(text, jsonb, text, boolean)',
    'public.stock_hold_adopt(text, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
