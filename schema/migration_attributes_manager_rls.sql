-- ============================================================================
-- migration_attributes_manager_rls.sql
-- Attributes manager (app-layer). Adds authenticated UPDATE policies so the
-- superadmin Attributes subtab can edit attribute metadata:
--   colors.families[]           (assign filter families to a color)
--   color_families.hex/order    (edit swatch, reorder, rename via add only)
--   fabrics.families[]          (assign filter families to a fabric)
--   sizes.label/type/inches/ord (curate the size vocabulary)
-- Additive and safe: no schema change, SELECT/INSERT policies untouched.
-- Idempotent (drop-if-exists then create) so re-apply is harmless.
-- ============================================================================

begin;

drop policy if exists "authenticated update colors" on colors;
create policy "authenticated update colors"
  on colors for update to authenticated using (true) with check (true);

drop policy if exists "authenticated update color_families" on color_families;
create policy "authenticated update color_families"
  on color_families for update to authenticated using (true) with check (true);

drop policy if exists "authenticated update fabrics" on fabrics;
create policy "authenticated update fabrics"
  on fabrics for update to authenticated using (true) with check (true);

drop policy if exists "authenticated update sizes" on sizes;
create policy "authenticated update sizes"
  on sizes for update to authenticated using (true) with check (true);

commit;
