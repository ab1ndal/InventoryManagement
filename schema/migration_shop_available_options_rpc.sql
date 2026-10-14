-- Shop filter availability: compute in SQL instead of from client ID lists
--
-- The /shop sidebar greys out options that have no matching products given
-- the other active filters. The client used to compute this by fetching
-- product IDs from `productsizecolors` and feeding them back into `.in()`
-- filters. PostgREST caps every response at 1000 rows and the anon-visible
-- `productsizecolors` table has ~10.6k rows (variants of all products, not
-- only the image-backed ones the storefront shows), so the ID lists were
-- silently truncated and valid options were greyed out. Paging the rows
-- instead would push ~3.7k IDs into a GET URL, which PostgREST rejects (400).
--
-- This function returns the distinct option values per dimension, each
-- computed with every active filter EXCEPT its own dimension (so selecting a
-- colour never greys out other colours). Colour and size are matched on the
-- same variant row, mirroring the product-list query.
--
-- Arguments are raw codes (colour codes, size codes, fabric codes); the client
-- expands families to codes and maps returned codes back up to families.
-- NULL means "dimension not filtered".
--
-- SECURITY INVOKER (the default): runs with the caller's privileges, so anon
-- only sees products allowed by "storefront anon read products". No new data
-- is exposed. Reversible with:
--   drop function public.get_shop_available_options(text[], text[], text[], text[], numeric, numeric);
--
-- Apply once via `supabase db query --linked` or the Supabase SQL editor.

create or replace function public.get_shop_available_options(
  p_categories   text[]  default null,
  p_color_codes  text[]  default null,
  p_sizes        text[]  default null,
  p_fabric_codes text[]  default null,
  p_price_min    numeric default null,
  p_price_max    numeric default null
)
returns json
language sql
stable
as $$
  with base as (
    select p.productid, p.categoryid, p.fabric
      from public.products p
     where (p_price_min is null or p.retailprice >= p_price_min)
       and (p_price_max is null or p.retailprice <= p_price_max)
  ),
  variants as (
    select v.productid, v.color, v.size
      from public.productsizecolors v
      join base b on b.productid = v.productid
  )
  select json_build_object(
    'categories', coalesce((
      select json_agg(distinct b.categoryid)
        from base b
       where b.categoryid is not null
         and (p_fabric_codes is null or b.fabric = any (p_fabric_codes))
         and ((p_color_codes is null and p_sizes is null) or exists (
               select 1 from variants v
                where v.productid = b.productid
                  and (p_color_codes is null or v.color = any (p_color_codes))
                  and (p_sizes is null or v.size = any (p_sizes))))
    ), '[]'::json),
    'fabric_codes', coalesce((
      select json_agg(distinct b.fabric)
        from base b
       where b.fabric is not null
         and (p_categories is null or b.categoryid = any (p_categories))
         and ((p_color_codes is null and p_sizes is null) or exists (
               select 1 from variants v
                where v.productid = b.productid
                  and (p_color_codes is null or v.color = any (p_color_codes))
                  and (p_sizes is null or v.size = any (p_sizes))))
    ), '[]'::json),
    'color_codes', coalesce((
      select json_agg(distinct v.color)
        from variants v
        join base b on b.productid = v.productid
       where v.color is not null
         and (p_categories is null or b.categoryid = any (p_categories))
         and (p_fabric_codes is null or b.fabric = any (p_fabric_codes))
         and (p_sizes is null or v.size = any (p_sizes))
    ), '[]'::json),
    'sizes', coalesce((
      select json_agg(distinct v.size)
        from variants v
        join base b on b.productid = v.productid
       where v.size is not null
         and (p_categories is null or b.categoryid = any (p_categories))
         and (p_fabric_codes is null or b.fabric = any (p_fabric_codes))
         and (p_color_codes is null or v.color = any (p_color_codes))
    ), '[]'::json)
  );
$$;

grant execute on function public.get_shop_available_options(text[], text[], text[], text[], numeric, numeric)
  to anon, authenticated;
