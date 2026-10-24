-- Atomic shared writes (plan R1): stock, store credit and voucher redemption.
--
-- The in-store billing app and the online order functions both write
-- productsizecolors.stock, customers.store_credit and vouchers. In-store used
-- read-modify-write from the browser, which loses updates under concurrency.
-- These functions make each write a single atomic statement.
--
-- Contract (exact signatures; in-store BillingForm and online functions call these):
--
--   stock_adjust(p_variant uuid, p_delta numeric, p_reason text, p_ref text) returns numeric
--     stock := stock + p_delta in one UPDATE; returns the new stock. No floor
--     check (in-store keeps its current semantics). Raises 'variant % not found'.
--     p_reason / p_ref are accepted for the caller's audit trail (not stored yet).
--
--   store_credit_adjust(p_customer int, p_delta numeric, p_reason text, p_ref text,
--                       p_source text default 'instore', p_ref_type text default 'bill')
--     returns numeric
--     Rounds p_delta and the result to 2 dp, locks the customer row, raises
--     'store credit would go negative' when a negative delta would take the
--     balance below 0, writes one store_credit_ledger row, returns the new balance.
--     In-store calls the 4-argument form: store_credit_adjust(cust, delta, reason, ref).
--     Idempotency: for p_source = 'online', a repeat of the same
--     (p_ref_type, p_ref, p_reason) is a no-op that returns the current balance
--     (partial unique index). In-store rows are never deduplicated, because a
--     bill can legitimately be re-finalised several times with the same reason.
--     p_delta = 0 is a no-op (no ledger row).
--
--   voucher_redeem(p_voucher text, p_bill int) returns boolean
--     Marks the voucher redeemed for the bill only if it is unredeemed, not held
--     by an online order (held_order_id is null) and not expired. Returns found.
--
-- Callers: granted to authenticated (the in-store admin app runs as signed-in
-- staff) and service_role. Inside, the caller must be service_role, a direct
-- database session (no JWT claims: migrations, SQL editor, tests), or a user
-- whose profiles.role is 'admin' or 'superadmin'.
--
-- Live schema used (fetched 2026-10-23, schema/test_harness/bootstrap.sql):
--   productsizecolors(variantid uuid pk, stock numeric(10,3) not null)
--   customers(customerid int pk, store_credit double precision default 0, check >= 0)
--   vouchers(voucher_id text pk, customerid int, expiry_date date not null,
--            value numeric(10,2), redeemed bool, redeemed_at timestamp,
--            redeemed_billid int fk bills, source text)
--   profiles(id uuid pk, role text)
-- customers.store_credit stays double precision (no type change); all writers round.

-- Fail fast instead of queueing the live in-store app behind this migration (review S2).
set local lock_timeout = '3s';

create table if not exists public.store_credit_ledger (
  id bigint generated always as identity primary key,
  customerid integer not null references public.customers(customerid),
  delta numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  source text not null check (source in ('instore', 'online')),
  reason text not null,
  ref_type text,
  ref_id text,
  created_at timestamptz not null default now()
);
create index if not exists store_credit_ledger_customer_idx
  on public.store_credit_ledger (customerid, created_at);
create unique index if not exists store_credit_ledger_online_ref_key
  on public.store_credit_ledger (ref_type, ref_id, reason)
  where source = 'online';

alter table public.store_credit_ledger enable row level security;
revoke all on table public.store_credit_ledger from public, anon, authenticated;
grant select on table public.store_credit_ledger to authenticated;
grant all on table public.store_credit_ledger to service_role;
drop policy if exists store_credit_ledger_admin_select on public.store_credit_ledger;
create policy store_credit_ledger_admin_select on public.store_credit_ledger
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('admin', 'superadmin')));

alter table public.vouchers add column if not exists held_order_id uuid;

-- True for service_role, for direct DB sessions without JWT claims, and for
-- signed-in admins. Used by functions that authenticated users may execute.
create or replace function public._is_staff_or_service()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := nullif(auth.jwt() ->> 'role', '');
begin
  if v_role is null then
    -- direct database session (no PostgREST request); never for API sessions (review nit)
    return session_user <> 'authenticator';
  end if;
  if v_role = 'service_role' then
    return true;
  end if;
  return exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('admin', 'superadmin')
                   and coalesce(p.is_active, true));
