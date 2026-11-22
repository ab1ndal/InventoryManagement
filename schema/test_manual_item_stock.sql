-- Tests for schema/migration_manual_item_stock.sql: billing a manual item (BCX…) takes its stock,
-- exactly (fabric by the metre), and a cancel, edit, finished draft or exchange gives it back.
-- The whole file is one transaction that always rolls back, and its final select returns only
-- pass and fail counts. A failed check also raises a WARNING naming it.
-- Run locally (the chain in tasks/manual-item-stock-plan.md section 6, then):
--   scripts/test-db.sh sql schema/migration_manual_item_stock.sql schema/test_manual_item_stock.sql
-- Before the migration it fails (stock never moves, and the new functions are missing).
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _mi_checks (label text not null, passed boolean not null) on commit drop;
grant all on _mi_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _mi_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('e0c11e00-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-a00000000003'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'e0c11e00-0000-4000-8000-100000000021'::uuid $$;

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

-- As a signed-in API user with no staff profile.
create function pg_temp.as_user(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
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

-- A line as buildBillItemsPayload makes it. p_code is a manual item (no variant), or null for the
-- fixture variant. p_unit 'meter' for fabric.
create function pg_temp.line(p_id int, p_code text, p_qty numeric, p_unit text default 'piece') returns jsonb
language sql as $$
  select jsonb_build_object('bill_item_id', p_id, 'billid', null, 'quantity', p_qty, 'mrp', 100,
    'variantid', case when p_code is null then pg_temp.v1() end, 'product_name', 'MIST item',
    'product_code', coalesce(p_code, 'MISTP1'), 'category', null, 'cost_price', 40,
    'alteration_charge', 0, 'discount_total', 0, 'subtotal', 100 * p_qty, 'gst_rate', null,
    'gst_amount', 0, 'total', 100 * p_qty, 'stitch_type', 'unstitched', 'unit_type', p_unit,
    'salesperson_id', null)
$$;

-- bill_save finalize_create (or partial_create with p_paid below the total), lines as given.
create function pg_temp.sell(p_key int, p_lines jsonb, p_skip boolean default false, p_paid numeric default null)
returns jsonb language sql as $$
  select pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key),
    case when p_paid is null then 'finalize_create' else 'partial_create' end,
    jsonb_build_object(
      'bill', jsonb_build_object('customerid', -9721, 'notes', 'MIST', 'document_type', 'bos',
        'totalamount', t.total, 'gst_total', 0, 'discount_total', 0, 'taxable_total', t.total,
        'paymentstatus', case when p_paid is null then 'finalized' else 'partial' end, 'finalized', true,
        'payment_amount', coalesce(p_paid, t.total), 'net_amount', t.total, 'salesmethodid', -9721,
        'orderdate', '2026-11-20T00:00:00+05:30'),
      'items', (select jsonb_agg(l - 'bill_item_id') from jsonb_array_elements(p_lines) l),
      'skip_stock', p_skip,
      'first_payment', case when p_paid is null then null
                            else jsonb_build_object('amount', p_paid, 'salesmethodid', -9721) end)))
  from (select sum((l ->> 'total')::numeric) as total from jsonb_array_elements(p_lines) l) t
$$;

-- bill_edit payload as BillingForm.handleSaveDraft sends it.
create function pg_temp.edit(p_key int, p_b int, p_lines jsonb) returns jsonb language sql as $$
  select pg_temp.rpc(format('select public.bill_edit(%L, %s, %L)', pg_temp.k(p_key), p_b,
    jsonb_build_object(
      'expect', jsonb_build_object('paymentstatus', b.paymentstatus, 'payment_amount', b.payment_amount),
      'bill', jsonb_build_object('customerid', b.customerid, 'notes', 'MIST edit',
        'totalamount', t.total, 'gst_total', 0, 'discount_total', 0, 'taxable_total', t.total,
        'net_amount', t.total, 'applied_codes', '[]'::jsonb, 'payment_amount', b.payment_amount,
        'final_amount', null, 'saleslocationid', null, 'salesmethodid', -9721,
        'paymentstatus', b.paymentstatus, 'finalized', b.finalized,
        'store_credit_used', b.store_credit_used, 'orderdate', '2026-11-20T00:00:00+05:30'),
      'items', p_lines, 'salesperson_ids', '[]'::jsonb, 'skip_stock', b.stock_reduced is false,
      'excess', null)))
  from public.bills b,
       (select sum((l ->> 'total')::numeric) as total from jsonb_array_elements(p_lines) l) t
  where b.billid = p_b
