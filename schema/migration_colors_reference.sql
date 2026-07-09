-- ============================================================================
-- migration_colors_reference.sql
-- COLOR Step 2 — the shared `colors` reference table (single source of truth
-- all color columns will reference), + rename productimages.caption.
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until owner approves.
--
-- Prereq: Step 1 done (migration_color_mechanical.sql, _images, _semantic all
-- applied) — the 3 color columns are canonical and the image columns are a
-- strict subset of productsizecolors.color (402 distinct, verified live).
--
-- What this does:
--   1. Creates `colors` (mirrors sizes/fabrics shape) with families[] for the
--      multi-family filter (a two-tone color maps to several families).
--   2. Seeds codes from the UNION of all 3 color columns (self-correcting =
--      402; families/hex/sort_order filled in Step 3 after owner review).
--   3. Anon + authenticated read RLS (feeds the storefront family filter).
--   4. Renames productimages.caption -> productcolor (the column holds the
--      color label, not a caption — owner decision 2026-07-08).
--
-- NOT here (Step 3, lands together so nothing breaks):
--   - FK psc.color / mockup_variations.color / productimages.productcolor ->
--     colors(code): migration_colors_fk.sql. A FK (even NOT VALID) rejects new
--     free-text writes, and the admin variant editor still enters color as free
--     text — so FKs land WITH the color combobox, exactly like fabric/size.
--   - families[]/hex population, admin combobox, storefront swatches.
--
-- Heads-up: an external pipeline populates productimages/mockup_variations. The
-- caption->productcolor rename will break any writer using the old column name;
-- update that pipeline. No code in src/ reads these tables.
-- ============================================================================

begin;

create table colors (
  code       text primary key,
  families   text[] not null default '{}',   -- filter families; Step 3 fills these
  hex        text,                            -- swatch dot; null = multi-dot render
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- Seed from the union of every color-bearing column so all three FK cleanly
-- later. Images are a subset of the catalog, so this resolves to 402 codes.
insert into colors (code)
select distinct v.c
from (
  select color   as c from productsizecolors where color   is not null and btrim(color)   <> ''
  union
  select color   as c from mockup_variations  where color   is not null and btrim(color)   <> ''
  union
  select caption as c from productimages      where caption is not null and btrim(caption) <> ''
) v;

alter table colors enable row level security;

create policy "storefront anon read colors"
  on colors for select to anon using (true);

create policy "authenticated read colors"
  on colors for select to authenticated using (true);

-- caption IS the color label -> descriptive name
alter table productimages rename column caption to productcolor;

-- ---------------------------------------------------------------------------
-- Verify: every color value across all 3 columns now exists in `colors`.
-- (Guarantees the Step 3 FKs will VALIDATE.) Abort on any gap.
-- ---------------------------------------------------------------------------
do $$
declare gap int;
begin
  select
    (select count(*) from productsizecolors p where p.color   is not null and not exists (select 1 from colors c where c.code = p.color))
  + (select count(*) from mockup_variations  m where m.color   is not null and not exists (select 1 from colors c where c.code = m.color))
  + (select count(*) from productimages      i where i.productcolor is not null and btrim(i.productcolor) <> '' and not exists (select 1 from colors c where c.code = i.productcolor))
  into gap;
  if gap > 0 then
    raise exception 'colors reference incomplete: % color value(s) not seeded', gap;
  end if;
end $$;

commit;
