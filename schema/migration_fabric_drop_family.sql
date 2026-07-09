-- ============================================================================
-- migration_fabric_drop_family.sql
-- Fabric multi-family, part 2 of 2 (breaking). Drops the now-unused single
-- family column. Apply only after the families[]-only build is deployed
-- (the `attributes-manager` branch: no code reads fabrics.family anymore).
-- Until that build is live in production, the deployed app still selects
-- fabrics.family and this drop WILL break it — so this is a release step,
-- run right after deploy, not with the rest of the branch's DB work.
-- ============================================================================

begin;
alter table fabrics drop column family;
commit;
