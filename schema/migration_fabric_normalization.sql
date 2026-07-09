-- ============================================================================
-- migration_fabric_normalization.sql
-- Fabric normalization ONLY (colors follow later, one attribute at a time).
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until owner approves.
--
-- Fabric data is already clean (no spelling mess like colors). This is
-- GROUPING, not fixing: 95 distinct trade names -> 14 filter families.
--   code   = display value (the trade name; stays on cards / PDP)
--   family = filter vocabulary ("Group Name" the storefront filters on)
--
-- Owner decisions (2026-07-08):
--   Cotton Silk, Cotton Wool  -> Cotton family (customer-salient side)
--   Silk Cotton -> Silk family, kept as its own code (leans silk, NOT merged)
--   Imported Fabric, Japanese, Fendi, Lachka -> new "Others" family
--   Metti -> Metti Cotton; Kota + Kota Doriya -> Kota Doria (canonical spelling)
--   Sweety Crape -> Sweety Crepe (misspelling), cotton -> Cotton (case)
--   Keep 14 families (Chanderi/Satin/Denim stay separate from Silk/Cotton)
--
-- What this does:
--   1. Backs up products.fabric
--   2. Normalizes 5 stray spellings into canonical codes (9 product rows)
--   3. Creates the `fabrics` lookup (mirrors the `sizes` table shape)
--   4. Seeds 92 canonical codes with family + sort_order
--   5. Anon + authenticated SELECT RLS (feeds the public family filter)
--   6. Verifies every products.fabric maps to a seeded code; aborts on mismatch
--
-- NOT here (separate files, per entry-controls sequencing):
--   - FK products.fabric -> fabrics(code): migration_fabric_fk.sql, applied
--     only AFTER the admin combobox ships (a FK — even NOT VALID — rejects new
--     free-text writes, so it must land with the combobox or admin entry breaks)
--   - admin INSERT policy: also in migration_fabric_fk.sql (add-new flow)
--
-- Not touched: the 8 merged products keep their stored `name` (composed from
-- fabric at entry time) — cosmetic only, no filter/PDP impact; left surgical.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Backup (kept until owner confirms post-migration; then drop manually)
-- ---------------------------------------------------------------------------
create table _backup_products_fabric_20260708 as
  select productid, fabric from products;

-- ---------------------------------------------------------------------------
-- 1. Merge stray values into canonical codes (products.fabric has no unique
--    constraint, so these are plain value updates — no collision, no FK touch)
-- ---------------------------------------------------------------------------
update products set fabric = 'Cotton'       where fabric = 'cotton';
update products set fabric = 'Metti Cotton' where fabric = 'Metti';
update products set fabric = 'Kota Doria'   where fabric in ('Kota', 'Kota Doriya');
update products set fabric = 'Sweety Crepe' where fabric = 'Sweety Crape';