$$;

-- bill_save finalize_draft with the given lines, paid in full.
create function pg_temp.finish(p_key int, p_b int, p_lines jsonb) returns jsonb language sql as $$
  select pg_temp.rpc(format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key), 'finalize_draft',
    jsonb_build_object(
      'billid', p_b,
      'expect', jsonb_build_object('paymentstatus', b.paymentstatus, 'payment_amount', b.payment_amount),
      'bill', jsonb_build_object('customerid', -9721, 'notes', 'MIST finished', 'totalamount', t.total,
        'gst_total', 0, 'discount_total', 0, 'taxable_total', t.total, 'paymentstatus', 'finalized',
        'finalized', true, 'applied_codes', '[]'::jsonb, 'payment_amount', t.total,
        'store_credit_used', 0, 'exchange_credit_used', 0, 'exchange_source_bill', null,
        'saleslocationid', null, 'salesmethodid', -9721, 'orderdate', '2026-11-20T00:00:00+05:30'),
      'items', p_lines, 'salesperson_ids', '[]'::jsonb, 'skip_stock', false, 'voucher_id', null,
      'exchange_ids', '[]'::jsonb, 'discount_codes', '[]'::jsonb)))
  from public.bills b,
       (select sum((l ->> 'total')::numeric) as total from jsonb_array_elements(p_lines) l) t
  where b.billid = p_b
$$;

-- A draft as the screen's Save Draft makes one: bill row and lines inserted directly, then the
-- manual item's stock taken through manual_item_stock_adjust (reason bill_draft_create).
create function pg_temp.draft(p_code text, p_qty numeric) returns int language plpgsql as $$
declare
  b int;
begin
  insert into public.bills (customerid, notes, document_type, totalamount, gst_total, discount_total,
                            taxable_total, paymentstatus, finalized, applied_codes, payment_amount,
                            salesmethodid, orderdate, stock_reduced)
  values (-9721, 'MIST draft', 'bos', 100 * p_qty, 0, 0, 100 * p_qty, 'draft', false, '{}', null,
          -9721, '2026-11-20', true)
  returning billid into b;
  insert into public.bill_items (billid, quantity, mrp, product_name, product_code, subtotal, gst_amount,
                                 total, unit_type)
  values (b, p_qty, 100, 'MIST item', p_code, 100 * p_qty, 0, 100 * p_qty, 'meter');
  if pg_temp.as_admin(format('select public.manual_item_stock_adjust(%L, %s, %L, %L)',
                             p_code, -p_qty, 'bill_draft_create', b)) <> 'ok' then
    raise exception 'draft fixture: manual_item_stock_adjust failed';
  end if;
  return b;
end $$;

create function pg_temp.cancel(p_key int, p_b int, p_options jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(p_key), p_b,
    'return_payment',
    (select jsonb_build_object('expect', jsonb_build_object('finalized', b.finalized, 'paymentstatus', b.paymentstatus))
       from public.bills b where b.billid = p_b) || p_options))
$$;

create function pg_temp.stock(p_code text) returns numeric language sql as $$
  select stock from public.manual_items where manual_item_id = p_code
$$;
create function pg_temp.vstock() returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = pg_temp.v1()
$$;
create function pg_temp.line_id(p_b int, p_code text) returns int language sql as $$
  select min(bill_item_id) from public.bill_items where billid = p_b and product_code = p_code
