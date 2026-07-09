-- ============================================================================
-- migration_color_mechanical_images.sql
-- COLOR normalization Step 1a — MECHANICAL cleanup for the IMAGE tables.
-- Companion to migration_color_mechanical.sql (which did productsizecolors).
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until owner approves.
--
-- Both image tables label images with a color that duplicates the catalog
-- vocabulary but drifted with the same trim/case/underscore mess:
--   mockup_variations.color   (AI-mockup generation log)
--   productimages.caption     (image gallery; caption IS the color label)
--
-- Same canonical rule as the catalog cleanup:
--   initcap(btrim(regexp_replace(value, '[_\s]+', ' ')))
--
-- No merge/collision logic: neither table has a unique constraint on the color
-- column (PKs are variation_id / imageid), so renames can't collide. Plain
-- UPDATE. After this, every image color is a strict subset of the cleaned
-- productsizecolors.color set (verified live 2026-07-08: 0 orphans) — which is
-- what lets the later shared `colors` reference table + FKs validate.
--
-- NOT here: semantic typo merges (Step 1b, all 3 tables together), the caption
-- -> productcolor rename, the `colors` reference table, and FKs (Step 3).
-- ============================================================================

begin;

create table _backup_mockupvar_color_20260708  as select * from mockup_variations;
create table _backup_productimages_20260708     as select * from productimages;

update mockup_variations
set color = initcap(btrim(regexp_replace(color, '[_[:space:]]+', ' ', 'g')))
where color is not null
  and color <> initcap(btrim(regexp_replace(color, '[_[:space:]]+', ' ', 'g')));

update productimages
set caption = initcap(btrim(regexp_replace(caption, '[_[:space:]]+', ' ', 'g')))
where caption is not null
  and caption <> initcap(btrim(regexp_replace(caption, '[_[:space:]]+', ' ', 'g')));

-- ---------------------------------------------------------------------------
-- Verify: both columns canonical; both are subsets of catalog colors. Abort
-- on non-canonical rows. Orphans (image color absent from catalog) only warn —
-- Step 1b + the reference table reconcile any that appear.
-- ---------------------------------------------------------------------------
do $$
declare bad int; orphan_mv int; orphan_pi int;
begin
  select count(*) into bad from mockup_variations
  where color is not null
    and color <> initcap(btrim(regexp_replace(color, '[_[:space:]]+', ' ', 'g')));
  if bad > 0 then raise exception 'mockup_variations: % non-canonical color(s)', bad; end if;

  select count(*) into bad from productimages
  where caption is not null
    and caption <> initcap(btrim(regexp_replace(caption, '[_[:space:]]+', ' ', 'g')));
  if bad > 0 then raise exception 'productimages: % non-canonical caption(s)', bad; end if;

  select count(distinct color) into orphan_mv from mockup_variations
    where color is not null and color not in (select color from productsizecolors);
  select count(distinct caption) into orphan_pi from productimages
    where caption is not null and btrim(caption) <> '' and caption not in (select color from productsizecolors);
  if orphan_mv > 0 or orphan_pi > 0 then
    raise notice 'image colors not in catalog (expected 0): mockup_variations=%, productimages=%', orphan_mv, orphan_pi;
  end if;
end $$;

commit;
