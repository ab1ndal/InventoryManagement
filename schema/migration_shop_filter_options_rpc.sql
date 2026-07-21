-- Shop filter options: single-round-trip RPC
--
-- The shop page previously fetched its filter vocabularies with seven separate
-- anon queries fired in parallel on mount (categories, colors, color_families,
-- fabrics, sizes, distinct in-stock sizes, and the price ceiling). That burst
-- of concurrent requests to the Cloudflare-fronted Supabase REST host is what
-- looks bot-like and triggers the `__cf_bm` challenge cookie (see
-- src/lib/supabaseFetch.js). Collapsing them into one RPC removes the burst and
-- cuts the shop's initial load to a single request.
--
-- SECURITY INVOKER (the default): the function runs with the caller's
-- privileges, so anon reads are still governed by the existing per-table RLS
-- read policies. No new data is exposed and no privilege is escalated.
--
-- Apply once (Supabase SQL editor or supabase CLI).

create or replace function public.get_shop_filter_options()
returns json
language sql
stable
as $$
  select json_build_object(
    'categories', coalesce(
      (select json_agg(json_build_object('categoryid', categoryid, 'name', name) order by name)
         from public.categories), '[]'::json),
    'colors', coalesce(
      (select json_agg(json_build_object('code', code, 'families', families))
         from public.colors), '[]'::json),
    'color_families', coalesce(
      (select json_agg(json_build_object('family', family, 'hex', hex, 'sort_order', sort_order) order by sort_order)
         from public.color_families), '[]'::json),
    'fabrics', coalesce(
      (select json_agg(json_build_object('code', code, 'families', families))
         from public.fabrics), '[]'::json),
    'sizes', coalesce(
      (select json_agg(json_build_object('code', code, 'label', label, 'sort_order', sort_order))
         from public.sizes), '[]'::json),
    'distinct_sizes', coalesce(
      (select json_agg(size) from (select distinct size from public.productsizecolors where size is not null) s),
      '[]'::json),
    'price_max', (select max(retailprice) from public.products)
  );
$$;

grant execute on function public.get_shop_filter_options() to anon, authenticated;
