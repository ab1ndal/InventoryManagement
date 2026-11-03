-- Customer-facing product titles (2026-11-03). 820 live products share 149 names because `name` is
-- only fabric + category. `name` stays as it is for inventory and bills.
--
-- categories.title_word: how a category reads inside a title ("Suits" → "Suit").
-- products.title_detail: short text staff type, such as "Zari Embroidery". Optional.
-- products.display_title: what customers see. Always computed, never typed, so no entry path
--   (admin form, CLI, variant edits) can leave it stale:
--     with a detail: {colour, if exactly one} {fabric} {type} with {detail}
--     without:       name with hyphens as spaces, which is how product cards already show it
--   Colours count every variant, in stock or not, so a colour selling out does not rename a product.
-- preview_product_title: the admin form's live preview and duplicate warning.

alter table public.categories add column if not exists title_word text;

update public.categories c set title_word = v.word
  from (values
    ('ST', 'Suit'), ('RMS', 'Readymade Suit'), ('S2P', '2 Piece Suit'), ('S3P', '3 Piece Suit'),
    ('S5P', '5 Piece Suit'), ('SJ-2P', '2 Piece Jodhpuri Suit'), ('SJ-3P', '3 Piece Jodhpuri Suit'),
    ('SKT-TOP', 'Skirt and Crop Top'), ('CRD', 'Cord Set'), ('TOP', 'Top'), ('PL', 'Palazzo'),
    ('C-KP', 'Kids Kurta Pajama'), ('C-IW', 'Kids Indo-Western'), ('C-SW', 'Kids Sherwani'),
    ('C-S3P', 'Kids 3 Piece Suit'), ('C-S5P', 'Kids 5 Piece Suit')
  ) as v(id, word)
 where c.categoryid = v.id;

alter table public.products add column if not exists title_detail text;
alter table public.products add column if not exists display_title text;
alter table public.products drop constraint if exists products_title_detail_length;
alter table public.products add constraint products_title_detail_length
  check (title_detail is null or length(title_detail) <= 60);

create or replace function public._compose_product_title(
  p_name text, p_fabric text, p_type text, p_detail text, p_colours text[])
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  -- Staff may type "with zari work"; the title adds its own "with".
  v_detail text := nullif(regexp_replace(regexp_replace(btrim(coalesce(p_detail, '')), '\s+', ' ', 'g'), '^with\s+', '', 'i'), '');
  v_colours text[];
begin
  if v_detail is null then
    return btrim(replace(coalesce(p_name, ''), '-', ' '));
  end if;
  select array_agg(c) into v_colours
    from (select min(btrim(x)) as c from unnest(p_colours) x where btrim(x) <> '' group by lower(btrim(x))) d;
  return concat_ws(' ',
    case when cardinality(v_colours) = 1 then v_colours[1] end,
    nullif(btrim(coalesce(p_fabric, '')), ''),
    nullif(btrim(coalesce(p_type, '')), ''))
    || ' with ' || v_detail;
end;
$$;

create or replace function public._set_product_display_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.display_title := public._compose_product_title(
    new.name,
    new.fabric,
    (select coalesce(c.title_word, c.name) from public.categories c where c.categoryid = new.categoryid),
    new.title_detail,
    (select array_agg(s.color) from public.productsizecolors s where s.productid = new.productid));
  return new;
end;
$$;

-- Named to sort after trg_sync_product_name: BEFORE triggers fire alphabetically, and this reads `name`.
drop trigger if exists trg_zz_product_display_title on public.products;
create trigger trg_zz_product_display_title
  before insert or update of name, fabric, categoryid, title_detail, display_title on public.products
  for each row execute function public._set_product_display_title();

-- Only colour changes fire this, so stock updates from billing and orders never touch products.
create or replace function public._refresh_display_title_from_variant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' then
    update public.products set display_title = null where productid = new.productid;
  end if;
  if tg_op <> 'INSERT' and (tg_op = 'DELETE' or old.productid is distinct from new.productid) then
    update public.products set display_title = null where productid = old.productid;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_variant_display_title on public.productsizecolors;
create trigger trg_variant_display_title
  after insert or delete or update of color, productid on public.productsizecolors
  for each row execute function public._refresh_display_title_from_variant();

update public.products set display_title = null;
alter table public.products alter column display_title set not null;

create or replace function public.preview_product_title(
  p_fabric text, p_categoryid text, p_detail text, p_colours text[], p_exclude_productid text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_title text := public._compose_product_title(
    null, p_fabric,
    (select coalesce(c.title_word, c.name) from public.categories c where c.categoryid = p_categoryid),
    p_detail, p_colours);
begin
  return jsonb_build_object(
    'title', v_title,
    'duplicate', v_title <> '' and exists (
      select 1 from public.products p
       where lower(p.display_title) = lower(v_title)
         and p.productid is distinct from p_exclude_productid));
end;
$$;

revoke all on function public._compose_product_title(text, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public._set_product_display_title() from public, anon, authenticated;
revoke all on function public._refresh_display_title_from_variant() from public, anon, authenticated;
revoke all on function public.preview_product_title(text, text, text, text[], text) from public, anon;
grant execute on function public.preview_product_title(text, text, text, text[], text) to authenticated;

-- products has column-level grants so anon can never read purchaseprice.
grant select (display_title) on public.products to anon;
grant select (display_title, title_detail) on public.products to authenticated;
grant insert (title_detail), update (title_detail) on public.products to authenticated;