-- ---------------------------------------------------------------------------
-- 2. Lookup table (same shape/governance as `sizes`)
-- ---------------------------------------------------------------------------
create table fabrics (
  code       text primary key,
  family     text not null,
  sort_order int  not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ---------------------------------------------------------------------------
-- 3. Seed. sort_order = family block (x100) + rank within family (row-count
--    desc). Families ordered by total volume so the filter lists the common
--    ones first.
-- ---------------------------------------------------------------------------
insert into fabrics (code, family, sort_order) values
  -- Cotton (100)
  ('Cotton',             'Cotton',        100),
  ('Rayon Cotton',       'Cotton',        101),
  ('Metti Cotton',       'Cotton',        102),
  ('Cotton Self',        'Cotton',        103),
  ('Satin Cotton',       'Cotton',        104),
  ('Cotton Silk',        'Cotton',        105),
  ('Khadi Cotton',       'Cotton',        106),
  ('Linen Cotton',       'Cotton',        107),
  ('Fancy Cotton',       'Cotton',        108),
  ('Linen',              'Cotton',        109),
  ('Filafill Cotton',    'Cotton',        110),
  ('Cotton Blend',       'Cotton',        111),
  ('Jaam Cotton',        'Cotton',        112),
  ('Lycra Cotton',       'Cotton',        113),
  ('Kota Doria',         'Cotton',        114),
  ('Muslin',             'Cotton',        115),
  ('Sambhalpuri Cotton', 'Cotton',        116),
  ('South Cotton',       'Cotton',        117),
  ('Zaali Cotton',       'Cotton',        118),
  ('Kosha Cotton',       'Cotton',        119),
  ('Lachka Cotton',      'Cotton',        120),
  ('Jute Cotton',        'Cotton',        121),
  ('Fine Cotton',        'Cotton',        122),
  ('Cargo',              'Cotton',        123),
  ('Cotton Tuxedo',      'Cotton',        124),
  ('Cotton Wool',        'Cotton',        125),
  -- Silk (200)
  ('Silk',               'Silk',          200),
  ('Khadi Silk',         'Silk',          201),
  ('Satin Silk',         'Silk',          202),
  ('Banarasi Silk',      'Silk',          203),
  ('Jacquard',           'Silk',          204),
  ('Malai Silk',         'Silk',          205),
  ('Jacquard Silk',      'Silk',          206),
  ('Brocade',            'Silk',          207),
  ('Silk Blend',         'Silk',          208),
  ('Softy Silk',         'Silk',          209),
  ('Butter Silk',        'Silk',          210),
  ('Bangalore Silk',     'Silk',          211),
  ('Tussar Silk',        'Silk',          212),
  ('Paper Silk',         'Silk',          213),
  ('Printed Silk',       'Silk',          214),
  ('Dola Silk',          'Silk',          215),
  ('Kora',               'Silk',          216),
  ('Kora Zari',          'Silk',          217),
  ('Silk Cotton',        'Silk',          218),
  -- Georgette (300)
  ('Georgette',          'Georgette',     300),
  ('Silk Georgette',     'Georgette',     301),
  ('Rayon Georgette',    'Georgette',     302),
  -- Chiffon (400)
  ('Chiffon',            'Chiffon',       400),
  ('Sweety Chiffon',     'Chiffon',       401),
  ('Chiffon Chinon',     'Chiffon',       402),
  ('Foil Chiffon',       'Chiffon',       403),
  -- Net (500)
  ('Net',                'Net',           500),
  ('Satin Net',          'Net',           501),
  ('Silk Net',           'Net',           502),
  ('Tissue Net',         'Net',           503),
  ('Super Net',          'Net',           504),
  ('Net Cotton',         'Net',           505),
  ('Crepe Net',          'Net',           506),
  ('Chiffon Net',        'Net',           507),
  ('Georgette Net',      'Net',           508),
  -- Crepe (600)
  ('Crepe',              'Crepe',         600),
  ('Satin Crepe',        'Crepe',         601),
  ('Chinon Crepe',       'Crepe',         602),
  ('Sweety Crepe',       'Crepe',         603),
  ('Crepe Blend',        'Crepe',         604),
  -- Velvet (700)
  ('Velvet',             'Velvet',        700),
  ('Net Velvet',         'Velvet',        701),
  -- Wool/Suiting (800)
  ('Tweed',              'Wool/Suiting',  800),
  ('Woolen',             'Wool/Suiting',  801),
  ('Director',           'Wool/Suiting',  802),
  ('T.R.',               'Wool/Suiting',  803),
  -- Chanderi (900)
  ('Chanderi',           'Chanderi',      900),
  ('Chanderi Silk',      'Chanderi',      901),
  ('Chanderi Cotton',    'Chanderi',      902),
  ('Chanderi Georgette', 'Chanderi',      903),
  -- Satin (1000)
  ('Satin',              'Satin',         1000),
  -- Synthetic (1100)
  ('Lycra',              'Synthetic',     1100),
  ('Synthetic',          'Synthetic',     1101),
  ('Popcorn',            'Synthetic',     1102),
  ('Santoon',            'Synthetic',     1103),
  -- Denim (1200)
  ('Denim',              'Denim',         1200),
  ('Denim Cotton',       'Denim',         1201),
  -- Shimmer/Party (1300)
  ('Jimmy Choo',         'Shimmer/Party', 1300),
  ('Shimmer',            'Shimmer/Party', 1301),
  ('Organza',            'Shimmer/Party', 1302),
  ('Brasso',             'Shimmer/Party', 1303),
  ('Shimmer Silk',       'Shimmer/Party', 1304),
  -- Others (1400)
  ('Imported Fabric',    'Others',        1400),
  ('Japanese',           'Others',        1401),
  ('Fendi',              'Others',        1402),
  ('Lachka',             'Others',        1403);

-- ---------------------------------------------------------------------------
-- 4. RLS — public + authenticated read (feeds the storefront family filter),
--    same as other catalog lookups. INSERT policy lives with the FK migration.
-- ---------------------------------------------------------------------------
alter table fabrics enable row level security;

create policy "storefront anon read fabrics"
  on fabrics for select to anon using (true);

create policy "authenticated read fabrics"
  on fabrics for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 5. Verify: every live fabric maps to a seeded code. Abort otherwise.
-- ---------------------------------------------------------------------------
do $$
declare
  unmapped int;
  bad_val  text;
begin
  select count(*), min(p.fabric)
    into unmapped, bad_val
  from products p
  left join fabrics f on f.code = p.fabric
  where f.code is null;

  if unmapped > 0 then
    raise exception 'Fabric normalization aborted: % product(s) have a fabric not in the lookup (e.g. "%")', unmapped, bad_val;
  end if;
end $$;

commit;