$$;
create function pg_temp.saved(p_b int, p_code text, p_qty numeric, p_unit text default 'piece') returns jsonb
language sql as $$
  select pg_temp.line(pg_temp.line_id(p_b, p_code), p_code, p_qty, p_unit)
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'mist-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'mist-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9721, 'MISTFIXTURE000000000000001', 'Fixture', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9721, 'MIST cash');
  insert into public.categories (categoryid, name) values ('MIST', 'MIST fixture') on conflict do nothing;
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('MIST') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('MIST', 'MIST', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('MISTP1', 'Fixture', 40, 100);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('MISTP1', 'MIST', 'MIST', 50, pg_temp.v1());
  -- Piece items start at 1 (the column default), fabric in metres.
  insert into public.manual_items (manual_item_id, name, categoryid) values
    ('MIST001', 'Piece sold', 'MIST'), ('MIST002', 'Piece twice', 'MIST'),
    ('MIST003', 'Piece no stock', 'MIST'), ('MIST004', 'Piece cancel', 'MIST'),
    ('MIST005', 'Piece exchange', 'MIST'), ('MIST006', 'Piece legacy', 'MIST'),
    ('MIST007', 'Piece partial', 'MIST');
  insert into public.manual_items (manual_item_id, name, categoryid, stock) values
    ('MISTF01', 'Fabric sold', 'MIST', 5), ('MISTF02', 'Fabric edit', 'MIST', 10),
    ('MISTF03', 'Fabric draft', 'MIST', 10), ('MISTF04', 'Fabric exchange', 'MIST', 10),
    ('MIST008', 'Piece three', 'MIST', 3);
end $$;
grant select, insert, update, delete on public.bills, public.bill_payments, public.bill_items,
  public.exchanges, public.manual_items to authenticated;
grant usage on sequence public.bill_payments_payment_id_seq, public.orderitems_orderitemid_seq,
  public.returns_returnid_seq to authenticated;

-- ---------- 1. Column and functions ----------
do $$
begin
  perform pg_temp.ok('1 stock is numeric(10,3), not null, default 1',
    (select data_type = 'numeric' and numeric_precision = 10 and numeric_scale = 3 and is_nullable = 'NO'
            and column_default like '1%'
       from information_schema.columns
      where table_schema = 'public' and table_name = 'manual_items' and column_name = 'stock'));
  perform pg_temp.ok('1 _manual_stock_apply is internal (no authenticated, anon or public execute)',
    to_regprocedure('public._manual_stock_apply(text, numeric)') is not null
    and not has_function_privilege('authenticated', 'public._manual_stock_apply(text, numeric)', 'execute')
    and not has_function_privilege('anon', 'public._manual_stock_apply(text, numeric)', 'execute'));
  perform pg_temp.ok('1 manual_item_stock_adjust: authenticated may execute, anon may not',
    to_regprocedure('public.manual_item_stock_adjust(text, numeric, text, text)') is not null
    and has_function_privilege('authenticated', 'public.manual_item_stock_adjust(text, numeric, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.manual_item_stock_adjust(text, numeric, text, text)', 'execute'));
end $$;

-- ---------- 2. A sale takes the exact quantity ----------
do $$
declare
  r jsonb;
  v numeric := pg_temp.vstock();
begin
  r := pg_temp.sell(1, jsonb_build_array(pg_temp.line(null, 'MIST001', 1), pg_temp.line(null, 'MISTF01', 3.5, 'meter'),
                                         pg_temp.line(null, null, 2), pg_temp.line(null, 'SHIPPING', 1)));
  perform pg_temp.ok('2 piece item 1 -> 0', pg_temp.stock('MIST001') = 0);
  perform pg_temp.ok('2 fabric 5 m less 3.5 m -> 1.5 m, not rounded', pg_temp.stock('MISTF01') = 1.5);
  perform pg_temp.ok('2 the variant line moves as before', pg_temp.vstock() = v - 2);
  perform pg_temp.ok('2 a line whose code is no manual item is saved and moves nothing',
    exists (select 1 from public.bill_items where billid = (r ->> 'billid')::int and product_code = 'SHIPPING'));
  perform pg_temp.ok('2 nothing below 0, so negative_stock is empty', r -> 'negative_stock' = '[]'::jsonb);

  -- Two lines of the same item are summed; below 0 is allowed and reported, as for a variant.
  r := pg_temp.sell(2, jsonb_build_array(pg_temp.line(null, 'MIST002', 1), pg_temp.line(null, 'MIST002', 1)));
  perform pg_temp.ok('2 two lines of one item take 2 (1 -> -1)', pg_temp.stock('MIST002') = -1);
  perform pg_temp.ok('2 negative_stock names the manual item',
    r -> 'negative_stock' = jsonb_build_array(jsonb_build_object('manual_item_id', 'MIST002', 'stock', -1.000)));

  -- "Don't reduce stock" (backdated): nothing moves.
  r := pg_temp.sell(3, jsonb_build_array(pg_temp.line(null, 'MIST003', 1)), true);
  perform pg_temp.ok('2 skip_stock leaves the item at 1', pg_temp.stock('MIST003') = 1);

  -- A part-paid bill takes stock the same way.
  r := pg_temp.sell(4, jsonb_build_array(pg_temp.line(null, 'MIST007', 1)), false, 50);
  perform pg_temp.ok('2 partial_create takes stock too', pg_temp.stock('MIST007') = 0);
end $$;

-- ---------- 3. manual_item_stock_adjust (the new-draft path) ----------
do $$
begin
  perform pg_temp.ok('3 a non-staff user is refused',
    pg_temp.as_user($q$select public.manual_item_stock_adjust('MISTF03', -1, 'bill_draft_create', '1')$q$) = '42501');
  perform pg_temp.ok('3 an unknown id is an error and changes nothing',
    pg_temp.as_admin($q$select public.manual_item_stock_adjust('MISTNONE', -1, 'bill_draft_create', '1')$q$)
      like '%manual item MISTNONE not found%');
  perform pg_temp.ok('3 a direct _manual_stock_apply call is refused for staff',
    pg_temp.as_admin($q$select public._manual_stock_apply('MISTF03', -1)$q$) = '42501');
  perform pg_temp.ok('3 fabric draft stock untouched so far', pg_temp.stock('MISTF03') = 10);
end $$;

-- ---------- 4. A draft takes stock when saved; finishing it moves only the difference ----------
do $$
declare
  b int := pg_temp.draft('MISTF03', 3.5);
begin
  perform pg_temp.ok('4 the draft took 3.5 m (10 -> 6.5)', pg_temp.stock('MISTF03') = 6.5);
  perform pg_temp.finish(5, b, jsonb_build_array(pg_temp.saved(b, 'MISTF03', 2.25, 'meter')));
  perform pg_temp.ok('4 finished at 2.25 m: 1.25 m back (6.5 -> 7.75)', pg_temp.stock('MISTF03') = 7.75);
  perform pg_temp.ok('4 the bill is finalized', (select paymentstatus from public.bills where billid = b) = 'finalized');
end $$;

-- ---------- 5. bill_edit moves the difference; a line taken off gives its quantity back ----------
do $$
declare
  b int := (pg_temp.sell(6, jsonb_build_array(pg_temp.line(null, 'MISTF02', 3.5, 'meter'),
                                              pg_temp.line(null, null, 1))) ->> 'billid')::int;
  r jsonb;
begin
  perform pg_temp.ok('5 sold 3.5 m (10 -> 6.5)', pg_temp.stock('MISTF02') = 6.5);
  -- The screen's Save Changes on a paid bill: quantity up by 0.75 m, total unchanged (no excess).
  r := pg_temp.edit(7, b, jsonb_build_array(
         pg_temp.saved(b, 'MISTF02', 4.25, 'meter') || jsonb_build_object('subtotal', 350, 'total', 350),
         pg_temp.saved(b, null, 1) || jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'MISTP1'))));
  perform pg_temp.ok('5 up 0.75 m (6.5 -> 5.75)', pg_temp.stock('MISTF02') = 5.75);
  -- A line that leaves product_code out keeps its saved item and moves nothing.
  r := pg_temp.edit(8, b, jsonb_build_array(
         (pg_temp.saved(b, 'MISTF02', 4.25, 'meter') || jsonb_build_object('subtotal', 350, 'total', 350)) - 'product_code',
         pg_temp.saved(b, null, 1) || jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'MISTP1'))));
  perform pg_temp.ok('5 product_code left out: no move', pg_temp.stock('MISTF02') = 5.75);
  -- The fabric line taken off: all 4.25 m back.
  r := pg_temp.edit(9, b, jsonb_build_array(
         pg_temp.saved(b, null, 1) || jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'MISTP1'),
                                                          'subtotal', 450, 'total', 450)));
  perform pg_temp.ok('5 line taken off: 4.25 m back (5.75 -> 10)', pg_temp.stock('MISTF02') = 10);
