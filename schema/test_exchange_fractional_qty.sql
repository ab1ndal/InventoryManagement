-- Tests for schema/migration_exchange_fractional_qty.sql: a line sold in a fractional quantity
-- (fabric by the metre, e.g. 3.5 m) can be returned whole through exchange_record, a part of it
-- (1.5 of 3.5 m) is refused, and whole-number returns work exactly as before.
-- The whole file is one transaction that always rolls back, and its final select returns only
-- pass and fail counts. A failed check also raises a WARNING naming it.
-- Run locally (the chain in tasks/manual-item-stock-plan.md section 6, then
-- schema/migration_manual_item_stock.sql, then):
--   scripts/test-db.sh sql schema/migration_exchange_fractional_qty.sql schema/test_exchange_fractional_qty.sql
-- Before the migration it fails (the 3.5 m return is refused by the int cast).
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _fq_checks (label text not null, passed boolean not null) on commit drop;
grant all on _fq_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _fq_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('e0fa6000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'e0fa6000-0000-4000-8000-a00000000004'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'e0fa6000-0000-4000-8000-100000000031'::uuid $$;

-- Runs p_sql as an admin through the API would: 'ok', the P0001 error text, or the SQLSTATE.
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

-- The same for an RPC returning jsonb; raises on error.
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

-- A line as buildBillItemsPayload makes it, ₹100 a unit. p_code is a manual item (no variant), or
-- null for the fixture variant.
create function pg_temp.line(p_code text, p_qty numeric, p_unit text default 'piece') returns jsonb
language sql as $$
  select jsonb_build_object('billid', null, 'quantity', p_qty, 'mrp', 100,
    'variantid', case when p_code is null then pg_temp.v1() end, 'product_name', 'FRQ item',
    'product_code', coalesce(p_code, 'FRQP1'), 'category', null, 'cost_price', 40,
    'alteration_charge', 0, 'discount_total', 0, 'subtotal', 100 * p_qty, 'gst_rate', null,
    'gst_amount', 0, 'total', 100 * p_qty, 'stitch_type', 'unstitched', 'unit_type', p_unit,
    'salesperson_id', null)
$$;

-- bill_save finalize_create, paid in full; returns the billid.
create function pg_temp.sell(p_key int, p_lines jsonb) returns int language sql as $$
  select (pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key), 'finalize_create',
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', -9731, 'notes', 'FRQ', 'document_type', 'bos',
        'totalamount', t.total, 'gst_total', 0, 'discount_total', 0, 'taxable_total', t.total,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', t.total,
        'net_amount', t.total, 'salesmethodid', -9731, 'orderdate', '2026-11-20T00:00:00+05:30'),
      'items', p_lines, 'skip_stock', false, 'first_payment', null))) ->> 'billid')::int
  from (select sum((l ->> 'total')::numeric) as total from jsonb_array_elements(p_lines) l) t
$$;

create function pg_temp.line_id(p_b int, p_code text) returns int language sql as $$
  select min(bill_item_id) from public.bill_items where billid = p_b and product_code = p_code
$$;
-- exchange_record for one line of bill p_b, as the Exchange page sends it.
create function pg_temp.ret(p_b int, p_code text, p_qty numeric, p_credit numeric) returns text language sql as $$
  select pg_temp.as_admin(format('select public.exchange_record(%s, -9731, %L)', p_b, jsonb_build_array(
    jsonb_build_object('bill_item_id', pg_temp.line_id(p_b, p_code), 'quantity', p_qty,
                       'credit_amount', p_credit, 'reason', 'FRQ', 'product_name', 'FRQ item',
                       'product_code', p_code))))
$$;
create function pg_temp.stock(p_code text) returns numeric language sql as $$
  select stock from public.manual_items where manual_item_id = p_code
