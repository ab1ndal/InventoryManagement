-- ============================================================================
-- migration_color_mechanical.sql
-- COLOR normalization Step 1a — MECHANICAL cleanup only (trim / collapse
-- whitespace / underscore->space / Title Case). Deterministic, no judgment.
--
-- STATUS: REVIEW DRAFT 2026-07-08 — DO NOT APPLY until owner approves.
--
-- Scope (Step 1 of the color plan, mechanical half):
--   Fixes spelling-only duplicates: 'Sky blue'/'Sky Blue'/'Sky_blue' -> 'Sky Blue',
--   'black '/'Black' -> 'Black', 'Off_white' -> 'Off White'. Collapses 566 raw
--   values -> 442. Two-color combos ('Black Red') only get spelling fixed; they
--   stay distinct colors (multi-family bucketing is Step 3).
--
-- NOT here:
--   - Semantic typo merges ('Craem'->'Cream', 'Firogi'->'Firozi'): Step 1b,
--     needs owner sign-off (separate migration).
--   - `colors` lookup table, families[], hex, FK, admin combobox: Steps 2-4.
--
-- Canonical rule:  initcap(btrim(regexp_replace(color, '[_\s]+', ' ')))
--   trim -> collapse any run of underscores/whitespace to one space -> Title Case.
--   (Colors are all word-based, so Title Case is safe here — unlike sizes, which
--    keep uppercase codes like XL / FREE-SIZE.)
--
-- Blast radius verified live 2026-07-08:
--   1,234 variant renames; 566 -> 442 distinct; 2 collision groups / 2 loser
--   rows (BC253028 'Red '+'Red', BC25678 'Yellow '+'Yellow') — both losers have
--   0 bill_items and 0 stocktransactions refs. Stock total 12,059 preserved.
--
-- Risk: text-only. No FK references productsizecolors.color; billing/stock hang
-- on variantid (untouched by renames). Only the 2 merges repoint variantid refs
-- and delete a row — done generically so it's correct regardless.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Backups (kept until owner confirms post-migration; then drop manually)
-- ---------------------------------------------------------------------------
create table _backup_psc_color_20260708      as select * from productsizecolors;
create table _backup_bill_items_color_20260708 as select * from bill_items;
create table _backup_stocktx_color_20260708    as select * from stocktransactions;

-- Guard: capture invariants to check at the end.
create temp table _pre on commit drop as
select (select coalesce(sum(stock),0) from productsizecolors) stock_sum,
       (select count(*) from bill_items)        bill_cnt,
       (select count(*) from stocktransactions) stock_cnt;

-- ---------------------------------------------------------------------------
-- 1. Rename map: variantid -> canonical color (only where it actually changes)
-- ---------------------------------------------------------------------------
create temp table color_map on commit drop as
select variantid,
       color as old_color,
       initcap(btrim(regexp_replace(color, '[_[:space:]]+', ' ', 'g'))) as new_color
from productsizecolors
where color <> initcap(btrim(regexp_replace(color, '[_[:space:]]+', ' ', 'g')));

-- ---------------------------------------------------------------------------
-- 2. Merge variants that collide after rename
--    (data-driven: detects ALL collisions at run time, no hardcoded list)
-- ---------------------------------------------------------------------------
create temp table targets on commit drop as
select psc.variantid, psc.productid, psc.size,
       coalesce(m.new_color, psc.color) as new_color,
       (m.variantid is not null)        as is_renamed
from productsizecolors psc
left join color_map m using (variantid);

-- survivor per (productid, size, new_color): prefer the row already holding the
-- canonical value (is_renamed = false sorts first), tiebreak on variantid
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
update bill_items        b  set variantid  = l.survivor from losers l where b.variantid   = l.loser;
update stocktransactions st set variantid  = l.survivor from losers l where st.variantid  = l.loser;
update cart_items        ci set variant_id = l.survivor from losers l where ci.variant_id = l.loser;

delete from productsizecolors where variantid in (select loser from losers);

-- ---------------------------------------------------------------------------
-- 3. Apply renames (losers already gone -> no unique-constraint collisions)
-- ---------------------------------------------------------------------------
update productsizecolors p
set color = m.new_color
from color_map m
where p.variantid = m.variantid;

-- ---------------------------------------------------------------------------
-- 4. Verify invariants; abort the whole transaction on any mismatch
-- ---------------------------------------------------------------------------
do $$
declare
  bad_norm  int;
  stock_now numeric;
  bill_now  int;
  stock_ref int;
  pre       record;
begin
  select * into pre from _pre;

  -- every color must now be in canonical form (idempotent under the rule)
  select count(*) into bad_norm
  from productsizecolors
  where color <> initcap(btrim(regexp_replace(color, '[_[:space:]]+', ' ', 'g')));
  if bad_norm > 0 then
    raise exception 'Color cleanup aborted: % row(s) still non-canonical', bad_norm;
  end if;

  select coalesce(sum(stock),0) into stock_now from productsizecolors;
  if stock_now <> pre.stock_sum then
    raise exception 'Color cleanup aborted: stock total changed % -> %', pre.stock_sum, stock_now;
  end if;

  select count(*) into bill_now from bill_items;
  if bill_now <> pre.bill_cnt then
    raise exception 'Color cleanup aborted: bill_items count changed % -> %', pre.bill_cnt, bill_now;
  end if;

  select count(*) into stock_ref from stocktransactions;
  if stock_ref <> pre.stock_cnt then
    raise exception 'Color cleanup aborted: stocktransactions count changed % -> %', pre.stock_cnt, stock_ref;
  end if;
end $$;

commit;
