-- Packed item photo (2026-11-03): optional photos staff add once an order is packed; the customer
-- sees them on /track and the order page. Never required, never blocks a step.
--
-- order_packed_photos: same access as order_return_photos. Admins read id and time; the storage path
--   stays server-side. Files live in the private order-returns bucket under <order_id>/packed/.
-- online_packed_photo_path / online_packed_photo_add: server-built paths, like return photos, but
--   jpg, png and webp only because customers view these and most browsers cannot show HEIC. 4 per order.
-- online_packed_photo_remove: staff take back a wrong photo, such as one showing the address label.
-- online_order_packed_photo_paths: what a customer may see. Empty once an order has stopped
--   (cancelled, returning) or gone back to be rebooked.
-- online_order_phone_ok: the /track check for the order-packed-photos function.
-- All functions are service role only.

create table if not exists public.order_packed_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  path text not null unique,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);
create index if not exists order_packed_photos_order_idx on public.order_packed_photos (order_id);

alter table public.order_packed_photos enable row level security;
revoke all on table public.order_packed_photos from public, anon, authenticated;
grant all on table public.order_packed_photos to service_role;
drop policy if exists order_packed_photos_admin_select on public.order_packed_photos;
create policy order_packed_photos_admin_select on public.order_packed_photos for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('admin', 'superadmin')));
grant select (id, order_id, uploaded_at, uploaded_by) on public.order_packed_photos to authenticated;

create or replace function public.online_packed_photo_path(p_order_id uuid, p_ext text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_ext text := lower(btrim(coalesce(p_ext, '')));
begin
  select status into v_status from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_status not in ('packed', 'shipped', 'out_for_delivery', 'delivered') then
    raise exception 'order % is % and cannot take packed photos', p_order_id, v_status;
  end if;
  if v_ext not in ('jpg', 'png', 'webp') then
    raise exception 'unsupported photo type %, use jpg, png or webp', v_ext;
  end if;
  return p_order_id || '/packed/' || gen_random_uuid() || '.' || v_ext;
end;
$$;

create or replace function public.online_packed_photo_add(p_order_id uuid, p_path text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_id uuid;
begin
  -- The row lock makes the count below safe against two uploads at once.
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_status not in ('packed', 'shipped', 'out_for_delivery', 'delivered') then
    raise exception 'order % is % and cannot take packed photos', p_order_id, v_status;
  end if;
  -- \A..\Z: plain $ would accept a trailing newline
  if p_path is null or p_path !~ ('\A' || p_order_id || '/packed/[0-9a-f-]{36}\.(jpg|png|webp)\Z') then
    raise exception 'invalid photo path for order %', p_order_id;
  end if;
  if (select count(*) from public.order_packed_photos where order_id = p_order_id) >= 4 then
    raise exception 'an order can have at most 4 packed photos';
  end if;
  insert into public.order_packed_photos (order_id, path, uploaded_by)
  values (p_order_id, p_path, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- Returns the storage path to delete, or null if the photo is already gone.
create or replace function public.online_packed_photo_remove(p_photo_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  delete from public.order_packed_photos where id = p_photo_id returning path
$$;

create or replace function public.online_order_packed_photo_paths(p_order_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(ph.path order by ph.uploaded_at, ph.id), '{}')
    from public.order_packed_photos ph
    join public.orders o on o.id = ph.order_id
   where ph.order_id = p_order_id
     and o.status in ('packed', 'shipped', 'out_for_delivery', 'delivered')
$$;

create or replace function public.online_order_phone_ok(p_order_ref text, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.orders o
                  where o.order_ref = upper(btrim(coalesce(p_order_ref, '')))
                    and o.contact_phone = public._normalize_phone(p_phone))
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_packed_photo_path(uuid, text)',
    'public.online_packed_photo_add(uuid, text, uuid)',
    'public.online_packed_photo_remove(uuid)',
    'public.online_order_packed_photo_paths(uuid)',
    'public.online_order_phone_ok(text, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
