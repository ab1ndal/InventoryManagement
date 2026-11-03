-- Admin-only reads of cost (2026-11-03), step 2 of 2. Apply only after the admin code reading
-- products_admin and variant_costs is live.
--
-- `authenticated` loses read access to purchaseprice. New products columns need their own grant here,
-- which is the point: nothing becomes readable by customers by accident.
-- Inserts and updates are unchanged; row security still limits those to admins.
-- inventory_stats_by_category read cost as its caller, so it now runs as owner and returns nothing
-- for non-admins. Before this, any logged-in customer could call it and get total cost per category.

revoke select on public.products from authenticated;
revoke truncate, references, trigger on public.products from authenticated;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name <> 'purchaseprice';
  execute format('grant select (%s) on public.products to authenticated', cols);
end $$;

create or replace function public.inventory_stats_by_category()
returns table(category text, unique_product_count integer, total_units integer, total_purchase_value numeric, total_retail_value numeric)
language sql
security definer
set search_path = public
as $function$
  with product_stock as (
    select
      p.productid,
      p.categoryid,
      sum(psc.stock) as total_stock,
      p.purchaseprice,
      p.retailprice
    from products p
    join productsizecolors psc
      on p.productid = psc.productid
    where (select public.is_admin())
    group by
      p.productid,
      p.categoryid,
      p.purchaseprice,
      p.retailprice
  )
  select
    coalesce(c.name, 'Uncategorized') as category,
    count(ps.productid) as unique_product_count,
    sum(ps.total_stock) as total_units,
    sum(ps.total_stock * ps.purchaseprice) as total_purchase_value,
    sum(ps.total_stock * ps.retailprice) as total_retail_value
  from product_stock ps
  left join categories c
    on c.categoryid = ps.categoryid
  group by coalesce(c.name, 'Uncategorized')
  order by category;
$function$;

revoke all on function public.inventory_stats_by_category() from public, anon;
grant execute on function public.inventory_stats_by_category() to authenticated;
