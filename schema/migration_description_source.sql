-- Marks who wrote products.description so the two description pipelines never
-- overwrite each other (owner decision 2026-10-24):
--   manual       admin edit in ProductTable
--   ai           AI draft not yet reviewed
--   ai_reviewed  AI draft approved by the owner (mockup-generator Backfill or the
--                retail-inventory describe batch)
-- Null = legacy / unknown. Expand-only: both running apps ignore unknown columns.
-- No anon grant: the storefront does not read these columns. authenticated and
-- service_role keep their table-level grants, which cover new columns.

alter table public.products
  add column if not exists description_source text
    check (description_source in ('manual', 'ai', 'ai_reviewed')),
  add column if not exists description_reviewed_at timestamptz;

comment on column public.products.description_source is
  'Who wrote products.description: manual (admin edit), ai (unreviewed AI draft), ai_reviewed (owner-approved AI draft). Null = legacy/unknown.';
comment on column public.products.description_reviewed_at is
  'When an ai_reviewed description was approved. Null = never reviewed.';
