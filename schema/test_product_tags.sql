-- Tests for schema/migration_product_tags.sql, migration_tag_vocab_all_categories.sql and
-- migration_replace_product_tags.sql. Each test is rollback-wrapped.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_product_tags.sql schema/migration_tag_vocab_all_categories.sql \
--     schema/migration_replace_product_tags.sql schema/test_product_tags.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.seed() returns void language sql as $$
  insert into public.categories (categoryid, name) values ('KUR', 'Kurti'), ('SA', 'Saree') on conflict do nothing;
  insert into public.products (productid, name, categoryid, purchaseprice, retailprice)
  values ('TK1', 'Test kurti', 'KUR', 1, 2), ('TS1', 'Test saree', 'SA', 1, 2), ('TK2', 'Hidden kurti', 'KUR', 1, 2);
  insert into public.productimages (productid, imageurl) values ('TK1', 'x'), ('TS1', 'x');
$$;

create function pg_temp.tags(p varchar) returns text language sql as $$
  select coalesce(string_agg(tag_group || '=' || value || ':' || source, ',' order by tag_group, value), '')
  from public.product_tags where productid = p
$$;

-- 'ai' scope writes; 'all' replaces everything; 'ai' never touches manual rows
begin;
do $$
begin
  perform pg_temp.seed();
  perform public.replace_product_tags('TK1', '[{"tag_group":"occasion","value":"festive","source":"ai_reviewed","confidence":0.9},{"tag_group":"neck","value":"round","source":"ai_reviewed"}]', 'ai');
  assert pg_temp.tags('TK1') = 'neck=round:ai_reviewed,occasion=festive:ai_reviewed', 'ai insert, got ' || pg_temp.tags('TK1');
  perform public.replace_product_tags('TK1', '[{"tag_group":"neck","value":"v-neck","source":"manual"}]', 'all');
  assert pg_temp.tags('TK1') = 'neck=v-neck:manual', 'all replaces, got ' || pg_temp.tags('TK1');
  perform public.replace_product_tags('TK1', '[{"tag_group":"neck","value":"round","source":"ai_reviewed"},{"tag_group":"occasion","value":"party","source":"ai_reviewed"}]', 'ai');
  assert pg_temp.tags('TK1') = 'neck=v-neck:manual,occasion=party:ai_reviewed', 'manual neck wins, got ' || pg_temp.tags('TK1');
  perform public.replace_product_tags('TK1', '[]', 'ai');
  assert pg_temp.tags('TK1') = 'neck=v-neck:manual', 'ai empty clears ai rows only, got ' || pg_temp.tags('TK1');
end $$;
rollback;

-- rejected calls change nothing
begin;
do $$
declare
  cases text[][] := array[
    ['TS1', '[{"tag_group":"neck","value":"round","source":"ai_reviewed"}]', 'ai', 'not allowed'],
    ['TK1', '[{"tag_group":"neck","value":"round","source":"manual"},{"tag_group":"neck","value":"v-neck","source":"manual"}]', 'all', 'single-value'],
    ['TK1', '[{"tag_group":"occasion","value":"nope","source":"manual"}]', 'all', 'not allowed'],
    ['NOPE', '[]', 'all', 'not found'],
    ['TK1', '[]', 'x', 'p_scope'],
    ['TK1', '{}', 'all', 'json array'],
    ['TK1', '[{"tag_group":"occasion","value":"festive","source":"bogus"}]', 'ai', 'check constraint']];
  c text[];
  failed boolean;
begin
  perform pg_temp.seed();
  perform public.replace_product_tags('TK1', '[{"tag_group":"occasion","value":"festive","source":"manual"}]', 'all');
  foreach c slice 1 in array cases loop
    failed := false;
    begin
      perform public.replace_product_tags(c[1], c[2]::jsonb, c[3]);
    exception when others then
      failed := true;
      assert sqlerrm like '%' || c[4] || '%', 'expected ' || c[4] || ', got ' || sqlerrm;
    end;
    assert failed, 'expected error: ' || c[4];
    assert pg_temp.tags('TK1') = 'occasion=festive:manual', 'unchanged after ' || c[4];
  end loop;
end $$;
rollback;

-- category rules from the extended vocabulary: lachha uses lehenga values
begin;
do $$
begin
  assert (select 'LCH' = any(applies_to) from public.tag_vocab where tag_group = 'silhouette' and value = 'flared'), 'LCH flared';
  assert not (select 'SA' = any(applies_to) from public.tag_vocab where tag_group = 'neck' and value = 'round'), 'no neck on saree';
  assert (select count(*) from public.tag_vocab) = 82, 'vocab size';
end $$;
rollback;

-- access: anon cannot call; signed-in non-admin blocked by RLS; admin allowed; storefront reads visible products only
begin;
select pg_temp.seed();
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000a001'), ('00000000-0000-0000-0000-00000000c001');
insert into public.profiles (id, email, role) values ('00000000-0000-0000-0000-00000000a001', 'a@test', 'admin'), ('00000000-0000-0000-0000-00000000c001', 'c@test', 'user');
insert into public.product_tags (productid, tag_group, value, source) values ('TK1', 'occasion', 'festive', 'manual'), ('TK2', 'occasion', 'party', 'manual');
set local role anon;
do $$
declare failed boolean := false;
begin
  begin
    perform public.replace_product_tags('TK1', '[]', 'all');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon must not execute';
  assert (select count(*) from public.product_tags) = 1, 'anon sees tags of visible products only';
  assert (select count(*) from public.tag_vocab) = 82, 'anon reads vocab';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare failed boolean := false;
begin
  begin
    perform public.replace_product_tags('TK1', '[{"tag_group":"occasion","value":"party","source":"manual"}]', 'all');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'non-admin must be blocked by RLS';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert public.is_admin(), 'admin';
  perform public.replace_product_tags('TK1', '[{"tag_group":"occasion","value":"party","source":"manual"}]', 'all');
  assert (select value from public.product_tags where productid = 'TK1') = 'party', 'admin wrote';
end $$;
reset role;
rollback;

\echo 'test_product_tags: all passed'
