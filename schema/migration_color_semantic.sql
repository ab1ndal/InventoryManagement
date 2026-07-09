-- ============================================================================
-- migration_color_semantic.sql
-- COLOR normalization Step 1b — SEMANTIC typo merges (things Title Case can't
-- fix: real misspellings, shorthand, vague descriptors).
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until owner approves.
-- >>> REVIEW ACTION: read the merge map below. Section A = confident
--     misspellings. Section B = judgment calls — DELETE any line you disagree
--     with before this is applied. Everything left runs.
--
-- Prereq: migration_color_mechanical.sql already applied (values are trimmed /
-- Title-Cased, so the `old` strings below are the post-1a spellings).
--
-- Applies the SAME merge map to all 3 color columns so spellings stay
-- consistent everywhere before the shared `colors` reference table is built:
--   productsizecolors.color  (catalog — with collision merge: stock summed,
--                             refs repointed, loser row deleted, then rename)
--   mockup_variations.color  (image label — plain UPDATE, no unique constraint)
--   productimages.caption    (image label — plain UPDATE; renamed to
--                             `productcolor` later in the reference-table step)
-- Text-only; no FK on color yet.
--
-- NOT here: family/hex bucketing (Step 3). Family-level questions like
-- "Magenta -> Pink or Purple" are family assignment, not a rename — deferred.
-- ============================================================================

begin;

create table _backup_psc_color_sem_20260708        as select * from productsizecolors;
create table _backup_bill_items_color_sem_20260708 as select * from bill_items;
create table _backup_stocktx_color_sem_20260708    as select * from stocktransactions;
create table _backup_mockupvar_color_sem_20260708  as select * from mockup_variations;
create table _backup_productimages_sem_20260708    as select * from productimages;

create temp table _pre on commit drop as
select (select coalesce(sum(stock),0) from productsizecolors) stock_sum,
       (select count(*) from bill_items)        bill_cnt,
       (select count(*) from stocktransactions) stock_cnt;

