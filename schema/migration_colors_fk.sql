-- ============================================================================
-- migration_colors_fk.sql
-- COLOR Step 3 (DB half) — FK all color columns to the `colors` reference +
-- admin add-new policy. Mirrors the fabric FK flow.
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until the color combobox
-- (ProductEditDialog variant editor + AddColorDialog) is DEPLOYED.
--
-- Ordering: a FK — even NOT VALID — is enforced on new INSERT/UPDATE. The admin
-- variant editor still writes color as free text until the combobox ships, so
-- applying this earlier makes every free-text color throw. Lands with the combo.
--
-- Prereq: migration_colors_reference.sql applied (colors seeded; caption already
-- renamed to productcolor; every existing value maps -> VALIDATE passes).
--
-- Heads-up: the external pipeline that writes productimages.productcolor and
-- mockup_variations.color must only use codes present in `colors` after this,
-- or its inserts will fail. Add-new goes through AddColorDialog / a colors row.
-- ============================================================================

begin;

alter table productsizecolors
  add constraint productsizecolors_color_fkey
  foreign key (color) references colors (code) not valid;
alter table productsizecolors validate constraint productsizecolors_color_fkey;

alter table mockup_variations
  add constraint mockup_variations_color_fkey
  foreign key (color) references colors (code) not valid;
alter table mockup_variations validate constraint mockup_variations_color_fkey;

alter table productimages
  add constraint productimages_productcolor_fkey
  foreign key (productcolor) references colors (code) not valid;
alter table productimages validate constraint productimages_productcolor_fkey;

-- Admin add-new flow (AddColorDialog inserts a new code + families + hex).
create policy "authenticated insert colors"
  on colors for insert
  to authenticated
  with check (true);

commit;
