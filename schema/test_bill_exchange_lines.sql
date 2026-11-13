-- Tests for schema/migration_bill_item_exchange_lock.sql and the exchange check in bill_edit
-- (schema/migration_bill_edit_excess.sql): exchange credit given from a bill's line is never paid
-- back a second time by editing the bill. The whole file is one transaction that always rolls
-- back, and its final select returns only pass and fail counts. A failed check also raises a
-- WARNING naming it.
-- Run locally (the bill migrations listed in schema/test_bill_excess_credit.sql, then):
--   scripts/test-db.sh sql schema/migration_bill_item_exchange_lock.sql \
--     schema/test_bill_exchange_lines.sql
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _xl_checks (label text not null, passed boolean not null) on commit drop;
grant all on _xl_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _xl_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('e0c11e00-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-100000000001'::uuid $$;
create function pg_temp.v2() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-100000000002'::uuid $$;

-- Runs p_sql as an admin through the API would. Returns 'ok', the P0001 error code, or the
-- SQLSTATE; an error undoes it.
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

-- A bill paid 1000 in one go with lines A (variant 1) and B (variant 2), 500 each; A has qty p_qty_a.
create function pg_temp.save(p_key int, p_qty_a int default 1) returns int language sql as $$
  select (pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key), 'finalize_create',
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', -9701, 'notes', 'XLINES', 'totalamount', 1000,
        'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000, 'paymentstatus', 'finalized',
        'finalized', true, 'payment_amount', 1000, 'net_amount', 1000, 'salesmethodid', -9701),
      'items', jsonb_build_array(
        jsonb_build_object('quantity', p_qty_a, 'mrp', 500 / p_qty_a, 'variantid', pg_temp.v1(),
          'product_name', 'A', 'product_code', 'XLP1', 'subtotal', 500, 'gst_amount', 0, 'total', 500),
        jsonb_build_object('quantity', 1, 'mrp', 500, 'variantid', pg_temp.v2(),
          'product_name', 'B', 'product_code', 'XLP2', 'subtotal', 500, 'gst_amount', 0, 'total', 500)))))
    ->> 'billid')::int
$$;

create function pg_temp.line(p_b int, p_name text) returns int language sql as $$
  select bill_item_id from public.bill_items where billid = p_b and product_name = p_name
$$;

-- In-store exchange of p_qty of a line for p_credit, as ExchangePage records it.
create function pg_temp.exchange(p_b int, p_line int, p_qty int, p_credit numeric) returns jsonb language sql as $$
  select pg_temp.rpc(format('select to_jsonb(public.exchange_record(%s, -9701, %L))', p_b,
    jsonb_build_array(jsonb_build_object('bill_item_id', p_line, 'quantity', p_qty,
                                         'credit_amount', p_credit, 'reason', 'XLINES'))))
$$;

-- bill_edit payload as BillingForm.handleSaveDraft sends it.
create function pg_temp.payload(p_b int, p_net numeric, p_excess jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'expect', jsonb_build_object('paymentstatus', b.paymentstatus, 'payment_amount', b.payment_amount),
    'bill', jsonb_build_object('customerid', -9701, 'notes', 'XLINES edit',
      'totalamount', p_net, 'gst_total', 0, 'discount_total', 0, 'taxable_total', p_net,
      'net_amount', p_net, 'applied_codes', '[]'::jsonb, 'payment_amount', b.payment_amount,
      'final_amount', null, 'saleslocationid', null, 'salesmethodid', -9701,
      'paymentstatus', 'finalized', 'finalized', true, 'store_credit_used', 0,
      'orderdate', '2026-11-12T00:00:00+05:30'),
    'excess', p_excess)
  from public.bills b where b.billid = p_b
$$;
create function pg_temp.edit_sql(p_key int, p_b int, p_payload jsonb) returns text language sql as $$
  select format('select public.bill_edit(%L, %s, %L)', pg_temp.k(p_key), p_b, p_payload)
$$;
create function pg_temp.cancel_sql(p_key int, p_b int) returns text language sql as $$
  select format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(p_key), p_b, 'store_credit',
    (select jsonb_build_object('expect', jsonb_build_object('finalized', b.finalized, 'paymentstatus', b.paymentstatus))
       from public.bills b where b.billid = p_b))
$$;