end $$;

-- ---------- 6. A bill saved with "Don't reduce stock": edits and cancel move nothing ----------
do $$
declare
  b int;
begin
  update public.manual_items set stock = 1 where manual_item_id = 'MIST003';
  b := (pg_temp.sell(10, jsonb_build_array(pg_temp.line(null, 'MIST003', 1)), true) ->> 'billid')::int;
  perform pg_temp.edit(11, b, jsonb_build_array(pg_temp.saved(b, 'MIST003', 2) || jsonb_build_object('subtotal', 100, 'total', 100)));
  perform pg_temp.ok('6 edit of a no-stock bill moves nothing', pg_temp.stock('MIST003') = 1);
  perform pg_temp.cancel(12, b);
  perform pg_temp.ok('6 cancel of a no-stock bill gives nothing back', pg_temp.stock('MIST003') = 1);
end $$;

-- ---------- 7. Exchange puts the returned quantity back; cancel gives back the rest ----------
do $$
declare
  b int := (pg_temp.sell(13, jsonb_build_array(pg_temp.line(null, 'MIST008', 3))) ->> 'billid')::int;
  bf int := (pg_temp.sell(14, jsonb_build_array(pg_temp.line(null, 'MISTF04', 3.5, 'meter'))) ->> 'billid')::int;
  r jsonb;
