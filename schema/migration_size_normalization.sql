-- ============================================================================
-- migration_size_normalization.sql
-- Size normalization ONLY (colors/fabrics follow later, one attribute at a time)
--
-- STATUS: REVIEW DRAFT 2026-07-08 (v2, simplified) — DO NOT APPLY until owner
-- approves. Supersedes v1 (compose-at-render design).
--
-- Owner rules (2026-07-08): the stored size code IS the display value.
--   Infant           S|0 (0-3 mo), M|0 (3-6 mo), L|0 (6-12 mo)
--   Child            1..16 plain numeric (Coat Pant / suit / Indo-Western /
--                    Sherwani child categories)
--   Kurta-Pajama (Child)  n|n+20 for every numeric size: 1|21, 2|22 … 16|36
--   Adult            2XS|32, XS|34, S|36 … 7XL|54 (letter|chest inches)
--   Pants (Formal Pant, Jeans, Pant, Trousers)  28..44 plain numeric (waist)
--   Universal        FREE-SIZE, UNSTITCHED, SEMI-STITCHED unchanged
--
-- What this does:
--   1. Builds a variant rename map:
--      a. case/alias fixes (Free-Size -> FREE-SIZE, XXL/xxl/2xl -> 2XL|44)
--         and plain adult letters -> composite (S -> S|36 … 7XL -> 7XL|54)
--      b. numeric chest sizes OUTSIDE pants/child categories -> adult
--         composite (32 -> 2XS|32 … 46 -> 3XL|46)
--      c. Kurta-Pajama (Child) numerics -> n|n+20
--   2. Merges variants that collide after rename (stock summed, refs repointed)
--   3. Applies renames
--   4. Reseeds the `sizes` lookup with exactly the canonical set above
--   5. Adds hygiene CHECK + NOT VALID FK on productsizecolors.size
--   6. Verifies invariants, aborts the whole transaction on any mismatch
--
-- Explicitly untouched:
--   - stocktransactions.size/.color text columns: historical snapshots
--   - the single kids '14' on Suit (2 Pc): kids code 14 stays valid
--   - manual_items: ad-hoc bill snapshots, out of scope by design
--
-- App follow-ups (separate deploy, before FK VALIDATE):
--   - src/utility/sortVariants.js: add '2XS' to SIZE_ORDER
--   - src/storefront/hooks/useShopFilters.js: composite letter codes now carry
--     their number in the code itself — drop the "code / numeric" re-compose
--   - admin combobox change per docs/ATTRIBUTE-ENTRY-CONTROLS-PLAN.md §4
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Backups (kept until owner confirms post-migration; then drop manually)
-- ---------------------------------------------------------------------------
create table _backup_psc_20260708        as select * from productsizecolors;
create table _backup_bill_items_20260708 as select * from bill_items;
create table _backup_stocktx_20260708    as select * from stocktransactions;
create table _backup_sizes_20260708      as select * from sizes;

-- ---------------------------------------------------------------------------
-- 1. Variant rename map
-- ---------------------------------------------------------------------------
create temp table size_map (
  variantid uuid primary key,
  old_size  text not null,
  new_size  text not null
) on commit drop;

-- 1a. Value-only renames (category-independent): case/alias fixes and plain
--     adult letters -> composite. Existing composites (S|36 … 2XL|44, S|0 …)
--     are already canonical — no rename, plain letters merge INTO them.
insert into size_map (variantid, old_size, new_size)
select variantid, size,
  case size
    when 'Free-Size' then 'FREE-SIZE'
    when 'free size' then 'FREE-SIZE'
    when 'XXL' then '2XL|44'
    when 'xxl' then '2XL|44'
    when '2xl' then '2XL|44'
    when 'XS'  then 'XS|34'
    when 'S'   then 'S|36'
    when 'M'   then 'M|38'
    when 'L'   then 'L|40'
    when 'XL'  then 'XL|42'
    when '2XL' then '2XL|44'
    when '3XL' then '3XL|46'
    when '4XL' then '4XL|48'
    when '5XL' then '5XL|50'
    when '6XL' then '6XL|52'
    when '7XL' then '7XL|54'
  end
from productsizecolors
where size in ('Free-Size','free size','XXL','xxl','2xl',
               'XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL');

