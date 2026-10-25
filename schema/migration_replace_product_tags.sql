-- One writer for product_tags, shared by the describe batch, mockup-generator Backfill approval
-- and the admin product form (owner approved 2026-10-25).
--
-- replace_product_tags(p_productid, p_tags, p_scope) replaces a product's tags in one transaction:
--   p_tags   jsonb array of {"tag_group", "value", "source", "confidence"}; source is
--            'ai_reviewed' (AI value a reviewer kept or picked) or 'manual' (typed/picked by a person
--            beyond the AI options); confidence is optional (0..1, null for manual).
--   p_scope  'ai'  -> AI pipelines: deletes only the product's ai/ai_reviewed rows, and a value that
--                     clashes with a manual row (same single-value group) is skipped: manual wins.
--            'all' -> admin product form: deletes every row of the product, then inserts p_tags.
-- Every value must exist in tag_vocab and list the product's categoryid in applies_to; otherwise the
-- whole call fails and nothing changes. Returns the product's tags after the write.
--
-- SECURITY INVOKER: admins pass the admin_only RLS policy, the batch and Backfill use the service
-- role. Anyone else is stopped by RLS on product_tags.

-- At most one value per product for single-value groups.
create unique index if not exists product_tags_single_value_idx
  on public.product_tags (productid, tag_group)
  where tag_group in ('silhouette', 'length', 'neck', 'sleeve');

create or replace function public.replace_product_tags(p_productid varchar, p_tags jsonb, p_scope text)
returns setof public.product_tags
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_category varchar;
  v_bad text;
begin
  if p_scope not in ('ai', 'all') then
    raise exception 'replace_product_tags: p_scope must be ai or all, got %', p_scope;
  end if;
  if jsonb_typeof(p_tags) is distinct from 'array' then
    raise exception 'replace_product_tags: p_tags must be a json array';
  end if;

  select categoryid into v_category from products where productid = p_productid;
  if not found then
    raise exception 'replace_product_tags: product % not found', p_productid;
  end if;

  select string_agg(format('%s=%s', t->>'tag_group', t->>'value'), ', ') into v_bad
  from jsonb_array_elements(p_tags) t
  where not exists (
    select 1 from tag_vocab v
    where v.tag_group = t->>'tag_group' and v.value = t->>'value' and v_category = any(v.applies_to)
  );
  if v_bad is not null then
    raise exception 'replace_product_tags: not allowed for % (category %): %', p_productid, v_category, v_bad;
  end if;

  select string_agg(g, ', ') into v_bad from (
    select t->>'tag_group' g from jsonb_array_elements(p_tags) t
    where t->>'tag_group' in ('silhouette', 'length', 'neck', 'sleeve')
    group by 1 having count(distinct t->>'value') > 1
  ) d;
  if v_bad is not null then
    raise exception 'replace_product_tags: more than one value for single-value group(s) %', v_bad;
  end if;

  if p_scope = 'all' then
    delete from product_tags where productid = p_productid;
  else
    delete from product_tags where productid = p_productid and source in ('ai', 'ai_reviewed');
  end if;

  insert into product_tags (productid, tag_group, value, source, confidence)
  select p_productid, t->>'tag_group', t->>'value', t->>'source', (t->>'confidence')::real
  from jsonb_array_elements(p_tags) t
  on conflict do nothing;  -- only reachable in 'ai' scope: a manual row already holds the slot

  return query select * from product_tags where productid = p_productid order by tag_group, value;
end;
$$;

revoke all on function public.replace_product_tags(varchar, jsonb, text) from public, anon;
grant execute on function public.replace_product_tags(varchar, jsonb, text) to authenticated, service_role;
