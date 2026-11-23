-- Tests for schema/migration_product_public_id.sql. Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally: scripts/test-db.sh up, then schema/migration_product_titles.sql (display_title
-- trigger), then the migration, then this file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.mk(p_id text) returns text language sql as $$
  insert into public.categories (categoryid, name) values ('SA', 'SA') on conflict do nothing;
  insert into public.products (productid, name, categoryid, fabric, purchaseprice, retailprice)
  values (p_id, 'Silk-Saree', 'SA', 'Silk', 1, 2)
  returning public_id;
$$;

-- An insert that names no public_id gets one in the address alphabet.
begin;
do $$
declare v text := pg_temp.mk('TT1');
begin
  assert v ~ '^[a-hj-km-np-z2-9]{5}$', v;
end $$;
rollback;

-- Many inserts get distinct IDs, none of which reads as an old product address (BC + 5 digits).
begin;
do $$
declare n int;
begin
  for i in 1 .. 500 loop perform pg_temp.mk('TT' || i); end loop;
  select count(distinct public_id) into n from public.products where productid like 'TT%';
  assert n = 500, n;
  assert not exists (select 1 from public.products where public_id ~* '^bc[0-9]{5,}$');
end $$;
rollback;

-- Every row has one after the migration, and the column is unique.
begin;
do $$
begin
  assert not exists (select 1 from public.products where public_id is null);
  assert (select count(*) = count(distinct public_id) from public.products);
  assert exists (select 1 from pg_indexes where indexname = 'products_public_id_key');
end $$;
rollback;

-- A duplicate is refused by the index.
begin;
do $$
declare v text := pg_temp.mk('TT1');
begin
  begin
    insert into public.products (productid, name, categoryid, fabric, purchaseprice, retailprice, public_id)
    values ('TT2', 'Silk-Saree', 'SA', 'Silk', 1, 2, v);
    assert false, 'duplicate public_id was accepted';
  exception when unique_violation then null;
  end;
end $$;
rollback;

-- The storefront roles can read it.
begin;
do $$
begin
  assert has_column_privilege('anon', 'public.products', 'public_id', 'select');
  assert has_column_privilege('authenticated', 'public.products', 'public_id', 'select');
end $$;
rollback;

-- The title trigger still runs on insert.
begin;
do $$
begin
  perform pg_temp.mk('TT1');
  assert (select display_title from public.products where productid = 'TT1') is not null;
end $$;
rollback;
