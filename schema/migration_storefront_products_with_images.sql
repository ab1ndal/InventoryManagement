-- Storefront: only show products that have at least one image
--
-- Of ~3,676 products only ~787 have rows in `productimages` (all pointing at
-- real objects in the `mockups` storage bucket). The rest render as initials
-- placeholders, which makes the shop look empty. Instead of filtering in each
-- of the ~8 storefront product queries, narrow the anon read policy itself, so
-- every storefront read (shop grid, search, collections, home rails, category
-- counts, product page, and the security-invoker `get_shop_filter_options`
-- RPC) sees the same catalogue.
--
-- Admin access is unaffected: admins read via the separate `admin_only`
-- policy (`is_admin()`). Reversible by recreating the policy with
-- `using (true)`.
--
-- Known consequences: a direct URL to an imageless product returns "not
-- found", and a cart line for an imageless product gets no price from
-- `cartApi.fetchLiveVariantData`.
--
-- The policy's EXISTS runs per product row, so index the lookup column
-- (productimages had only its primary key).
--
-- Apply once via `supabase db query --linked` or the Supabase SQL editor.

create index if not exists productimages_productid_idx
  on public.productimages (productid);

drop policy if exists "storefront anon read products" on public.products;

create policy "storefront anon read products"
  on public.products for select to anon
  using (
    exists (
      select 1 from public.productimages pi
      where pi.productid = products.productid
    )
  );
