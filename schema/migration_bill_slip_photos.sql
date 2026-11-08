-- Paper bill slip photos (2026-11-08): optional photos of the handwritten slip a bill was
-- entered from, so bills entered through the admin app or the admin CLI can be audited
-- against the paper later. Never required, never blocks a bill.
--
-- bill_slip_photos: one row per photo. The storage path is generated from the row, so a
--   client cannot point a row at another bill's file. Admin only.
-- bill-slips bucket: private, JPEG only, 2 MB max. The app and the CLI shrink photos before
--   upload; the limit makes sure an unshrunk camera file is refused instead of stored.
-- Storage insert needs a matching row first, so files cannot be dropped in without a bill.

create table if not exists public.bill_slip_photos (
  id uuid primary key default gen_random_uuid(),
  billid integer not null references public.bills(billid) on delete cascade,
  path text generated always as (billid::text || '/' || id::text || '.jpg') stored,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists bill_slip_photos_billid_idx on public.bill_slip_photos (billid);

alter table public.bill_slip_photos enable row level security;
revoke all on table public.bill_slip_photos from public, anon, authenticated;
grant select, delete on table public.bill_slip_photos to authenticated;
-- Only billid is chosen by the client; id, path, uploader and time come from defaults.
grant insert (billid) on public.bill_slip_photos to authenticated;
grant all on table public.bill_slip_photos to service_role;

drop policy if exists bill_slip_photos_admin_select on public.bill_slip_photos;
create policy bill_slip_photos_admin_select on public.bill_slip_photos
  for select to authenticated using (public.is_admin());
drop policy if exists bill_slip_photos_admin_insert on public.bill_slip_photos;
create policy bill_slip_photos_admin_insert on public.bill_slip_photos
  for insert to authenticated with check (public.is_admin());
drop policy if exists bill_slip_photos_admin_delete on public.bill_slip_photos;
create policy bill_slip_photos_admin_delete on public.bill_slip_photos
  for delete to authenticated using (public.is_admin());

-- Skipped where there is no storage schema (local test harness).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bill-slips', 'bill-slips', false, 2097152, array['image/jpeg'])
    on conflict (id) do update
      set public = false,
          file_size_limit = 2097152,
          allowed_mime_types = array['image/jpeg'];

    drop policy if exists admin_insert_bill_slips on storage.objects;
    create policy admin_insert_bill_slips on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'bill-slips' and public.is_admin()
        and exists (select 1 from public.bill_slip_photos p where p.path = objects.name)
      );
    drop policy if exists admin_select_bill_slips on storage.objects;
    create policy admin_select_bill_slips on storage.objects
      for select to authenticated
      using (bucket_id = 'bill-slips' and public.is_admin());
    drop policy if exists admin_delete_bill_slips on storage.objects;
    create policy admin_delete_bill_slips on storage.objects
      for delete to authenticated
      using (bucket_id = 'bill-slips' and public.is_admin());
  end if;
end $$;
