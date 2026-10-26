-- Storefront: hide products whose retail price is 0 (or missing)
--
-- A ₹0 price is a data-entry typo, not a real price (owner 2026-10-25), and
-- would let a shopper add the piece to the cart for free. Until the price is
-- fixed in admin, hide the product everywhere on the storefront by narrowing
-- the same read policies that already hide imageless products
-- (migration_storefront_products_with_images.sql,
-- migration_storefront_authenticated_read.sql). Fixing the price in admin
-- brings the product back with no further change.
--
-- 2026-10-25: one image-backed product affected (BC25022).
-- Admin access is unaffected (separate `admin_only` policy).
-- Reversible by re-running the two earlier migrations.
--
-- Apply once via `supabase db query --linked -- "$(cat <file>)"` or the
-- Supabase SQL editor.

drop policy if exists "storefront anon read products" on public.products;

create policy "storefront anon read products"
  on public.products for select to anon
  using (
    products.retailprice > 0
    and exists (
      select 1 from public.productimages pi
      where pi.productid = products.productid
    )
  );

drop policy if exists "storefront authenticated read products" on public.products;

create policy "storefront authenticated read products"
  on public.products for select to authenticated
  using (
    products.retailprice > 0
    and exists (
      select 1 from public.productimages pi
      where pi.productid = products.productid
    )
  );
