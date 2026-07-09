-- ============================================================================
-- migration_fabric_fk.sql
-- Entry controls for fabric: FK + admin add-new, mirroring the size flow
-- (docs/ATTRIBUTE-ENTRY-CONTROLS-PLAN.md). Restricts free-form fabric input.
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until the admin combobox
-- (ProductEditDialog fabric field + AddFabricDialog) is DEPLOYED.
--
-- Ordering: a FK — even NOT VALID — is enforced on new INSERT/UPDATE. Applying
-- this before the combobox ships means any free-text fabric an admin types
-- throws a FK violation. So this file lands in the SAME deploy as the combobox.
--
-- Prereq: migration_fabric_normalization.sql applied (fabrics table seeded,
-- every products.fabric already maps to a code — so VALIDATE passes cleanly).
-- ============================================================================

begin;

-- Add unenforced-on-legacy first; every existing row already maps (verified in
-- migration_fabric_normalization.sql step 5), so VALIDATE is a formality but
-- keeps the two-step shape consistent with the size FK.
alter table products
  add constraint products_fabric_fkey
  foreign key (fabric) references fabrics (code)
  not valid;

alter table products
  validate constraint products_fabric_fkey;

-- Admin add-new flow (AddFabricDialog inserts a new code + family).
create policy "authenticated insert fabrics"
  on fabrics for insert
  to authenticated
  with check (true);

commit;
