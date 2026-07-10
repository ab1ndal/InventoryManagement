-- Storefront cost-price lockdown
--
-- The storefront uses the ANON key. migration_storefront_public_read.sql grants
-- anon row-level SELECT on products via RLS `using (true)`. RLS is row-level, so
-- anon receives EVERY column, including products.purchaseprice (cost/margin).
-- Additionally, mockups_view runs with definer rights and exposes purchaseprice
-- to anon, bypassing RLS entirely.
--
-- Fix: replace anon's blanket table SELECT on products with column-level grants
-- that exclude purchaseprice, and revoke anon SELECT on mockups_view (admin-only).
-- The RLS policy from migration_storefront_public_read.sql stays in place; column
-- privileges are what now hides purchaseprice.
--
-- Apply once in the Supabase SQL editor (run as the postgres role; service_role
-- does not own these objects).

-- ---------------------------------------------------------------------------
-- products: column-level anon SELECT excluding purchaseprice
-- ---------------------------------------------------------------------------
revoke select on public.products from anon;

grant select (
  productid,
  name,
  description,
  categoryid,
  fabric,
  retailprice,
  producturl,
  unit_type
) on public.products to anon;

-- ---------------------------------------------------------------------------
-- mockups_view: admin-only. Only src/admin/components/MockupTable.js queries it,
-- under an authenticated (admin) session. Anon has no legitimate use for it.
-- ---------------------------------------------------------------------------
revoke select on public.mockups_view from anon;
