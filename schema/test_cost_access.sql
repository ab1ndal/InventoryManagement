-- Tests for migration_cost_admin_views.sql and migration_cost_column_lockdown.sql.
-- Run locally: scripts/test-db.sh up, migration_product_titles.sql, both migrations, then this file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_sub, true),
         set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

begin;
insert into public.categories (categoryid, name) values ('SA', 'Saree') on conflict do nothing;
insert into public.products (productid, name, categoryid, fabric, purchaseprice, retailprice)
values ('BC2599', 'x', 'SA', 'Silk', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid)
values ('BC2599', 'M', 'Blue', 1, gen_random_uuid());
insert into public.productimages (productid, imageurl) values ('BC2599', 'https://x.test/a.webp');
insert into public.mockups (productid) values ('BC2599') on conflict do nothing;
grant select on public.profiles to authenticated;
-- Live already has these grants; the harness starts without them.
grant select on public.mockups_view to authenticated;
grant insert, update on public.products to authenticated;
alter table public.profiles disable trigger user;
insert into public.profiles (id, role) values ('00000000-0000-4000-8000-00000000000a', 'admin');

-- A customer: sees the product, never its cost, by any route.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
set local role authenticated;
do $$
begin
  perform display_title, retailprice from public.products where productid = 'BC2599';
  begin
    perform purchaseprice from public.products limit 1;
    assert false, 'customer read purchaseprice';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform * from public.products limit 1;
    assert false, 'select * must fail for a customer';
  exception when insufficient_privilege then
    null;
  end;
  assert (select count(*) from public.products_admin) = 0, 'products_admin is empty for a customer';
  assert (select count(*) from public.variant_costs) = 0, 'variant_costs is empty for a customer';
  assert (select count(*) from public.mockups_view) = 0, 'mockups_view is empty for a customer';
  assert (select count(*) from public.inventory_stats_by_category()) = 0, 'stats are empty for a customer';
end $$;
reset role;

-- An admin: reads cost through the views and can still write it.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
set local role authenticated;
do $$
begin
  assert (select purchaseprice from public.products_admin where productid = 'BC2599') = 500, 'admin reads cost';
  assert (select count(*) from public.variant_costs where purchaseprice = 500) >= 1, 'admin reads variant cost';
  assert (select count(*) from public.mockups_view where productid = 'BC2599') = 1, 'admin reads mockups_view';
  assert (select total_purchase_value from public.inventory_stats_by_category() where category = 'Saree') = 500, 'admin reads stats';
  update public.products set purchaseprice = 600 where productid = 'BC2599';
  assert (select purchaseprice from public.products_admin where productid = 'BC2599') = 600, 'admin writes cost';
end $$;
reset role;

-- Anon: no cost, no views, no writes.
set local role anon;
do $$
begin
  perform display_title from public.products limit 1;
  begin
    perform 1 from public.products_admin limit 1;
    assert false, 'anon read products_admin';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.variant_costs limit 1;
    assert false, 'anon read variant_costs';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.products where productid = 'BC2599';
    assert false, 'anon delete must be denied';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
rollback;
