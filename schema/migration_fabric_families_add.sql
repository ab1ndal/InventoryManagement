-- ============================================================================
-- migration_fabric_families_add.sql
-- Fabric multi-family, part 1 of 2 (additive). Adds fabrics.families text[] and
-- backfills from the single family column, which is KEPT for now so old readers
-- keep working. The drop lives in migration_fabric_drop_family.sql, applied at
-- release once no code reads family. Owner decision: no fabric_families table —
-- the vocabulary is the set of distinct values in fabrics.families (app-derived).
-- ============================================================================

begin;

-- Backup (drop manually after owner sign-off)
create table _backup_fabrics_family_20260709 as
  select code, family, sort_order from fabrics;

-- Add the array column and backfill each code's single family as a 1-element array
alter table fabrics add column families text[] not null default '{}';
update fabrics set families = array[family];

-- Verify every backfilled row has exactly its one family, and every live
-- products.fabric still maps to a fabrics.code
do $$
declare bad int; unmapped int; bad_val text;
begin
  select count(*) into bad from fabrics where array_length(families,1) is distinct from 1;
  if bad > 0 then
    raise exception 'Fabric backfill error: % row(s) not exactly one family', bad;
  end if;
  select count(*), min(p.fabric) into unmapped, bad_val
  from products p left join fabrics f on f.code = p.fabric where f.code is null;
  if unmapped > 0 then
    raise exception 'Fabric mapping error: % product(s) have a fabric not in the lookup (e.g. "%")', unmapped, bad_val;
  end if;
end $$;

commit;
