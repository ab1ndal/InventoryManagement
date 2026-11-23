-- Public product IDs for storefront addresses (2026-11-22). Product pages move from
-- /product/<productid> to /product/<title slug>-<public_id>; see tasks/product-address-plan.md.
--
-- public_id: 5 characters from abcdefghjkmnpqrstuvwxyz23456789 (no 0 o 1 l i, so it reads clearly).
-- Random, never derived from productid, never changed once set. The column default gives every
-- insert path (admin app, mockup-generator, CLI) one without code changes there.
--
-- Randomness comes from gen_random_uuid(), which is core Postgres, so the function does not depend
-- on where pgcrypto is installed. Bytes 6 and 8 carry the UUID version and variant bits and are
-- skipped. Bytes of 240 or more are dropped so each character is equally likely (240 = 8 x 30).

begin;

create or replace function public.gen_product_public_id()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  c_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  c_length constant int := 5;
  v_bytes bytea;
  v_byte int;
  v_id text;
  i int;
begin
  loop
    v_id := '';
    while length(v_id) < c_length loop
      v_bytes := uuid_send(gen_random_uuid());
      for i in 0 .. 15 loop
        continue when i in (6, 8);
        v_byte := get_byte(v_bytes, i);
        continue when v_byte >= 240;
        v_id := v_id || substr(c_alphabet, v_byte % 30 + 1, 1);
        exit when length(v_id) = c_length;
      end loop;
    end loop;
    -- The unique index is the real guard; this check only makes a collision retry instead of fail.
    exit when not exists (select 1 from public.products where public_id = v_id);
  end loop;
  return v_id;
end;
$$;

alter table public.products add column if not exists public_id text;

-- One statement per row: a single UPDATE cannot see the IDs it gave earlier rows, and across
-- ~3,700 rows the chance of a duplicate would be about 1 in 4.
do $$
declare
  v_productid text;
begin
  for v_productid in select productid from public.products where public_id is null order by productid loop
    update public.products set public_id = public.gen_product_public_id() where productid = v_productid;
  end loop;
end $$;

alter table public.products alter column public_id set default public.gen_product_public_id();
alter table public.products alter column public_id set not null;
create unique index if not exists products_public_id_key on public.products (public_id);

-- products has column-level grants for the storefront roles; a new column is unreadable without one.
grant select (public_id) on public.products to anon, authenticated;

commit;