-- 1b. Numeric chest sizes outside pants/child categories -> adult composite.
--     28/30 are pants-only (verified live 2026-07-08); child numerics top out
--     at 16, so the child exclusion is insurance, not load-bearing.
insert into size_map (variantid, old_size, new_size)
select psc.variantid, psc.size,
  case psc.size
    when '32' then '2XS|32'
    when '34' then 'XS|34'
    when '36' then 'S|36'
    when '38' then 'M|38'
    when '40' then 'L|40'
    when '42' then 'XL|42'
    when '44' then '2XL|44'
    when '46' then '3XL|46'
  end
from productsizecolors psc
join products p        on p.productid  = psc.productid
left join categories c on c.categoryid = p.categoryid
where psc.size in ('32','34','36','38','40','42','44','46')
  and coalesce(c.name, '') not in ('Formal Pant','Jeans','Pant','Trousers')
  and coalesce(c.name, '') not like '%(Child)%';

-- 1c. Kurta-Pajama (Child): every numeric size n -> n|n+20 (owner rule,
--     odd sizes included — confirmed 2026-07-08). Regex skips S|0/M|0/L|0.
insert into size_map (variantid, old_size, new_size)
select psc.variantid, psc.size, psc.size || '|' || (psc.size::int + 20)
from productsizecolors psc
join products p   on p.productid  = psc.productid
join categories c on c.categoryid = p.categoryid
where c.name = 'Kurta-Pajama (Child)'
  and psc.size ~ '^[0-9]+$';

-- ---------------------------------------------------------------------------
-- 2. Merge variants that collide after rename
--    (data-driven: detects ALL collisions at run time, no hardcoded list)
-- ---------------------------------------------------------------------------
create temp table targets on commit drop as
select psc.variantid, psc.productid, psc.color,
       coalesce(m.new_size, psc.size) as new_size,
       (m.variantid is not null)      as is_renamed
from productsizecolors psc
left join size_map m using (variantid);

-- survivor per (productid, new_size, color): prefer the row already holding
-- the canonical value (is_renamed = false sorts first), tiebreak on variantid
create temp table survivors on commit drop as
select distinct on (productid, new_size, color)
       variantid, productid, new_size, color
from targets
order by productid, new_size, color, is_renamed, variantid;

create temp table losers on commit drop as
select t.variantid as loser, s.variantid as survivor
from targets t
join survivors s using (productid, new_size, color)
where t.variantid <> s.variantid;

-- consolidate stock into survivors
update productsizecolors p
set stock = p.stock + agg.lost_stock
from (
  select l.survivor, sum(psc.stock) as lost_stock
  from losers l
  join productsizecolors psc on psc.variantid = l.loser
  group by l.survivor
) agg
where p.variantid = agg.survivor;

-- repoint every FK referencing a loser variant
update bill_items        b  set variantid  = l.survivor from losers l where b.variantid  = l.loser;
update stocktransactions st set variantid  = l.survivor from losers l where st.variantid = l.loser;
update cart_items        ci set variant_id = l.survivor from losers l where ci.variant_id = l.loser;

delete from productsizecolors where variantid in (select loser from losers);

-- ---------------------------------------------------------------------------
-- 3. Apply renames (losers already gone -> no unique-constraint collisions)
-- ---------------------------------------------------------------------------
update productsizecolors p
set size = m.new_size
from size_map m
where p.variantid = m.variantid;

-- ---------------------------------------------------------------------------
-- 4. Reseed `sizes` lookup — exactly the canonical set, nothing else.
--    (No FK references sizes yet; the FK below is added after this reseed.)
--    KP-child composites use size_type 'kids' with numeric_in = chest inches;
--    plain child sizes have numeric_in NULL — that distinguishes the scales.
-- ---------------------------------------------------------------------------
delete from sizes;

insert into sizes (code, label, size_type, numeric_in, sort_order)
-- adults: letter|chest
values
  ('2XS|32', '2XS|32', 'letter', 32,  10),
  ('XS|34',  'XS|34',  'letter', 34,  20),
  ('S|36',   'S|36',   'letter', 36,  30),
  ('M|38',   'M|38',   'letter', 38,  40),
  ('L|40',   'L|40',   'letter', 40,  50),
  ('XL|42',  'XL|42',  'letter', 42,  60),
  ('2XL|44', '2XL|44', 'letter', 44,  70),
  ('3XL|46', '3XL|46', 'letter', 46,  80),
  ('4XL|48', '4XL|48', 'letter', 48,  90),
  ('5XL|50', '5XL|50', 'letter', 50, 100),
  ('6XL|52', '6XL|52', 'letter', 52, 110),
  ('7XL|54', '7XL|54', 'letter', 54, 120);

