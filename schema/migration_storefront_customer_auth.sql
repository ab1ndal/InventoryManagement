-- Storefront customer auth: link auth.users to the in-store customers record
-- and expose safe, verified-identity-only reconciliation RPCs. The customers
-- table RLS stays admin_only; these SECURITY DEFINER functions are the only
-- customer-facing gateway.

alter table public.customers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- Shared return projection: a customer subset plus a needs_review flag telling
-- the client an ambiguous/guarded case was routed to admin follow-up.
create or replace function public._customer_projection(c public.customers, p_needs_review boolean)
returns table (
  customerid int, customer_ulid varchar, first_name varchar, last_name varchar,
  phone varchar, email varchar, address text, gender varchar, needs_review boolean
)
language sql immutable as $$
  select c.customerid, c.customer_ulid, c.first_name, c.last_name,
         c.phone, c.email, c.address, c.gender, p_needs_review;
$$;

-- Resolve (or create) the caller's customer row using their VERIFIED email.
create or replace function public.resolve_my_customer()
returns table (
  customerid int, customer_ulid varchar, first_name varchar, last_name varchar,
  phone varchar, email varchar, address text, gender varchar, needs_review boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_row public.customers;
  v_match_count int;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 1. Already linked.
  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if found then
    return query select * from public._customer_projection(v_row, false);
    return;
  end if;

  -- 2. Exactly one row matching the verified email -> link it.
  select count(*) into v_match_count from public.customers where lower(email) = lower(v_email);
  if v_match_count = 1 then
    update public.customers set auth_user_id = v_uid
      where lower(email) = lower(v_email) returning * into v_row;
    return query select * from public._customer_projection(v_row, false);
    return;
  elsif v_match_count > 1 then
    v_needs_review := true;  -- ambiguous; fall through to create a clean row
  end if;

  -- 3/4. Create a fresh linked row (placeholder name from email local-part).
  insert into public.customers (first_name, customer_ulid, email, auth_user_id, is_guest)
  values (
    split_part(coalesce(v_email, 'customer'), '@', 1),
    replace(gen_random_uuid()::text, '-', ''),
    v_email, v_uid, false
  )
  returning * into v_row;

  if v_needs_review then
    update public.customers
      set customer_notes = concat_ws(E'\n', customer_notes,
        '[' || current_date || '] online signup: multiple in-store records share this email; needs manual merge')
      where customerid = v_row.customerid returning * into v_row;
  end if;

  return query select * from public._customer_projection(v_row, v_needs_review);
end;
$$;

-- Update the caller's own row. Guarded phone match: if the caller is on a
-- freshly created row (no in-store history: store_credit=0 and no phone yet)
-- and the typed phone matches exactly one OTHER unlinked, email-less,
-- zero-credit record, re-link the caller to that record (safe reclaim).
create or replace function public.update_my_customer(
  p_first_name text, p_last_name text, p_phone text, p_address text, p_gender text
)
returns table (
  customerid int, customer_ulid varchar, first_name varchar, last_name varchar,
  phone varchar, email varchar, address text, gender varchar, needs_review boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_row public.customers;
  v_target public.customers;
  v_reclaim_count int;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Ensure the caller has a row (reuse resolve logic).
  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if not found then
    perform public.resolve_my_customer();
    select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  end if;

  -- Guarded phone reclaim (only from a fresh row, only to a safe target).
  if p_phone is not null and p_phone <> ''
     and coalesce(v_row.store_credit, 0) = 0 and (v_row.phone is null or v_row.phone = '') then
    select count(*) into v_reclaim_count from public.customers t
      where t.phone = p_phone and t.auth_user_id is null
        and (t.email is null or t.email = '') and coalesce(t.store_credit,0) = 0
        and t.customerid <> v_row.customerid;
    if v_reclaim_count = 1 then
      select * into v_target from public.customers t
        where t.phone = p_phone and t.auth_user_id is null
          and (t.email is null or t.email = '') and coalesce(t.store_credit,0) = 0
          and t.customerid <> v_row.customerid limit 1;
      -- auth_user_id is UNIQUE, so the just-created placeholder must be removed
      -- before the in-store record can take the caller's identity. The
      -- placeholder is fresh with no dependents (cart_items FK auth.users, not
      -- customers; orders table does not exist yet), so deleting it is safe.
      delete from public.customers where customerid = v_row.customerid;
      update public.customers set auth_user_id = v_uid, email = v_email
        where customerid = v_target.customerid returning * into v_row;
    else
      -- A matching record exists but is not safe to auto-claim.
      if exists (select 1 from public.customers t where t.phone = p_phone
                 and (coalesce(t.store_credit,0) > 0 or t.email is not null)
                 and t.customerid <> v_row.customerid) then
        v_needs_review := true;
      end if;
    end if;
  end if;

  update public.customers set
    first_name = coalesce(nullif(p_first_name,''), first_name),
    last_name  = coalesce(p_last_name, last_name),
    phone      = coalesce(nullif(p_phone,''), phone),
    address    = coalesce(p_address, address),
    gender     = coalesce(p_gender, gender),
    customer_notes = case when v_needs_review then
        concat_ws(E'\n', customer_notes,
          '[' || current_date || '] online: typed phone matches a protected in-store record; needs manual merge')
      else customer_notes end
  where customerid = v_row.customerid returning * into v_row;

  return query select * from public._customer_projection(v_row, v_needs_review);
end;
$$;

revoke all on function public.resolve_my_customer() from public, anon;
revoke all on function public.update_my_customer(text,text,text,text,text) from public, anon;
grant execute on function public.resolve_my_customer() to authenticated;
grant execute on function public.update_my_customer(text,text,text,text,text) to authenticated;
