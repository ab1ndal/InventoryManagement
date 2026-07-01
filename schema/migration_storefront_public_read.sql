-- Storefront public read access
--
-- The public storefront (src/storefront/*) talks to Supabase with the ANON key.
-- The catalog tables have RLS enabled with policies scoped to authenticated
-- admins only, so anon SELECTs return zero rows and the shop renders empty.
--
-- This migration grants READ-ONLY (SELECT) access to the anon role for the
-- catalog data the storefront needs, plus list access to the public `mockups`
-- storage bucket so product images can be resolved. No write access is granted
-- and no cost/supplier/customer/billing data is exposed.
--
-- Apply once in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Catalog tables: anon read-only
-- ---------------------------------------------------------------------------
alter table public.products            enable row level security;
alter table public.productsizecolors   enable row level security;
alter table public.categories          enable row level security;
alter table public.sizes               enable row level security;

drop policy if exists "storefront anon read products"          on public.products;
drop policy if exists "storefront anon read productsizecolors" on public.productsizecolors;
drop policy if exists "storefront anon read categories"        on public.categories;
drop policy if exists "storefront anon read sizes"             on public.sizes;

create policy "storefront anon read products"
  on public.products for select to anon using (true);

create policy "storefront anon read productsizecolors"
  on public.productsizecolors for select to anon using (true);

create policy "storefront anon read categories"
  on public.categories for select to anon using (true);

create policy "storefront anon read sizes"
  on public.sizes for select to anon using (true);

-- ---------------------------------------------------------------------------
-- RPC used by the shop filters (distinct sizes) — allow anon to execute
-- ---------------------------------------------------------------------------
grant execute on function public.get_distinct_sizes() to anon;

-- ---------------------------------------------------------------------------
-- Product images: allow anon to LIST objects in the public `mockups` bucket.
-- The bucket is already public=true (objects are downloadable by path), but
-- listing a folder hits storage.objects SELECT, which RLS blocks for anon.
-- ---------------------------------------------------------------------------
drop policy if exists "storefront anon list mockups" on storage.objects;

create policy "storefront anon list mockups"
  on storage.objects for select to anon
  using (bucket_id = 'mockups');
