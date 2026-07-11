-- Storefront public read access: productimages
--
-- The public storefront (src/storefront/*) talks to Supabase with the ANON key.
-- It previously discovered product images by LISTING the `mockups` storage
-- bucket per product. The `productimages` table is a cleaner source: it holds
-- the full public image URL plus `displayorder` (image sequence) and
-- `productcolor`, so images can be shown in a defined order. The table has RLS
-- enabled with admin-only policies, so anon SELECTs return zero rows.
--
-- This migration grants READ-ONLY (SELECT) access to the anon role for
-- `productimages` so the storefront can query it. No write access is granted;
-- the table exposes only image URLs and display metadata (no cost/supplier/
-- customer/billing data).
--
-- Apply once in the Supabase SQL editor (or via `supabase db query --linked`).

alter table public.productimages enable row level security;

drop policy if exists "storefront anon read productimages" on public.productimages;

create policy "storefront anon read productimages"
  on public.productimages for select to anon using (true);
