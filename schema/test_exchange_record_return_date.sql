-- Tests for schema/migration_exchange_record_return_date.sql: exchange_record's optional
-- p_returndate. The whole file is one transaction that always rolls back, and its final select
-- returns only pass and fail counts. A failed check also raises a WARNING naming it.
-- Run locally (the same migrations as schema/test_bill_exchange_lines.sql, then):
--   scripts/test-db.sh sql schema/migration_exchange_record_return_date.sql \
--     schema/test_bill_exchange_lines.sql schema/test_exchange_record_return_date.sql
-- (test_bill_exchange_lines.sql calls exchange_record with three arguments, as the Exchange page
-- does: it must still pass after the migration.)
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _rd_checks (label text not null, passed boolean not null) on commit drop;
grant all on _rd_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _rd_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('e0c11e00-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-a00000000002'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-100000000011'::uuid $$;

-- Runs p_sql as an admin through the API would: 'ok', the P0001 error code, or the SQLSTATE.
create function pg_temp.as_admin(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.admin_id(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  return case when sqlstate = 'P0001' then sqlerrm else sqlstate end;
end $$;

create function pg_temp.rpc(p_sql text) returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.admin_id(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into r;
  perform set_config('role', 'none', true);
  return r;
end $$;

-- A one-line bill paid 500, dated p_date (orderdate is set after the save, as the owner).
create function pg_temp.save(p_key int, p_date date) returns int language plpgsql as $$
declare
  b int;
begin
  b := (pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key), 'finalize_create',
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', -9711, 'notes', 'RDATE', 'totalamount', 500,
        'gst_total', 0, 'discount_total', 0, 'taxable_total', 500, 'paymentstatus', 'finalized',
        'finalized', true, 'payment_amount', 500, 'net_amount', 500, 'salesmethodid', -9711),
      'items', jsonb_build_array(
        jsonb_build_object('quantity', 1, 'mrp', 500, 'variantid', pg_temp.v1(),
          'product_name', 'A', 'product_code', 'RDP1', 'subtotal', 500, 'gst_amount', 0, 'total', 500)))))
    ->> 'billid')::int;
  update public.bills set orderdate = p_date where billid = b;
  return b;
end $$;

create function pg_temp.line(p_b int) returns int language sql as $$
  select bill_item_id from public.bill_items where billid = p_b
$$;
create function pg_temp.items(p_b int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('bill_item_id', pg_temp.line(p_b), 'quantity', 1,
                                              'credit_amount', 500, 'reason', 'RDATE'))
$$;
create function pg_temp.returndate(p_b int) returns timestamp language sql as $$
  select returndate from public.exchanges where original_bill_item_id = pg_temp.line(p_b)
$$;
create function pg_temp.stock() returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = pg_temp.v1()
$$;
create function pg_temp.today_ist() returns date language sql as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'rdate-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'rdate-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9711, 'RDATEFIXTURE00000000000001', 'Fixture', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9711, 'RDATE cash');
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('RDATE') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('RDATE', 'RDATE', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('RDP1', 'Fixture A', 200, 500);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('RDP1', 'RDATE', 'RDATE', 100, pg_temp.v1());
end $$;
grant select, insert, update, delete on public.bills, public.bill_payments, public.bill_items,
  public.exchanges to authenticated;
grant usage on sequence public.bill_payments_payment_id_seq, public.orderitems_orderitemid_seq,
  public.returns_returnid_seq to authenticated;

-- ---------- 1. Left out: the time of the call, as before (the Exchange page) ----------
do $$
declare
  b int := pg_temp.save(1, pg_temp.today_ist() - 3);
begin
  perform pg_temp.ok('1 three-argument call accepted',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9711, %L)', b, pg_temp.items(b))) = 'ok');
  perform pg_temp.ok('1 returndate is the time of the call',
    pg_temp.returndate(b) = current_timestamp::timestamp);
end $$;

-- ---------- 2. Given: stored as the return date, and the exchange is recorded as before ----------
do $$
declare
  b int := pg_temp.save(2, pg_temp.today_ist() - 8);
  s numeric := pg_temp.stock();
  d timestamp := (pg_temp.today_ist() - 5) + time '12:00';
begin
  perform pg_temp.ok('2 four-argument call accepted (named, as the API sends it)',
    pg_temp.as_admin(format(
      'select public.exchange_record(p_billid => %s, p_customerid => -9711, p_items => %L, p_returndate => %L)',
      b, pg_temp.items(b), d)) = 'ok');
  perform pg_temp.ok('2 returndate is the date given', pg_temp.returndate(b) = d);
  perform pg_temp.ok('2 stock back as before', pg_temp.stock() = s + 1);
end $$;

-- ---------- 3. Refused dates write nothing ----------
do $$
declare
  b int := pg_temp.save(5, pg_temp.today_ist() - 4);
  s numeric := pg_temp.stock();
begin
  perform pg_temp.ok('3 a return dated before the sale is refused',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9711, %L, %L)', b, pg_temp.items(b),
      (pg_temp.today_ist() - 5) + time '12:00')) = 'EXCHANGE_BAD_DATE');
  perform pg_temp.ok('3 a return dated after today in India is refused',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9711, %L, %L)', b, pg_temp.items(b),
      (pg_temp.today_ist() + 1) + time '00:00')) = 'EXCHANGE_BAD_DATE');
  perform pg_temp.ok('3 nothing recorded or restocked',
    pg_temp.returndate(b) is null and pg_temp.stock() = s);
  perform pg_temp.ok('3 a return dated the sale day at midday is accepted',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9711, %L, %L)', b, pg_temp.items(b),
      (pg_temp.today_ist() - 4) + time '12:00')) = 'ok');
end $$;

-- ---------- 4. Signature and grants ----------
do $$
begin
  perform pg_temp.ok('4 only the four-argument function exists',
    (select array_agg(pg_get_function_identity_arguments(p.oid)) from pg_proc p
      where p.proname = 'exchange_record' and p.pronamespace = 'public'::regnamespace)
    = array['p_billid integer, p_customerid integer, p_items jsonb, p_returndate timestamp without time zone']);
  perform pg_temp.ok('4 still security definer',
    (select bool_and(p.prosecdef) from pg_proc p
      where p.proname = 'exchange_record' and p.pronamespace = 'public'::regnamespace));
  perform pg_temp.ok('4 authenticated may execute, anon and public may not',
    has_function_privilege('authenticated', 'public.exchange_record(int, int, jsonb, timestamp)', 'execute')
    and not has_function_privilege('anon', 'public.exchange_record(int, int, jsonb, timestamp)', 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.proname = 'exchange_record' and p.pronamespace = 'public'::regnamespace
                       and a.grantee = 0));
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _rd_checks;
rollback;
