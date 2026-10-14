-- Storefront: catalogue read access for signed-in customers
--
-- The storefront's catalogue policies were granted `to anon` only. Once a
-- customer signs in with a magic link their requests run as `authenticated`,
-- and the only other policy on these tables is `admin_only` (`is_admin()`),
-- so a signed-in customer saw an empty shop and their server cart lost every
-- product name and price (the `products` join in cartApi.fetchServerCart
-- returned null).
--
-- Mirror each anon read policy for `authenticated`, with the same filter: a
-- product is visible only when it has at least one `productimages` row. Admins
-- are `authenticated` too; permissive policies OR together, so `admin_only`
-- still gives them every row. Read-only, no write access granted.
--
-- sizes/colors/fabrics/color_families already have authenticated read
-- policies. The storefront RPCs are SECURITY INVOKER and already executable by
-- `authenticated`, so they inherit these policies.
--
-- Reversible: drop the four policies below.
--
-- Apply once via `supabase db query --linked` or the Supabase SQL editor.

drop policy if exists "storefront authenticated read products" on public.products;
drop policy if exists "storefront authenticated read productsizecolors" on public.productsizecolors;
drop policy if exists "storefront authenticated read categories" on public.categories;
drop policy if exists "storefront authenticated read productimages" on public.productimages;

create policy "storefront authenticated read products"
  on public.products for select to authenticated
  using (
    exists (
      select 1 from public.productimages pi
      where pi.productid = products.productid
    )
  );

create policy "storefront authenticated read productsizecolors"
  on public.productsizecolors for select to authenticated using (true);

create policy "storefront authenticated read categories"
  on public.categories for select to authenticated using (true);

create policy "storefront authenticated read productimages"
  on public.productimages for select to authenticated using (true);
