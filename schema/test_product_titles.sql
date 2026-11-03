-- Tests for schema/migration_product_titles.sql. Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally: scripts/test-db.sh up, then this migration, then this file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.mk(p_id text, p_cat text, p_fabric text, p_detail text default null) returns void language sql as $$
  insert into public.categories (categoryid, name) values (p_cat, p_cat) on conflict do nothing;
  insert into public.products (productid, name, categoryid, fabric, purchaseprice, retailprice, title_detail)
  values (p_id, 'x', p_cat, p_fabric, 1, 2, p_detail);
$$;
-- The migration's mapping ran before these fixtures existed.
create function pg_temp.suit_category() returns void language sql as $$
  insert into public.categories (categoryid, name, title_word) values ('ST', 'Suits', 'Suit')
  on conflict (categoryid) do update set title_word = 'Suit';
$$;
create function pg_temp.title(p_id text) returns text language sql as $$
  select display_title from public.products where productid = p_id;
$$;

-- Without a detail the title stays the cleaned-up name, so nothing changes until staff add one.
begin;
do $$
begin
  perform pg_temp.mk('TT1', 'SA', 'Silk');
  assert pg_temp.title('TT1') = replace((select name from public.products where productid = 'TT1'), '-', ' '), pg_temp.title('TT1');
end $$;
rollback;

-- One colour goes in the title; a second drops it; removing it brings it back.
begin;
do $$
declare
  type_word text;
begin
  perform pg_temp.mk('TT2', 'SA', 'Silk', 'Zari Embroidery');
  select coalesce(title_word, name) into type_word from public.categories where categoryid = 'SA';
  assert pg_temp.title('TT2') = 'Silk ' || type_word || ' with Zari Embroidery', 'no colours yet: ' || pg_temp.title('TT2');
  insert into public.productsizecolors (productid, size, color, stock, variantid) values ('TT2', 'M', 'Blue', 1, gen_random_uuid()), ('TT2', 'L', ' blue ', 1, gen_random_uuid());
  assert pg_temp.title('TT2') like '% Silk % with Zari Embroidery' and pg_temp.title('TT2') ilike 'blue %', 'same colour twice: ' || pg_temp.title('TT2');
  insert into public.productsizecolors (productid, size, color, stock, variantid) values ('TT2', 'M', 'Red', 1, gen_random_uuid());
  assert pg_temp.title('TT2') = 'Silk ' || type_word || ' with Zari Embroidery', 'two colours: ' || pg_temp.title('TT2');
  delete from public.productsizecolors where productid = 'TT2' and color = 'Red';
  assert pg_temp.title('TT2') ilike 'blue %', 'back to one: ' || pg_temp.title('TT2');
end $$;
rollback;

-- Selling out does not rename; a stock update never touches the product.
begin;
do $$
begin
  perform pg_temp.mk('TT3', 'SA', 'Silk', 'Zari');
  insert into public.productsizecolors (productid, size, color, stock, variantid) values ('TT3', 'M', 'Blue', 1, gen_random_uuid()), ('TT3', 'M', 'Red', 1, gen_random_uuid());
  update public.products set title_detail = 'Zari Work' where productid = 'TT3';
  update public.productsizecolors set stock = 0 where productid = 'TT3' and color = 'Red';
  assert pg_temp.title('TT3') not ilike 'blue %', 'still two colours: ' || pg_temp.title('TT3');
end $$;
rollback;

-- Typed text is tidied, the title cannot be written directly, and the mapped category word is used.
begin;
do $$
begin
  perform pg_temp.suit_category();
  perform pg_temp.mk('TT4', 'ST', 'Cotton', '  with   Mirror  Work ');
  assert pg_temp.title('TT4') = 'Cotton Suit with Mirror Work', pg_temp.title('TT4');
  update public.products set display_title = 'Hacked' where productid = 'TT4';
  assert pg_temp.title('TT4') = 'Cotton Suit with Mirror Work', 'direct write ignored';
  update public.products set fabric = 'Silk' where productid = 'TT4';
  assert pg_temp.title('TT4') = 'Silk Suit with Mirror Work', 'follows fabric';
  update public.products set title_detail = '   ' where productid = 'TT4';
  assert pg_temp.title('TT4') = replace((select name from public.products where productid = 'TT4'), '-', ' '), 'blank detail falls back';
  begin
    update public.products set title_detail = repeat('x', 61) where productid = 'TT4';
    assert false, 'too long must fail';
  exception when check_violation then
    null;
  end;
end $$;
rollback;

-- Preview matches the saved title and flags another product's title, not this product's own.
begin;
do $$
declare
  j jsonb;
begin
  perform pg_temp.suit_category();
  perform pg_temp.mk('TT5', 'ST', 'Cotton', 'Mirror Work');
  j := public.preview_product_title('Cotton', 'ST', 'mirror work', null, null);
  assert j ->> 'title' = 'Cotton Suit with mirror work' and (j ->> 'duplicate')::boolean, j::text;
  j := public.preview_product_title('Cotton', 'ST', 'Mirror Work', null, 'TT5');
  assert not (j ->> 'duplicate')::boolean, 'own title is no duplicate';
  j := public.preview_product_title('Cotton', 'ST', 'Mirror Work', array['Blue', 'Red'], 'X');
  assert j ->> 'title' = 'Cotton Suit with Mirror Work', j::text;
  j := public.preview_product_title('Cotton', 'ST', 'Mirror Work', array['Blue'], 'X');
  assert j ->> 'title' = 'Blue Cotton Suit with Mirror Work', j::text;
end $$;
rollback;

-- Grants: anon reads the title but not cost price, and cannot call the preview.
begin;
set local role anon;
do $$
begin
  perform display_title from public.products limit 1;
  begin
    perform public.preview_product_title('a', 'b', 'c', null, null);
    assert false, 'anon must not preview';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform purchaseprice from public.products limit 1;
    assert false, 'anon must not read cost';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
rollback;