end;
$$;
revoke all on function public._is_staff_or_service() from public, anon, authenticated;

-- Internal workers (no grants): online order functions call these directly so
-- that a shopper-facing function (e.g. anon refund choice) can move credit
-- without passing the staff check. Public wrappers below add the check.
create or replace function public._stock_apply(p_variant uuid, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock numeric;
begin
  if p_delta is null then
    raise exception 'stock_adjust: delta is required';
  end if;
  update public.productsizecolors
     set stock = stock + p_delta
   where variantid = p_variant
  returning stock into v_stock;
  if not found then
    raise exception 'stock_adjust: variant % not found', p_variant;
  end if;
  return v_stock;
end;
$$;
revoke all on function public._stock_apply(uuid, numeric) from public, anon, authenticated;

create or replace function public._store_credit_apply(
  p_customer int, p_delta numeric, p_reason text, p_ref text,
  p_source text, p_ref_type text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric(12,2) := round(coalesce(p_delta, 0), 2);
  v_old numeric(12,2);
  v_new numeric(12,2);
begin
  if p_reason is null or p_reason = '' then
    raise exception 'store_credit_adjust: reason is required';
  end if;
  if p_source is null or p_source not in ('instore', 'online') then
    raise exception 'store_credit_adjust: bad source %', p_source;
  end if;

  select round(coalesce(c.store_credit, 0)::numeric, 2) into v_old
    from public.customers c where c.customerid = p_customer for update;
  if not found then
    raise exception 'store_credit_adjust: customer % not found', p_customer;
  end if;

  if p_source = 'online' and exists (
       select 1 from public.store_credit_ledger l
        where l.source = 'online' and l.ref_type is not distinct from p_ref_type
          and l.ref_id is not distinct from p_ref and l.reason = p_reason) then
    return v_old;  -- already applied
  end if;

  if v_delta = 0 then
    return v_old;
  end if;

  v_new := v_old + v_delta;
  if v_new < 0 then
    raise exception 'store credit would go negative (customer %, balance %, delta %)',
      p_customer, v_old, v_delta using errcode = '23514';
  end if;

  update public.customers set store_credit = v_new where customerid = p_customer;
  insert into public.store_credit_ledger
    (customerid, delta, balance_after, source, reason, ref_type, ref_id)
  values (p_customer, v_delta, v_new, p_source, p_reason, p_ref_type, p_ref);
  return v_new;
end;
$$;
revoke all on function public._store_credit_apply(int, numeric, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.stock_adjust(
  p_variant uuid, p_delta numeric, p_reason text, p_ref text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public._stock_apply(p_variant, p_delta);
end;
$$;

create or replace function public.store_credit_adjust(
  p_customer int, p_delta numeric, p_reason text, p_ref text,
  p_source text default 'instore', p_ref_type text default 'bill')
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- online ledger rows are written only by the online functions (review nit)
  if p_source <> 'instore' and nullif(auth.jwt() ->> 'role', '') is not null
     and auth.jwt() ->> 'role' <> 'service_role' then
    raise exception 'store_credit_adjust: source % not allowed' , p_source using errcode = '42501';
  end if;
  return public._store_credit_apply(p_customer, p_delta, p_reason, p_ref, p_source, p_ref_type);
end;
$$;

create or replace function public.voucher_redeem(p_voucher text, p_bill int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.vouchers
     set redeemed = true, redeemed_at = now(), redeemed_billid = p_bill
   where voucher_id = p_voucher
     and coalesce(redeemed, false) = false
     and held_order_id is null
     and expiry_date >= current_date;
  return found;
end;
$$;

revoke all on function public.stock_adjust(uuid, numeric, text, text) from public, anon;
revoke all on function public.store_credit_adjust(int, numeric, text, text, text, text) from public, anon;
revoke all on function public.voucher_redeem(text, int) from public, anon;
grant execute on function public.stock_adjust(uuid, numeric, text, text) to authenticated, service_role;
grant execute on function public.store_credit_adjust(int, numeric, text, text, text, text) to authenticated, service_role;
grant execute on function public.voucher_redeem(text, int) to authenticated, service_role;