begin
  perform pg_temp.ok('7 sold 3 pieces (3 -> 0)', pg_temp.stock('MIST008') = 0);
  -- As the Exchange page sends it after this change: no manual_item_id; the line names the item.
  perform pg_temp.ok('7 exchange of 1 piece accepted',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9721, %L)', b, jsonb_build_array(
      jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'MIST008'), 'quantity', 1, 'credit_amount', 100,
                         'reason', 'MIST', 'product_name', 'MIST item', 'product_code', 'MIST008')))) = 'ok');
  perform pg_temp.ok('7 the returned piece is back (0 -> 1)', pg_temp.stock('MIST008') = 1);
  -- A manual_item_id naming another item is not read.
  perform pg_temp.ok('7 a second exchange naming another item accepted',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9721, %L)', b, jsonb_build_array(
      jsonb_build_object('bill_item_id', pg_temp.line_id(b, 'MIST008'), 'quantity', 1, 'credit_amount', 100,
                         'manual_item_id', 'MIST001')))) = 'ok');
  perform pg_temp.ok('7 the line''s own item is restocked (1 -> 2), not the one named',
    pg_temp.stock('MIST008') = 2 and pg_temp.stock('MIST001') = 0);
  -- Part of a metre line cannot be returned; the whole line can
  -- (schema/migration_exchange_fractional_qty.sql).
  perform pg_temp.ok('7 a 1.5 m return is refused',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9721, %L)', bf, jsonb_build_array(
      jsonb_build_object('bill_item_id', pg_temp.line_id(bf, 'MISTF04'), 'quantity', 1.5, 'credit_amount', 100)))) <> 'ok');
  perform pg_temp.ok('7 the whole 3.5 m return is accepted',
    pg_temp.as_admin(format('select public.exchange_record(%s, -9721, %L)', bf, jsonb_build_array(
      jsonb_build_object('bill_item_id', pg_temp.line_id(bf, 'MISTF04'), 'quantity', 3.5, 'credit_amount', 350)))) = 'ok');
  perform pg_temp.ok('7 fabric 6.5 + 3.5 = 10 m', pg_temp.stock('MISTF04') = 10);

  -- Cancel: 3 sold, 2 exchanged, so 1 more comes back.
  r := pg_temp.cancel(15, b);
  perform pg_temp.ok('7 cancel gives back only the piece not exchanged (2 -> 3)', pg_temp.stock('MIST008') = 3);
  perform pg_temp.ok('7 cancel result lists the manual item',
    r -> 'stock' @> jsonb_build_array(jsonb_build_object('manual_item_id', 'MIST008', 'qty', 1.000)));
  r := pg_temp.cancel(16, bf);
  perform pg_temp.ok('7 fabric cancel gives nothing more back (all 3.5 m exchanged; stays 10)', pg_temp.stock('MISTF04') = 10);