-- ---------------------------------------------------------------------------
-- Merge map (old post-1a spelling -> canonical). Edit before applying.
-- ---------------------------------------------------------------------------
create temp table merge_input (old_color text primary key, new_color text not null) on commit drop;
insert into merge_input (old_color, new_color) values
  -- ---- Section A: clear misspellings / spelling variants (confident) ----
  ('Craem',              'Cream'),
  ('Firogi',             'Firozi'),
  ('Firoji',             'Firozi'),
  ('Levender',           'Lavender'),
  ('Gajari',             'Gazari'),
  ('Mahroon',            'Maroon'),
  ('Mehroon',            'Maroon'),
  ('Marron',             'Maroon'),
  ('Leamon',             'Lemon'),
  ('Lmeon',              'Lemon'),
  ('See Green',          'Sea Green'),
  ('Teel Grey',          'Teal Grey'),
  ('Teel Blue',          'Teal Blue'),
  ('Teel Green',         'Teal Green'),
  ('Gray',               'Grey'),
  ('Mergenta',           'Magenta'),
  ('Mehendi',            'Mehndi'),
  ('Mehnidi',            'Mehndi'),
  ('Bottle Gaurd Green', 'Bottle Green'),
  ('Bottle Guard Green', 'Bottle Green'),
  ('Llight Blue',        'Light Blue'),
  ('Moave',              'Mauve'),
  ('Tie-Die',            'Tie-Dye'),
  ('Violets',            'Violet'),
  ('Print',              'Printed'),
  -- generic "many colors" spellings -> Multi Color (specific ones like
  -- 'Multi Red' / 'Multi White' stay distinct — they name a dominant color)
  ('Multi Shade',        'Multi Color'),
  ('Multi Shades',       'Multi Color'),
  ('Multishades',        'Multi Color'),
  ('Mulitshade',         'Multi Color'),
  ('Muti Colour',        'Multi Color'),
  ('Multi-Color',        'Multi Color'),
  ('5 Colours',          'Multi Color'),
  ('Multi Color(Border)','Multi Color'),   -- loses "border" detail (owner OK'd)

  -- ---- Section B: JUDGMENT CALLS — delete any line you reject ----
  ('Blueish',        'Blue'),        -- vague descriptor
  ('Blue Shade',     'Blue'),        -- vague descriptor
  ('Brown Shade',    'Brown'),       -- vague descriptor
  ('Sky',            'Sky Blue'),    -- shorthand
  ('Rama',           'Rama Green'),  -- shorthand
  ('Mus',            'Mustard'),     -- guess: truncated
  ('Mobe',           'Mauve'),       -- guess: misspelling
  ('Mahendra',       'Mehndi'),      -- guess: misspelling
  ('Mouse Colour',   'Mouse Grey'),  -- mouse = greyish
  ('Tusser',         'Tussar'),      -- tussar-silk tone spelling
  ('Tushar',         'Tussar'),      -- tussar-silk tone spelling
  ('Skin Shade',     'Skin'),        -- drop "shade"
  ('Sky Blue Shade', 'Sky Blue');    -- drop "shade"

-- Warn (not fail) if any mapped source no longer exists — keeps the map honest.
do $$
declare missing text;
begin
  select string_agg(old_color, ', ') into missing
  from merge_input mi
  where not exists (select 1 from productsizecolors p where p.color = mi.old_color);
  if missing is not null then
    raise notice 'merge_input sources not present in data (no-op): %', missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Merge collisions then rename (same pattern as the mechanical migration)
-- ---------------------------------------------------------------------------
create temp table targets on commit drop as
select psc.variantid, psc.productid, psc.size,
       coalesce(mi.new_color, psc.color) as new_color,
       (mi.old_color is not null)        as is_renamed
from productsizecolors psc
left join merge_input mi on mi.old_color = psc.color;

create temp table survivors on commit drop as
select distinct on (productid, size, new_color)
       variantid, productid, size, new_color
from targets
order by productid, size, new_color, is_renamed, variantid;

create temp table losers on commit drop as
select t.variantid as loser, s.variantid as survivor
from targets t
join survivors s using (productid, size, new_color)
where t.variantid <> s.variantid;

update productsizecolors p
set stock = p.stock + agg.lost_stock
from (
  select l.survivor, sum(psc.stock) as lost_stock
  from losers l join productsizecolors psc on psc.variantid = l.loser
  group by l.survivor
) agg
where p.variantid = agg.survivor;

update bill_items        b  set variantid  = l.survivor from losers l where b.variantid   = l.loser;
update stocktransactions st set variantid  = l.survivor from losers l where st.variantid  = l.loser;
update cart_items        ci set variant_id = l.survivor from losers l where ci.variant_id = l.loser;

delete from productsizecolors where variantid in (select loser from losers);

update productsizecolors p
set color = mi.new_color
from merge_input mi
where p.color = mi.old_color;

-- Same merges on the image-label columns (no collision logic: no unique
-- constraint on these columns, so a plain UPDATE is safe).
update mockup_variations mv
set color = mi.new_color
from merge_input mi
where mv.color = mi.old_color;

update productimages pi
set caption = mi.new_color
from merge_input mi
where pi.caption = mi.old_color;

-- ---------------------------------------------------------------------------
-- Verify: no mapped source remains in ANY of the 3 columns; stock & billing
-- untouched. Abort on drift.
-- ---------------------------------------------------------------------------
do $$
declare leftover int; pre record;
begin
  select * into pre from _pre;

  select
    (select count(*) from productsizecolors where color   in (select old_color from merge_input))
  + (select count(*) from mockup_variations  where color   in (select old_color from merge_input))
  + (select count(*) from productimages      where caption in (select old_color from merge_input))
  into leftover;
  if leftover > 0 then
    raise exception 'Semantic cleanup aborted: % row(s) still hold a merged-away spelling', leftover;
  end if;

  if (select coalesce(sum(stock),0) from productsizecolors) <> pre.stock_sum then
    raise exception 'Semantic cleanup aborted: stock total changed';
  end if;
  if (select count(*) from bill_items) <> pre.bill_cnt then
    raise exception 'Semantic cleanup aborted: bill_items count changed';
  end if;
  if (select count(*) from stocktransactions) <> pre.stock_cnt then
    raise exception 'Semantic cleanup aborted: stocktransactions count changed';
  end if;
end $$;

commit;
