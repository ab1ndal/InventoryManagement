-- ============================================================================
-- migration_color_families_table.sql
-- COLOR Step 3 (app-layer, DB half) — the `color_families` vocabulary table:
-- the closed list of filter families + swatch hex + display order. Admin-
-- manageable (add families, edit hex) — that's why it's a table, not a frontend
-- constant.
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until owner approves.
--
-- Relationship:
--   color_families.family  = one filter family ("Group Name") + its swatch hex
--   colors.families text[]  = the families a color belongs to (values drawn
--                             from color_families.family; app-enforced, same as
--                             the fabric family vocabulary)
--
-- hex null => render a multi-dot / neutral swatch (Multi/Printed).
-- Anon + authenticated read (feeds storefront swatches); authenticated insert
-- (admin "add new family" flow).
-- ============================================================================

begin;

create table color_families (
  family     text primary key,
  hex        text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- Seed the 15 families in the reviewed colors.csv, ordered by catalog volume.
insert into color_families (family, hex, sort_order) values
  ('Blue',          '#2C5F9E', 10),
  ('Green',         '#2E7D46', 20),
  ('Pink',          '#E75480', 30),
  ('White/Cream',   '#F5F0E6', 40),
  ('Yellow',        '#E3B505', 50),
  ('Brown/Beige',   '#9C7A5B', 60),
  ('Gold/Metallic', '#C9A227', 70),
  ('Black',         '#1A1A1A', 80),
  ('Red',           '#C62828', 90),
  ('Grey',          '#8A8A8A', 100),
  ('Orange',        '#E8722C', 110),
  ('Maroon/Wine',   '#7B2233', 120),
  ('Multi/Printed', null,      130),
  ('Peach',         '#F3B49B', 140),
  ('Purple',        '#7D4CA1', 150);

alter table color_families enable row level security;

create policy "storefront anon read color_families"
  on color_families for select to anon using (true);

create policy "authenticated read color_families"
  on color_families for select to authenticated using (true);

create policy "authenticated insert color_families"
  on color_families for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- Verify: every family referenced by colors.families exists here. Abort on gap.
-- ---------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(distinct fam, ', ') into missing
  from (select unnest(families) fam from colors) u
  where not exists (select 1 from color_families cf where cf.family = u.fam);
  if missing is not null then
    raise exception 'colors.families references unknown families: %', missing;
  end if;
end $$;

commit;
