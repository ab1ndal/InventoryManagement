-- Superadmin history / audit log.
-- App-level logging: one row per meaningful action. Append-only.

create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid references public.profiles(id),
  action      text not null,        -- 'create' | 'update' | 'delete'
  entity_type text not null,        -- 'product' | 'variant' | 'stock' | 'mockup' | 'bill' | 'customer' | 'supplier' | 'supplier_bill' | 'discount' | 'category' | 'user' | 'salesperson'
  entity_id   text,                 -- PK of affected row (text: IDs are mixed types)
  summary     text not null         -- human-readable description of the exact change
);

create index if not exists activity_log_created_at_idx  on public.activity_log (created_at desc);
create index if not exists activity_log_actor_id_idx     on public.activity_log (actor_id);
create index if not exists activity_log_entity_type_idx  on public.activity_log (entity_type);
create index if not exists activity_log_action_idx       on public.activity_log (action);

alter table public.activity_log enable row level security;

-- INSERT: any active admin/superadmin, and must stamp their own actor_id.
drop policy if exists activity_log_insert_admins on public.activity_log;
create policy activity_log_insert_admins on public.activity_log
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'superadmin')
        and coalesce(p.is_active, true) = true
    )
  );

-- SELECT: superadmin only. Non-superadmins cannot read the log even via direct API.
drop policy if exists activity_log_select_superadmin on public.activity_log;
create policy activity_log_select_superadmin on public.activity_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'superadmin'
        and coalesce(p.is_active, true) = true
    )
  );

-- No UPDATE/DELETE policies → those operations are denied for everyone (append-only).