create function pg_temp.credit() returns numeric language sql as $$
  select round(store_credit::numeric, 2) from public.customers where customerid = -9701
$$;
create function pg_temp.held(p_b int) returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.bill_payments where billid = p_b
$$;
create function pg_temp.reset_credit() returns void language sql as $$
  update public.customers set store_credit = 0 where customerid = -9701
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'xlines-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'xlines-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9701, 'XLINESFIXTURE0000000000001', 'Fixture', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9701, 'XLINES cash');
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('XLINES') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('XLINES', 'XLINES', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values
    ('XLP1', 'Fixture A', 200, 500), ('XLP2', 'Fixture B', 200, 500);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('XLP1', 'XLINES', 'XLINES', 100, pg_temp.v1()), ('XLP2', 'XLINES', 'XLINES', 100, pg_temp.v2());
end $$;
-- What the live admin policies allow staff on these tables.
grant select, insert, update, delete on public.bills, public.bill_payments, public.bill_items,
  public.exchanges to authenticated;
grant usage on sequence public.bill_payments_payment_id_seq, public.orderitems_orderitemid_seq,
  public.returns_returnid_seq to authenticated;

-- ---------- 1. Hole A: the screen's delete-all-and-reinsert cannot drop an exchanged line ----------
-- Verifier repro: A exchanged for 500 credit, then the edit deletes every line, re-inserts B
-- only, and bill_edit puts 500 on store credit. Customer: 500 exchange + 500 credit for a 1000
-- bill keeping B, 500 more than paid.
do $$
declare
  b int := pg_temp.save(1);
  a int;
begin
  perform pg_temp.reset_credit();
  a := pg_temp.line(b, 'A');
  perform pg_temp.exchange(b, a, 1, 500);

  perform pg_temp.ok('1 deleting every line of a bill with an exchanged line refused',
    pg_temp.as_admin(format('delete from public.bill_items where billid = %s', b)) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('1 both lines and the exchange link remain',
    (select count(*) from public.bill_items where billid = b) = 2
    and exists (select 1 from public.exchanges where original_bill_item_id = a));
  -- The old screen's whole edit, as one request: delete every line, re-insert B, settle 500.
  perform pg_temp.ok('1 the old screen''s edit stops at its first step',
    pg_temp.as_admin(format('delete from public.bill_items where billid = %1$s; '
      'insert into public.bill_items (billid, quantity, mrp, variantid, product_name, subtotal, gst_amount, total) '
      'values (%1$s, 1, 500, %2$L, %3$L, 500, 0, 500); %4$s',
      b, pg_temp.v2(), 'B', pg_temp.edit_sql(2, b, pg_temp.payload(b, 500, '{"mode": "store_credit", "amount": 500}'))))
      = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('1 no store credit and the shop still holds 1000',
    pg_temp.credit() = 0 and pg_temp.held(b) = 0
    and (select payment_amount from public.bills where billid = b) = 1000);
end $$;

-- ---------- 2. returning the other line still works, and cancel pays out nothing twice ----------
do $$
declare
  b int := pg_temp.save(11);
  r jsonb;
begin
  perform pg_temp.reset_credit();
  perform pg_temp.exchange(b, pg_temp.line(b, 'A'), 1, 500);

  perform pg_temp.ok('2 deleting the line with no exchange is allowed',
    pg_temp.as_admin(format('delete from public.bill_items where bill_item_id = %s', pg_temp.line(b, 'B'))) = 'ok');
  r := pg_temp.rpc(pg_temp.edit_sql(12, b, pg_temp.payload(b, 500, '{"mode": "store_credit", "amount": 500}')));
  perform pg_temp.ok('2 B returned: 500 to store credit', (r -> 'excess' ->> 'amount')::numeric = 500
    and pg_temp.credit() = 500 and pg_temp.held(b) = 500);

  r := pg_temp.rpc(pg_temp.cancel_sql(13, b));
  perform pg_temp.ok('2 cancel refunds nothing more: held 500 less 500 exchange credit',
    (r ->> 'refund')::numeric = 0 and (r ->> 'exchange_credit_given')::numeric = 500
    and pg_temp.credit() = 500);
  perform pg_temp.ok('2 cancel leaves the exchanged line in place',
    exists (select 1 from public.bill_items where billid = b and product_name = 'A'));
end $$;

-- ---------- 3. an exchanged line's quantity, product and price are held ----------
do $$
declare
  b int := pg_temp.save(21, 2);
  b2 int := pg_temp.save(22);
  a int;
begin
  a := pg_temp.line(b, 'A');
  perform pg_temp.exchange(b, a, 1, 250);

  perform pg_temp.ok('3 quantity below the exchanged quantity refused',
    pg_temp.as_admin(format('update public.bill_items set quantity = 0 where bill_item_id = %s', a)) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('3 MRP change refused',
    pg_temp.as_admin(format('update public.bill_items set mrp = 100 where bill_item_id = %s', a)) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('3 variant change refused',
    pg_temp.as_admin(format('update public.bill_items set variantid = %L where bill_item_id = %s', pg_temp.v2(), a)) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('3 moving the line to another bill refused',
    pg_temp.as_admin(format('update public.bill_items set billid = %s where bill_item_id = %s', b2, a)) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('3 quantity down to the exchanged quantity allowed',
    pg_temp.as_admin(format('update public.bill_items set quantity = 1, total = 250, subtotal = 250 where bill_item_id = %s', a)) = 'ok');
  perform pg_temp.ok('3 discount and salesperson columns stay editable',
    pg_temp.as_admin(format('update public.bill_items set discount_total = 10, total = 240, salesperson_id = null where bill_item_id = %s', a)) = 'ok');
  perform pg_temp.ok('3 a further exchange still records', (pg_temp.exchange(b, pg_temp.line(b, 'B'), 1, 500)) is not null);
  perform pg_temp.ok('3 lines without exchanges stay fully editable',
    pg_temp.as_admin(format('update public.bill_items set quantity = 3, mrp = 400 where billid = %s', b2)) = 'ok');
end $$;

-- ---------- 4. bill_edit refuses an excess that counts exchanged items twice ----------
do $$
declare
  b int := pg_temp.save(31);
begin
  perform pg_temp.reset_credit();
  perform pg_temp.exchange(b, pg_temp.line(b, 'A'), 1, 500);
  perform pg_temp.as_admin(format('delete from public.bill_items where bill_item_id = %s', pg_temp.line(b, 'B')));

  -- A (500, already given back as exchange credit) stays; a discount takes the net to 300.
  perform pg_temp.ok('4 excess with net below the exchange credit given refused',
    pg_temp.as_admin(pg_temp.edit_sql(32, b, pg_temp.payload(b, 300, '{"mode": "store_credit", "amount": 700}')))
      = 'BILL_EXCHANGE_COUNTED');
  perform pg_temp.ok('4 nothing credited or recorded', pg_temp.credit() = 0 and pg_temp.held(b) = 0
    and (select net_amount from public.bills where billid = b) = 1000);
  perform pg_temp.ok('4 net equal to the exchange credit given is fine',
    pg_temp.as_admin(pg_temp.edit_sql(33, b, pg_temp.payload(b, 500, '{"mode": "store_credit", "amount": 500}'))) = 'ok'
    and pg_temp.credit() = 500);
end $$;

-- ---------- 5. L1: a negative net is refused ----------
do $$
declare
  b int := pg_temp.save(41);
begin
  perform pg_temp.reset_credit();
  perform pg_temp.ok('5 negative net refused',
    pg_temp.as_admin(pg_temp.edit_sql(42, b, pg_temp.payload(b, -5000, '{"mode": "store_credit", "amount": 6000}')))
      = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('5 no credit minted', pg_temp.credit() = 0 and pg_temp.held(b) = 0);
end $$;

-- ---------- 6. drafts: deleting a draft with no exchange still cascades its lines ----------
do $$
declare
  d int;
  r text;
begin
  insert into public.bills (customerid, paymentstatus, finalized, totalamount, net_amount)
  values (-9701, 'draft', false, 500, 500) returning billid into d;
  insert into public.bill_items (billid, quantity, mrp, variantid, product_name, subtotal, gst_amount, total)
  values (d, 1, 500, pg_temp.v1(), 'D', 500, 0, 500);
  r := pg_temp.as_admin(format('delete from public.bills where billid = %s', d));
  perform pg_temp.ok('6 draft with lines deleted', r = 'ok' and not exists (select 1 from public.bill_items where billid = d));
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _xl_checks;
rollback;
