-- ============================================================================
-- migration_sizes_admin_insert.sql
-- Owner decision 2026-07-08: size vocabulary opens up — admins can add new
-- size codes through a deliberate add-new flow in the variant editor
-- (docs/ATTRIBUTE-ENTRY-CONTROLS-PLAN.md §2.2.2). Governance columns support
-- the periodic junk review from §2.4:
--   select * from sizes where created_at > now() - interval '30 days';
-- Applied: 2026-07-08
-- ============================================================================

alter table sizes add column created_at timestamptz not null default now();
alter table sizes add column created_by uuid default auth.uid();

create policy "authenticated insert sizes"
  on sizes for insert
  to authenticated
  with check (true);
