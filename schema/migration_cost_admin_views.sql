-- Admin-only reads of cost (2026-11-03), step 1 of 2. Additive, so the live app keeps working while
-- the admin code moves over. Step 2 (migration_cost_column_lockdown.sql) removes the old access.
--
-- Staff and customers share the `authenticated` role, and row security cannot hide a column, so cost
-- reads go through views that run as their owner and return rows only for admins.
--   products_admin: every products column, for admin screens.
--   variant_costs:  cost per variant, for the dashboard.
--   mockups_view:   same columns, now empty for non-admins.
-- Also closes old backup tables, which nothing reads, and write grants anon never needed on products.

create or replace view public.products_admin as
  select p.* from public.products p where (select public.is_admin());

create or replace view public.variant_costs as
  select s.variantid, p.purchaseprice
    from public.productsizecolors s
    join public.products p on p.productid = s.productid
   where (select public.is_admin());

revoke all on public.products_admin, public.variant_costs from public, anon, authenticated;
grant select on public.products_admin, public.variant_costs to authenticated;

create or replace view public.mockups_view as
  select m.productid, m.redo, m.base_mockup, m.file_mockup, m.mockup, m.video, m.ig_post, m.ig_reel,
         m.whatsapp, m.ig_post_date, m.whatsapp_post_date, p.purchaseprice, p.fabric,
         c.name as category,
         string_agg(distinct sc.size::text, ', '::text) as sizes,
         string_agg(distinct sc.color::text, ', '::text) as colors,
         substring(m.productid from 3 for 2)::integer as year_code,
         substring(m.productid from 5)::integer as product_num
    from public.mockups m
    join public.products p on p.productid::text = m.productid::text
    left join public.categories c on c.categoryid::text = p.categoryid::text
    left join public.productsizecolors sc on sc.productid::text = m.productid::text
   where (select public.is_admin())
   group by m.productid, p.purchaseprice, p.fabric, c.name;

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and (c.relname like '\_backup\_%' or c.relname ~ '_backup_[0-9]{8}$')
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.products from anon;