-- pants: waist 28..44
insert into sizes (code, label, size_type, numeric_in, sort_order)
select n::text, n || ' (Waist)', 'waist', n, 170 + (n - 28)
from generate_series(28, 44, 2) n;

-- child: plain 1..16
insert into sizes (code, label, size_type, numeric_in, sort_order)
select n::text, n::text, 'kids', null, 200 + n * 10
from generate_series(1, 16) n;

-- Kurta-Pajama (Child): n|n+20
insert into sizes (code, label, size_type, numeric_in, sort_order)
select n || '|' || (n + 20), n || '|' || (n + 20), 'kids', n + 20, 400 + n * 10
from generate_series(1, 16) n;

-- infant + universal
insert into sizes (code, label, size_type, numeric_in, sort_order) values
  ('S|0', 'S|0 (0-3 months)',  'kids_letter', null, 610),
  ('M|0', 'M|0 (3-6 months)',  'kids_letter', null, 620),
  ('L|0', 'L|0 (6-12 months)', 'kids_letter', null, 630),
  ('FREE-SIZE',     'Free Size',     'special', null, 700),
  ('UNSTITCHED',    'Unstitched',    'special', null, 710),
  ('SEMI-STITCHED', 'Semi-stitched', 'special', null, 720);

-- ---------------------------------------------------------------------------
-- 5. Hygiene CHECK + FK (NOT VALID: existing rows unscanned, new writes checked)
-- ---------------------------------------------------------------------------
alter table sizes
  add constraint sizes_code_trimmed check (code = btrim(code) and code <> '');

alter table productsizecolors
  add constraint productsizecolors_size_fkey
  foreign key (size) references sizes (code) not valid;

-- ---------------------------------------------------------------------------
-- 6. Verification — abort the entire transaction on any mismatch
-- ---------------------------------------------------------------------------
do $$
declare
  v_stock_before numeric;  v_stock_after numeric;
  v_bi_before    bigint;   v_bi_after    bigint;
  v_stx_before   bigint;   v_stx_after   bigint;
  v_unmapped     bigint;   v_dups        bigint;
  v_renamed      bigint;   v_merged      bigint;
begin
  select sum(stock) into v_stock_before from _backup_psc_20260708;
  select sum(stock) into v_stock_after  from productsizecolors;
  if v_stock_before is distinct from v_stock_after then
    raise exception 'ABORT: total stock changed % -> %', v_stock_before, v_stock_after;
  end if;

  select count(*) into v_bi_before from _backup_bill_items_20260708;
  select count(*) into v_bi_after  from bill_items;
  if v_bi_before <> v_bi_after then
    raise exception 'ABORT: bill_items count changed % -> %', v_bi_before, v_bi_after;
  end if;

  select count(*) into v_stx_before from _backup_stocktx_20260708;
  select count(*) into v_stx_after  from stocktransactions;
  if v_stx_before <> v_stx_after then
    raise exception 'ABORT: stocktransactions count changed % -> %', v_stx_before, v_stx_after;
  end if;

  select count(*) into v_unmapped
  from productsizecolors where size not in (select code from sizes);
  if v_unmapped > 0 then
    raise exception 'ABORT: % variant rows have sizes missing from lookup (FK would never validate)', v_unmapped;
  end if;

  select count(*) into v_dups from (
    select productid, size, color from productsizecolors
    group by 1,2,3 having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception 'ABORT: % duplicate (productid,size,color) groups remain', v_dups;
  end if;

  select count(*) into v_renamed from size_map;
  select count(*) into v_merged  from losers;
  raise notice 'size normalization OK: % rows renamed, % variants merged away, stock sum % preserved',
    v_renamed, v_merged, v_stock_after;
end $$;

commit;

-- ============================================================================
-- POST-DEPLOY STEP — run ONLY after the admin combobox change is live
-- (free-text size entry removed; see docs/ATTRIBUTE-ENTRY-CONTROLS-PLAN.md §4):
--
--   alter table productsizecolors validate constraint productsizecolors_size_fkey;
--
-- Cleanup after owner sign-off (plain backup tables, nothing depends on them):
--
--   drop table _backup_psc_20260708, _backup_bill_items_20260708,
--              _backup_stocktx_20260708, _backup_sizes_20260708;
-- ============================================================================
