-- Fix: resolve_my_customer() created new customers with a 32-char customer_ulid
-- (uuid without dashes), but customers.customer_ulid is varchar(26) with a
-- 26-char check, so every first-time online shopper with no matching in-store
-- record failed with "value too long for type character varying(26)"
-- (reproduced 2026-10-20 in a rolled-back transaction; 3 auth users, 0 linked
-- customers). Trim to 26 chars, as CustomerForm.js does. Only that expression
-- changes; the rest is migration_storefront_customer_auth.sql verbatim, which
-- the 2026-10-20 audit confirmed matches the live definition.
-- create or replace keeps the existing grants (authenticated only).
-- No BEGIN/COMMIT: scripts/migrate.js runs files through exec_sql.

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
    left(replace(gen_random_uuid()::text, '-', ''), 26),
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