$$;
create function pg_temp.vstock() returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = pg_temp.v1()
$$;
-- Quantity and credit already returned from the line.
create function pg_temp.returned(p_b int, p_code text) returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from public.exchanges where original_bill_item_id = pg_temp.line_id(p_b, p_code)
$$;
create function pg_temp.credited(p_b int, p_code text) returns numeric language sql as $$
  select coalesce(sum(credit_amount), 0) from public.exchanges where original_bill_item_id = pg_temp.line_id(p_b, p_code)
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'frq-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'frq-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9731, 'FRQFIXTURE0000000000000001', 'Fixture', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9731, 'FRQ cash');
  insert into public.categories (categoryid, name) values ('FRQ', 'FRQ fixture') on conflict do nothing;
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('FRQ') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('FRQ', 'FRQ', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('FRQP1', 'Fixture', 40, 100);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('FRQP1', 'FRQ', 'FRQ', 50, pg_temp.v1());
  insert into public.manual_items (manual_item_id, name, categoryid, stock) values
    ('FRQF01', 'Fabric whole', 'FRQ', 3.5), ('FRQF02', 'Fabric part', 'FRQ', 3.5),
    ('FRQF03', 'Fabric metre then rest', 'FRQ', 3.5), ('FRQF04', 'Fabric cancel', 'FRQ', 2.25),
    ('FRQF05', 'Fabric in a pair', 'FRQ', 1.5), ('FRQ001', 'Piece', 'FRQ', 3);
end $$;
grant select, insert, update, delete on public.bills, public.bill_payments, public.bill_items,
  public.exchanges, public.manual_items to authenticated;
grant usage on sequence public.bill_payments_payment_id_seq, public.orderitems_orderitemid_seq,
  public.returns_returnid_seq to authenticated;

-- ---------- 1. Column ----------
do $$
begin
  perform pg_temp.ok('1 exchanges.quantity is numeric(10,3)',
    (select data_type = 'numeric' and numeric_precision = 10 and numeric_scale = 3
       from information_schema.columns
      where table_schema = 'public' and table_name = 'exchanges' and column_name = 'quantity'));
  perform pg_temp.ok('1 exchange_record keeps its 4-argument signature and security definer',
    (select prosecdef from pg_proc
      where oid = to_regprocedure('public.exchange_record(integer, integer, jsonb, timestamp without time zone)')));
end $$;

-- ---------- 2. A 3.5 m line returned whole ----------
do $$
declare
  b int := pg_temp.sell(1, jsonb_build_array(pg_temp.line('FRQF01', 3.5, 'meter')));
begin
  perform pg_temp.ok('2 sold 3.5 m (3.5 -> 0)', pg_temp.stock('FRQF01') = 0);
  perform pg_temp.ok('2 credit above the line total is refused', pg_temp.ret(b, 'FRQF01', 3.5, 350.01) = 'EXCHANGE_OVER_LINE');
  perform pg_temp.ok('2 the whole 3.5 m with the line total as credit is accepted', pg_temp.ret(b, 'FRQF01', 3.5, 350) = 'ok');
  perform pg_temp.ok('2 the exchange row holds 3.5 and credit 350',
    pg_temp.returned(b, 'FRQF01') = 3.5 and pg_temp.credited(b, 'FRQF01') = 350);
  perform pg_temp.ok('2 the 3.5 m are back in stock (0 -> 3.5)', pg_temp.stock('FRQF01') = 3.5);
  perform pg_temp.ok('2 nothing more can be returned', pg_temp.ret(b, 'FRQF01', 1, 0) like 'item % already returned%');
end $$;

-- ---------- 3. Part of a length is refused, nothing written ----------
do $$
declare
  b int := pg_temp.sell(2, jsonb_build_array(pg_temp.line('FRQF02', 3.5, 'meter')));
begin
  perform pg_temp.ok('3 1.5 of 3.5 m is refused (EXCHANGE_WHOLE_LINE)', pg_temp.ret(b, 'FRQF02', 1.5, 150) = 'EXCHANGE_WHOLE_LINE');
  perform pg_temp.ok('3 3.4995 of 3.5 m is refused', pg_temp.ret(b, 'FRQF02', 3.4995, 349.95) = 'EXCHANGE_WHOLE_LINE');
  perform pg_temp.ok('3 3.5001 of 3.5 m is refused', pg_temp.ret(b, 'FRQF02', 3.5001, 350) <> 'ok');
  perform pg_temp.ok('3 no exchange row, no stock moved',
    pg_temp.returned(b, 'FRQF02') = 0 and pg_temp.stock('FRQF02') = 0);
  perform pg_temp.ok('3 zero is refused', pg_temp.ret(b, 'FRQF02', 0, 0) like 'item %: quantity must be positive');
end $$;

-- ---------- 4. Whole metres of a fractional line, then the rest whole ----------
do $$
declare
  b int := pg_temp.sell(3, jsonb_build_array(pg_temp.line('FRQF03', 3.5, 'meter')));
begin
  perform pg_temp.ok('4 1 whole metre of 3.5 m is accepted, as before', pg_temp.ret(b, 'FRQF03', 1, 100) = 'ok');
  perform pg_temp.ok('4 then 1.5 of the 2.5 m left is refused', pg_temp.ret(b, 'FRQF03', 1.5, 150) = 'EXCHANGE_WHOLE_LINE');
  perform pg_temp.ok('4 credit for the rest above the line total is refused', pg_temp.ret(b, 'FRQF03', 2.5, 250.01) = 'EXCHANGE_OVER_LINE');
  perform pg_temp.ok('4 the 2.5 m left is accepted', pg_temp.ret(b, 'FRQF03', 2.5, 250) = 'ok');
  perform pg_temp.ok('4 returned 3.5 m and ₹350 in all, stock back to 3.5',
    pg_temp.returned(b, 'FRQF03') = 3.5 and pg_temp.credited(b, 'FRQF03') = 350 and pg_temp.stock('FRQF03') = 3.5);
end $$;

-- ---------- 5. Piece lines: whole numbers exactly as before ----------
do $$
declare
  b int := pg_temp.sell(4, jsonb_build_array(pg_temp.line('FRQ001', 3)));
  bv int := pg_temp.sell(5, jsonb_build_array(pg_temp.line(null, 2)));
  v numeric := pg_temp.vstock();
begin
  perform pg_temp.ok('5 1.5 of 3 pieces is refused', pg_temp.ret(b, 'FRQ001', 1.5, 150) = 'EXCHANGE_WHOLE_LINE');
  perform pg_temp.ok('5 1 of 3 pieces is accepted', pg_temp.ret(b, 'FRQ001', 1, 100) = 'ok');
  perform pg_temp.ok('5 then 2 more accepted (3 of 3)', pg_temp.ret(b, 'FRQ001', 2, 200) = 'ok');
  perform pg_temp.ok('5 then 1 more refused', pg_temp.ret(b, 'FRQ001', 1, 0) like 'item % already returned%');
  perform pg_temp.ok('5 piece stock 0 -> 3', pg_temp.stock('FRQ001') = 3);
  perform pg_temp.ok('5 variant: 1 of 2 accepted and restocked', pg_temp.ret(bv, 'FRQP1', 1, 100) = 'ok' and pg_temp.vstock() = v + 1);
  perform pg_temp.ok('5 variant: 0.5 refused', pg_temp.ret(bv, 'FRQP1', 0.5, 50) = 'EXCHANGE_WHOLE_LINE');
end $$;

-- ---------- 6. A fractional variant line returned whole; a refusal undoes the whole call ----------
do $$
declare
  bv int := pg_temp.sell(6, jsonb_build_array(pg_temp.line(null, 2.5, 'meter')));
  b int := pg_temp.sell(7, jsonb_build_array(pg_temp.line('FRQF05', 1.5, 'meter'), pg_temp.line('FRQ001', 1)));
  v numeric := pg_temp.vstock();
  r text;
begin
  perform pg_temp.ok('6 variant 2.5 m returned whole and restocked',
    pg_temp.ret(bv, 'FRQP1', 2.5, 250) = 'ok' and pg_temp.vstock() = v + 2.5);
  -- Whole 1.5 m plus a piece over its cap: the 1.5 m is not kept either.
  r := pg_temp.as_admin(format('select public.exchange_record(%s, -9731, %L)', b, jsonb_build_array(
    jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'FRQF05'), 'quantity', 1.5, 'credit_amount', 150),
    jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'FRQ001'), 'quantity', 1, 'credit_amount', 100.01))));
  perform pg_temp.ok('6 the pair is refused at the piece', r = 'EXCHANGE_OVER_LINE');
  perform pg_temp.ok('6 and the 1.5 m was not recorded', pg_temp.returned(b, 'FRQF05') = 0 and pg_temp.stock('FRQF05') = 0);
  r := pg_temp.as_admin(format('select public.exchange_record(%s, -9731, %L)', b, jsonb_build_array(
    jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'FRQF05'), 'quantity', 1.5, 'credit_amount', 150),
    jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'FRQ001'), 'quantity', 1, 'credit_amount', 100))));
  perform pg_temp.ok('6 the pair at their caps is accepted (credit = what the bill holds)', r = 'ok');
  perform pg_temp.ok('6 1.5 m back', pg_temp.stock('FRQF05') = 1.5);
end $$;

-- ---------- 7. Cancel after a whole fractional return gives nothing more back ----------
do $$
declare
  b int := pg_temp.sell(8, jsonb_build_array(pg_temp.line('FRQF04', 2.25, 'meter')));
  r jsonb;
begin
  perform pg_temp.ok('7 2.25 m returned whole', pg_temp.ret(b, 'FRQF04', 2.25, 225) = 'ok');
  perform pg_temp.ok('7 stock back to 2.25', pg_temp.stock('FRQF04') = 2.25);
  r := pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(9), b, 'return_payment',
    (select jsonb_build_object('expect', jsonb_build_object('finalized', x.finalized, 'paymentstatus', x.paymentstatus))
       from public.bills x where x.billid = b)));
  perform pg_temp.ok('7 cancel does not give the 2.25 m back again', pg_temp.stock('FRQF04') = 2.25);
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _fq_checks;
rollback;
