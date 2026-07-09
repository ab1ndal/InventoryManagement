-- ============================================================================
-- migration_sizes_authenticated_read.sql
-- Admin variant editor reads the `sizes` lookup for its size combobox
-- (entry controls, docs/ATTRIBUTE-ENTRY-CONTROLS-PLAN.md §2.2). RLS on `sizes`
-- previously allowed SELECT to anon only (storefront filters) — authenticated
-- admin sessions got zero rows.
-- Applied: 2026-07-08
-- ============================================================================

create policy "authenticated read sizes"
  on sizes for select
  to authenticated
  using (true);