end $$;

-- ---------- 8. Cancel of a plain sale, a draft, and a legacy bill ----------
do $$
declare
  b int := (pg_temp.sell(17, jsonb_build_array(pg_temp.line(null, 'MIST004', 1), pg_temp.line(null, null, 1))) ->> 'billid')::int;
  d int;
  l int;
  v numeric;
begin
  perform pg_temp.ok('8 sold (1 -> 0)', pg_temp.stock('MIST004') = 0);
  v := pg_temp.vstock();
  perform pg_temp.cancel(18, b);
  perform pg_temp.ok('8 cancel gives the piece back (0 -> 1)', pg_temp.stock('MIST004') = 1);
  perform pg_temp.ok('8 and the variant as before', pg_temp.vstock() = v + 1);

  d := pg_temp.draft('MISTF03', 1.75);
  perform pg_temp.ok('8 a draft took 1.75 m (7.75 -> 6)', pg_temp.stock('MISTF03') = 6);
  perform pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(19), d, 'draft',
    jsonb_build_object('expect', jsonb_build_object('finalized', false, 'paymentstatus', 'draft'))));
  perform pg_temp.ok('8 cancelling the draft gives it back (6 -> 7.75)', pg_temp.stock('MISTF03') = 7.75);

  -- A bill from before stock_reduced (null, no moves): as for variants, only restore_older_stock
  -- gives stock back.
  l := (pg_temp.sell(20, jsonb_build_array(pg_temp.line(null, 'MIST006', 1))) ->> 'billid')::int;
  update public.bills set stock_reduced = null where billid = l;
  delete from public.bill_stock_moves where billid = l;
  perform pg_temp.cancel(21, l);
  perform pg_temp.ok('8 legacy bill without restore_older_stock: nothing back', pg_temp.stock('MIST006') = 0);
  l := (pg_temp.sell(22, jsonb_build_array(pg_temp.line(null, 'MIST006', 1))) ->> 'billid')::int;
  update public.bills set stock_reduced = null where billid = l;
  delete from public.bill_stock_moves where billid = l;
  perform pg_temp.cancel(23, l, jsonb_build_object('restore_older_stock', true));
  perform pg_temp.ok('8 legacy bill with restore_older_stock: back (-1 -> 0)', pg_temp.stock('MIST006') = 0);
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _mi_checks;
rollback;
