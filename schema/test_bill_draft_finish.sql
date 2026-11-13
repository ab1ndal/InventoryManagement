-- Tests for schema/migration_bill_save_drafts.sql (bill_save finalize_draft and partial_draft) and
-- the later steps that finish a saved bill in one transaction. The whole file is one transaction
-- that always rolls back, and its final select returns only pass and fail counts. A failed check
-- also raises a WARNING naming it.
-- Run locally: every bill migration in schema/test_bill_excess_credit.sql's list, then
-- schema/migration_bill_item_exchange_lock.sql, schema/migration_exchange_record_caps.sql,
-- schema/migration_voucher_states.sql, schema/migration_bill_save_drafts.sql, then this file.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create temp table _df_checks (label text not null, passed boolean not null) on commit drop;
grant all on _df_checks to authenticated;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _df_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

create function pg_temp.k(p_n int) returns uuid language sql as $$
  select ('d4af0000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
create function pg_temp.admin_id() returns uuid language sql as $$ select 'd4af0000-0000-4000-8000-a00000000001'::uuid $$;
create function pg_temp.v1() returns uuid language sql as $$ select 'd4af0000-0000-4000-8000-100000000001'::uuid $$;
create function pg_temp.v2() returns uuid language sql as $$ select 'd4af0000-0000-4000-8000-100000000002'::uuid $$;

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

create function pg_temp.save_sql(p_key int, p_op text, p_payload jsonb) returns text language sql as $$
  select format('select public.bill_save(%L, %L, %L)', pg_temp.k(p_key), p_op, p_payload)
$$;

-- A line as buildBillItemsPayload makes it; p_id is the saved bill_item_id, or null for a new one.
create function pg_temp.line(p_id int, p_v uuid, p_qty numeric, p_total numeric default 1000) returns jsonb language sql as $$
  select jsonb_build_object('bill_item_id', p_id, 'billid', null, 'quantity', p_qty, 'mrp', 1000,
    'variantid', p_v, 'product_name', 'DFIN item', 'product_code', 'DFP1', 'category', null,
    'cost_price', 400, 'alteration_charge', 0, 'discount_total', 0, 'subtotal', p_total,
    'gst_rate', null, 'gst_amount', 0, 'total', p_total, 'stitch_type', 'unstitched',
    'unit_type', 'piece', 'salesperson_id', null)
$$;

-- A draft as the screen's Save Draft makes one: bill row, one line, stock taken (no moves rows).
create function pg_temp.draft(p_customer int, p_qty numeric default 1, p_stock_reduced boolean default true)
returns int language plpgsql as $$
declare
  b int;
begin
  insert into public.bills (customerid, notes, document_type, totalamount, gst_total, discount_total,
                            taxable_total, paymentstatus, finalized, applied_codes, payment_amount,
                            saleslocationid, salesmethodid, orderdate, stock_reduced)
  values (p_customer, 'DFIN draft', 'bos', 1000 * p_qty, 0, 0, 1000 * p_qty, 'draft', false, '{}', null,
          null, -9701, '2026-11-12', p_stock_reduced)
  returning billid into b;
  insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code,
                                 subtotal, gst_amount, total)
  values (b, p_qty, 1000, pg_temp.v1(), 'DFIN item', 'DFP1', 1000 * p_qty, 0, 1000 * p_qty);
  if p_stock_reduced then
    perform public._stock_apply(pg_temp.v1(), -p_qty);
  end if;
  return b;
end $$;

create function pg_temp.line_id(p_b int) returns int language sql as $$
  select min(bill_item_id) from public.bill_items where billid = p_b
$$;

-- finalize_draft / partial_draft payload as BillingForm sends it.
create function pg_temp.finish(p_b int, p_status text, p_items jsonb, p_extra jsonb default '{}',
                               p_bill jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'billid', p_b,
    'expect', (select jsonb_build_object('paymentstatus', b.paymentstatus, 'payment_amount', b.payment_amount)
                 from public.bills b where b.billid = p_b),
    'bill', jsonb_build_object('customerid', -9701, 'notes', 'DFIN finished', 'totalamount', 1000,
      'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000, 'paymentstatus', p_status,
      'finalized', true, 'applied_codes', '[]'::jsonb, 'payment_amount', 1000,
      'store_credit_used', 0, 'exchange_credit_used', 0, 'exchange_source_bill', null,
      'saleslocationid', null, 'salesmethodid', -9701, 'orderdate', '2026-11-12T00:00:00+05:30') || p_bill,
    'items', p_items, 'salesperson_ids', '[]'::jsonb, 'skip_stock', false, 'voucher_id', null,
    'exchange_ids', '[]'::jsonb, 'discount_codes', '[]'::jsonb) || p_extra
$$;

create function pg_temp.stock(p_v uuid) returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = p_v
$$;
create function pg_temp.credit(p_c int) returns numeric language sql as $$
  select round(store_credit::numeric, 2) from public.customers where customerid = p_c
$$;
create function pg_temp.bill(p_b int) returns public.bills language sql as $$
  select * from public.bills where billid = p_b
$$;


-- A new finalized bill from bill_save (it records stock moves), paid in one go.
create function pg_temp.sold(p_key int, p_qty numeric default 1, p_paid numeric default 1000,
                             p_extra jsonb default '{}', p_bill jsonb default '{}') returns int language sql as $$
  select (pg_temp.rpc(pg_temp.save_sql(p_key, 'finalize_create', jsonb_build_object(
    'bill', jsonb_build_object('customerid', -9701, 'notes', 'DFIN sold', 'totalamount', 1000 * p_qty,
      'gst_total', 0, 'discount_total', 0, 'taxable_total', 1000 * p_qty, 'paymentstatus', 'finalized',
      'finalized', true, 'payment_amount', p_paid, 'net_amount', 1000 * p_qty, 'salesmethodid', -9701,
      'orderdate', '2026-11-12T00:00:00+05:30') || p_bill,
    'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), p_qty, 1000 * p_qty) - 'bill_item_id')) || p_extra))
    ->> 'billid')::int
$$;

-- bill_edit payload as BillingForm.handleSaveDraft sends it.
create function pg_temp.edit(p_b int, p_net numeric, p_items jsonb, p_extra jsonb default '{}',
                             p_bill jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'expect', (select jsonb_build_object('paymentstatus', b.paymentstatus, 'payment_amount', b.payment_amount)
                 from public.bills b where b.billid = p_b),
    'bill', (select jsonb_build_object('customerid', b.customerid, 'notes', 'DFIN edit',
               'totalamount', p_net, 'gst_total', 0, 'discount_total', 0, 'taxable_total', p_net,
               'net_amount', p_net, 'applied_codes', '[]'::jsonb, 'payment_amount', b.payment_amount,
               'final_amount', null, 'saleslocationid', null, 'salesmethodid', -9701,
               'paymentstatus', b.paymentstatus, 'finalized', b.finalized,
               'store_credit_used', b.store_credit_used, 'orderdate', '2026-11-12T00:00:00+05:30')
             from public.bills b where b.billid = p_b) || p_bill,
    'items', p_items, 'salesperson_ids', '[]'::jsonb, 'skip_stock', false, 'excess', null) || p_extra
$$;
create function pg_temp.edit_sql(p_key int, p_b int, p_payload jsonb) returns text language sql as $$
  select format('select public.bill_edit(%L, %s, %L)', pg_temp.k(p_key), p_b, p_payload)
$$;
create function pg_temp.lines(p_b int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(variantid, quantity) order by bill_item_id), '[]'::jsonb)
    from public.bill_items where billid = p_b
$$;

-- ---------- fixtures: all created here, gone at rollback ----------
do $$
declare
  b int;
begin
  insert into auth.users (id, email) values (pg_temp.admin_id(), 'dfin-admin@example.invalid');
  insert into public.profiles (id, email, role, is_active)
  values (pg_temp.admin_id(), 'dfin-admin@example.invalid', 'admin', true)
  on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
  insert into public.customers (customerid, customer_ulid, first_name, store_credit) values
    (-9701, 'DFINFIXTURE000000000000001', 'Fixture', 500),
    (-9702, 'DFINFIXTURE000000000000002', 'Other', 0);
  insert into public.salesmethods (salesmethodid, methodname) values (-9701, 'DFIN cash');
  insert into public.salespersons (salesperson_id, name) values (-9701, 'DFIN person');
  insert into public.discounts (code, type, value) values ('DFIN-TEST', 'flat', 10);
  if to_regclass('public.colors') is not null then
    execute $q$insert into public.colors (code) values ('DFIN'), ('DFIN2') on conflict do nothing$q$;
  end if;
  if to_regclass('public.sizes') is not null then
    execute $q$insert into public.sizes (code, label, size_type, sort_order) values ('DFIN', 'DFIN', 'special', 0)
                on conflict do nothing$q$;
  end if;
  insert into public.products (productid, name, purchaseprice, retailprice) values ('DFP1', 'Fixture', 400, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values
    ('DFP1', 'DFIN', 'DFIN', 100, pg_temp.v1()), ('DFP1', 'DFIN', 'DFIN2', 100, pg_temp.v2());
  insert into public.vouchers (voucher_id, customerid, expiry_date, value) values
    ('DFIN-V', -9701, current_date + 30, 100), ('DFIN-USED', -9701, current_date + 30, 100);
  insert into public.bills (paymentstatus, finalized, notes) values ('finalized', true, 'DFIN fixture')
    returning billid into b;
  perform public.voucher_redeem('DFIN-USED', b);
  insert into public.exchanges (exchangeid, quantity, customerid, credit_amount, new_billid) values
    (-9701, 1, -9701, 300, null), (-9702, 1, -9702, 200, null), (-9703, 1, null, 50, null),
    (-9704, 1, -9701, 100, b), (-9705, 1, -9701, 100, null), (-9706, 1, -9701, 100, null);
end $$;

-- ---------- 1. finalize_draft: lines, stock, voucher, exchange, credit, usage, in one go ----------
do $$
declare
  b int := pg_temp.draft(-9701, 1);
  li int := pg_temp.line_id(b);
  s1 numeric := pg_temp.stock(pg_temp.v1());
  s2 numeric := pg_temp.stock(pg_temp.v2());
  p jsonb;
  r jsonb;
begin
  p := pg_temp.finish(b, 'finalized',
    jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 2, 2000), pg_temp.line(null, pg_temp.v2(), 1)),
    jsonb_build_object('voucher_id', 'DFIN-V', 'exchange_ids', '[-9701]'::jsonb,
                       'salesperson_ids', '[-9701]'::jsonb, 'discount_codes', '["DFIN-TEST"]'::jsonb),
    '{"totalamount": 3000, "store_credit_used": 100, "exchange_credit_used": 300, "payment_amount": 2500}');
  r := pg_temp.rpc(pg_temp.save_sql(1, 'finalize_draft', p));
  perform pg_temp.ok('1 result names the bill', (r ->> 'billid')::int = b and r ->> 'op' = 'finalize_draft'
    and r ->> 'bill_number' = (pg_temp.bill(b)).bill_number and not (r ->> 'replayed')::boolean);
  perform pg_temp.ok('1 bill finalized with the screen''s figures', (pg_temp.bill(b)).paymentstatus = 'finalized'
    and (pg_temp.bill(b)).finalized and (pg_temp.bill(b)).payment_amount = 2500
    and (pg_temp.bill(b)).totalamount = 3000 and (pg_temp.bill(b)).notes = 'DFIN finished');
  perform pg_temp.ok('1 exchange credit used is written', (pg_temp.bill(b)).exchange_credit_used = 300);
  perform pg_temp.ok('1 exchange linked to the bill', (select new_billid from public.exchanges where exchangeid = -9701) = b);
  perform pg_temp.ok('1 voucher redeemed on the bill', (select redeemed and redeemed_billid = b
    from public.vouchers where voucher_id = 'DFIN-V'));
  perform pg_temp.ok('1 saved line kept its id and took the new quantity',
    (select quantity from public.bill_items where bill_item_id = li and billid = b) = 2);
  perform pg_temp.ok('1 new line inserted', (select count(*) from public.bill_items where billid = b) = 2
    and exists (select 1 from public.bill_items where billid = b and variantid = pg_temp.v2()));
  perform pg_temp.ok('1 stock moved by the change only', pg_temp.stock(pg_temp.v1()) = s1 - 1
    and pg_temp.stock(pg_temp.v2()) = s2 - 1);
  perform pg_temp.ok('1 no stock moves rows on a screen draft',
    not exists (select 1 from public.bill_stock_moves where billid = b));
  perform pg_temp.ok('1 store credit taken once', pg_temp.credit(-9701) = 400 and (
    select count(*) from public.store_credit_ledger where customerid = -9701 and ref_id = b::text
       and reason = 'bill_finalize' and delta = -100) = 1);
  perform pg_temp.ok('1 discount use recorded', (select count(*) from public.discount_usage
    where billid = b and code = 'DFIN-TEST' and customerid = -9701) = 1);
  perform pg_temp.ok('1 salesperson recorded', (select count(*) from public.bill_salespersons
    where billid = b and salesperson_id = -9701) = 1);

  -- A lost response: the same request replays and writes nothing.
  r := pg_temp.rpc(pg_temp.save_sql(1, 'finalize_draft', p));
  perform pg_temp.ok('1 replay', (r ->> 'replayed')::boolean and pg_temp.credit(-9701) = 400
    and pg_temp.stock(pg_temp.v1()) = s1 - 1);
  -- The screen opened before the finish tries again with a new key.
  perform pg_temp.ok('1 a second finish of the same draft is stale',
    pg_temp.as_admin(pg_temp.save_sql(2, 'finalize_draft', p)) = 'BILL_STALE');
end $$;

-- ---------- 2. refusals leave the draft as it was ----------
do $$
declare
  b int := pg_temp.draft(-9701, 1);
  li int := pg_temp.line_id(b);
  s1 numeric := pg_temp.stock(pg_temp.v1());
  lines jsonb := jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1));
  p jsonb;
begin
  p := pg_temp.finish(b, 'finalized', lines, '{"exchange_ids": [-9704]}', '{"exchange_credit_used": 100}');
  perform pg_temp.ok('2 spent exchange refused', pg_temp.as_admin(pg_temp.save_sql(10, 'finalize_draft', p)) = 'BILL_EXCHANGE_USED');
  p := pg_temp.finish(b, 'finalized', lines, '{"exchange_ids": [-9702]}', '{"exchange_credit_used": 200}');
  perform pg_temp.ok('2 another customer''s exchange refused',
    pg_temp.as_admin(pg_temp.save_sql(11, 'finalize_draft', p)) = 'BILL_EXCHANGE_CUSTOMER');
  p := pg_temp.finish(b, 'finalized', lines, '{"exchange_ids": [-9705]}', '{"exchange_credit_used": 150}');
  perform pg_temp.ok('2 more credit than the exchange holds refused',
    pg_temp.as_admin(pg_temp.save_sql(12, 'finalize_draft', p)) = 'BILL_EXCHANGE_OVER');
  p := pg_temp.finish(b, 'finalized', lines, '{"exchange_ids": [-9705], "exchange_balance_to_credit": 60}',
                      '{"exchange_credit_used": 50}');
  perform pg_temp.ok('2 used plus balance over the exchange refused',
    pg_temp.as_admin(pg_temp.save_sql(13, 'finalize_draft', p)) = 'BILL_EXCHANGE_OVER');
  p := pg_temp.finish(b, 'finalized', lines, '{}', '{"exchange_credit_used": 50}');
  perform pg_temp.ok('2 exchange credit with no exchange refused',
    pg_temp.as_admin(pg_temp.save_sql(14, 'finalize_draft', p)) = 'BILL_EXCHANGE_OVER');
  p := pg_temp.finish(b, 'finalized', lines, '{"voucher_id": "DFIN-USED"}');
  perform pg_temp.ok('2 voucher spent elsewhere refused',
    pg_temp.as_admin(pg_temp.save_sql(15, 'finalize_draft', p)) = 'BILL_VOUCHER_REFUSED');
  p := pg_temp.finish(b, 'finalized', lines) || '{"expect": {"paymentstatus": "draft", "payment_amount": 5}}';
  perform pg_temp.ok('2 payment changed since load is stale',
    pg_temp.as_admin(pg_temp.save_sql(16, 'finalize_draft', p)) = 'BILL_STALE');
  p := pg_temp.finish(b, 'finalized', jsonb_build_array(pg_temp.line(li + 100000, pg_temp.v1(), 1)));
  perform pg_temp.ok('2 a line not on the bill is stale',
    pg_temp.as_admin(pg_temp.save_sql(17, 'finalize_draft', p)) = 'BILL_STALE');
  p := pg_temp.finish(b, 'finalized', lines, '{}', '{"document_type": "invoice"}');
  perform pg_temp.ok('2 document type cannot change',
    pg_temp.as_admin(pg_temp.save_sql(18, 'finalize_draft', p)) = 'BILL_BAD_PAYLOAD');
  p := pg_temp.finish(b, 'partial', lines, '{"first_payment": {"amount": 100, "salesmethodid": -9701}}',
                      '{"payment_amount": 100}');
  perform pg_temp.ok('2 op and status must agree',
    pg_temp.as_admin(pg_temp.save_sql(19, 'finalize_draft', p)) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('2 draft untouched', (pg_temp.bill(b)).paymentstatus = 'draft'
    and pg_temp.stock(pg_temp.v1()) = s1 and (select count(*) from public.bill_items where billid = b) = 1
    and (select new_billid from public.exchanges where exchangeid = -9705) is null);

  -- A signed-in user who is not staff cannot call it at all.
  perform pg_temp.ok('2 non-staff refused', pg_temp.as_user(pg_temp.save_sql(9, 'finalize_draft',
    pg_temp.finish(b, 'finalized', lines))) = '42501');
end $$;

-- ---------- 3. partial_draft: first payment, exchange checked and linked ----------
do $$
declare
  b int := pg_temp.draft(-9701, 1);
  li int := pg_temp.line_id(b);
  p jsonb;
  r jsonb;
begin
  -- The old screen linked this with a direct update that never looked at new_billid.
  p := pg_temp.finish(b, 'partial', jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1)),
    '{"exchange_ids": [-9704], "first_payment": {"amount": 200, "salesmethodid": -9701}}',
    '{"payment_amount": 200, "net_amount": 900, "exchange_credit_used": 100}');
  perform pg_temp.ok('3 spent exchange refused on part-paid finish',
    pg_temp.as_admin(pg_temp.save_sql(20, 'partial_draft', p)) = 'BILL_EXCHANGE_USED');

  p := pg_temp.finish(b, 'partial', jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1)),
    '{"exchange_ids": [-9706], "first_payment": {"amount": 200, "salesmethodid": -9701}}',
    '{"payment_amount": 200, "net_amount": 800, "store_credit_used": 100, "exchange_credit_used": 100}');
  r := pg_temp.rpc(pg_temp.save_sql(21, 'partial_draft', p));
  perform pg_temp.ok('3 bill part-paid with its first payment', (pg_temp.bill(b)).paymentstatus = 'partial'
    and (pg_temp.bill(b)).payment_amount = 200 and (r -> 'payment' ->> 'amount')::numeric = 200
    and (select count(*) from public.bill_payments where billid = b and amount = 200 and kind = 'payment') = 1);
  perform pg_temp.ok('3 exchange linked', (select new_billid from public.exchanges where exchangeid = -9706) = b
    and (pg_temp.bill(b)).exchange_credit_used = 100);
  perform pg_temp.ok('3 credit reason', (select count(*) from public.store_credit_ledger
    where customerid = -9701 and ref_id = b::text and reason = 'bill_partial_finalize' and delta = -100) = 1);
  perform pg_temp.ok('3 a payment must match payment_amount', pg_temp.as_admin(pg_temp.save_sql(22, 'partial_draft',
    pg_temp.finish(pg_temp.draft(-9701), 'partial', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1)),
      '{"first_payment": {"amount": 200, "salesmethodid": -9701}}', '{"payment_amount": 300}'))) = 'BILL_BAD_PAYLOAD');
end $$;

-- ---------- 4. lines taken off give stock back; "Don't reduce stock" moves none ----------
do $$
declare
  b int := pg_temp.draft(-9701, 3);
  b2 int := pg_temp.draft(-9701, 2, false);
  s1 numeric := pg_temp.stock(pg_temp.v1());
  s2 numeric := pg_temp.stock(pg_temp.v2());
begin
  perform pg_temp.rpc(pg_temp.save_sql(30, 'finalize_draft', pg_temp.finish(b, 'finalized',
    jsonb_build_array(pg_temp.line(null, pg_temp.v2(), 1)))));
  perform pg_temp.ok('4 removed line deleted', (select count(*) from public.bill_items where billid = b) = 1
    and not exists (select 1 from public.bill_items where billid = b and variantid = pg_temp.v1()));
  perform pg_temp.ok('4 its stock given back, the new line''s taken',
    pg_temp.stock(pg_temp.v1()) = s1 + 3 and pg_temp.stock(pg_temp.v2()) = s2 - 1);

  perform pg_temp.rpc(pg_temp.save_sql(31, 'finalize_draft', pg_temp.finish(b2, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 5)))));
  perform pg_temp.ok('4 a bill saved without stock moves none later',
    pg_temp.stock(pg_temp.v1()) = s1 + 3 and (select quantity from public.bill_items where billid = b2) = 5);

  b := pg_temp.draft(-9701, 1);
  perform pg_temp.rpc(pg_temp.save_sql(32, 'finalize_draft', pg_temp.finish(b, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 4)), '{"skip_stock": true}')));
  perform pg_temp.ok('4 skip_stock moves none', pg_temp.stock(pg_temp.v1()) = s1 + 3 - 1);
end $$;

-- ---------- 5. create ops: exchange checks apply there too ----------
do $$
declare
  c0 numeric := pg_temp.credit(-9701);
  p jsonb;
begin
  p := pg_temp.finish(0, 'finalized', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1)),
         '{"exchange_balance_to_credit": 500}') - 'billid' - 'expect';
  p := jsonb_set(p, '{items,0}', (p -> 'items' -> 0) - 'bill_item_id');
  perform pg_temp.ok('5 balance to store credit with no exchange refused',
    pg_temp.as_admin(pg_temp.save_sql(40, 'finalize_create', p)) = 'BILL_EXCHANGE_OVER');
  perform pg_temp.ok('5 nothing minted', pg_temp.credit(-9701) = c0);
  p := jsonb_set(p, '{exchange_ids}', '[-9702]') - 'exchange_balance_to_credit';
  perform pg_temp.ok('5 another customer''s exchange refused on create',
    pg_temp.as_admin(pg_temp.save_sql(41, 'finalize_create', p)) = 'BILL_EXCHANGE_CUSTOMER');
  p := jsonb_set(p, '{exchange_ids}', '[-9703]');
  perform pg_temp.ok('5 an exchange with no customer can be used',
    pg_temp.as_admin(pg_temp.save_sql(42, 'finalize_create', p)) = 'ok');
end $$;

-- ---------- 6. bill_edit saves the lines, stock and salespeople with the bill ----------
do $$
declare
  b int := pg_temp.sold(60, 1);
  li int := pg_temp.line_id(b);
  s1 numeric;
  s2 numeric;
  r jsonb;
begin
  s1 := pg_temp.stock(pg_temp.v1());
  s2 := pg_temp.stock(pg_temp.v2());
  r := pg_temp.rpc(pg_temp.edit_sql(61, b, pg_temp.edit(b, 3000,
    jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 2, 2000), pg_temp.line(null, pg_temp.v2(), 1)),
    '{"salesperson_ids": [-9701]}')));
  perform pg_temp.ok('6 saved line updated in place', (select quantity from public.bill_items where bill_item_id = li) = 2);
  perform pg_temp.ok('6 new line inserted', pg_temp.lines(b) = jsonb_build_array(
    jsonb_build_array(pg_temp.v1(), 2), jsonb_build_array(pg_temp.v2(), 1)));
  perform pg_temp.ok('6 stock moved by the change', pg_temp.stock(pg_temp.v1()) = s1 - 1 and pg_temp.stock(pg_temp.v2()) = s2 - 1);
  perform pg_temp.ok('6 moves recorded on a bill_save bill', (select count(*) from public.bill_stock_moves
    where billid = b and reason = 'bill_edit' and idempotency_key = pg_temp.k(61)) = 2);
  perform pg_temp.ok('6 salesperson replaced', (select array_agg(salesperson_id) from public.bill_salespersons where billid = b) = '{-9701}');
  perform pg_temp.ok('6 bill row saved', (pg_temp.bill(b)).totalamount = 3000 and (pg_temp.bill(b)).notes = 'DFIN edit');

  -- Cancel gives back everything the bill now holds, read from its moves.
  perform pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(62), b, 'store_credit',
    jsonb_build_object('expect', jsonb_build_object('finalized', true, 'paymentstatus', 'finalized'))));
  perform pg_temp.ok('6 cancel returns the edited stock', pg_temp.stock(pg_temp.v1()) = s1 + 1 and pg_temp.stock(pg_temp.v2()) = s2);
end $$;

do $$
declare
  b int := pg_temp.sold(63, 2, 2000);
  li int := pg_temp.line_id(b);
  before jsonb;
  s1 numeric;
begin
  before := pg_temp.lines(b);
  s1 := pg_temp.stock(pg_temp.v1());
  -- Taking a unit off a paid bill leaves money held over, and no choice was sent: refused, and
  -- the lines stay as they were (they used to be saved before bill_edit refused).
  perform pg_temp.ok('6 refused edit', pg_temp.as_admin(pg_temp.edit_sql(64, b,
    pg_temp.edit(b, 1000, jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1))))) = 'BILL_EXCESS_UNSETTLED');
  perform pg_temp.ok('6 refused edit kept the lines and stock', pg_temp.lines(b) = before and pg_temp.stock(pg_temp.v1()) = s1);

  -- An exchanged line cannot be dropped through bill_edit either.
  insert into public.exchanges (original_bill_item_id, quantity, customerid, credit_amount) values (li, 1, -9701, 500);
  perform pg_temp.ok('6 exchanged line kept', pg_temp.as_admin(pg_temp.edit_sql(65, b,
    pg_temp.edit(b, 2000, jsonb_build_array(pg_temp.line(null, pg_temp.v2(), 2, 2000))))) = 'BILL_ITEM_EXCHANGED');
  perform pg_temp.ok('6 nothing changed', pg_temp.lines(b) = before and pg_temp.stock(pg_temp.v1()) = s1);

  -- Without items, lines and stock are left alone (the screen from before this change).
  perform pg_temp.rpc(pg_temp.edit_sql(66, b, pg_temp.edit(b, 2000, null) - 'items' - 'salesperson_ids' - 'skip_stock'));
  perform pg_temp.ok('6 no items leaves lines alone', pg_temp.lines(b) = before and (pg_temp.bill(b)).notes = 'DFIN edit');
end $$;

do $$
declare
  b int := pg_temp.draft(-9701, 1);
  b2 int := pg_temp.draft(-9701, 1, false);
  s1 numeric := pg_temp.stock(pg_temp.v1());
begin
  perform pg_temp.rpc(pg_temp.edit_sql(67, b, pg_temp.edit(b, 3000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 3, 3000)))));
  perform pg_temp.ok('6 draft edit takes the extra stock', pg_temp.stock(pg_temp.v1()) = s1 - 2);
  perform pg_temp.ok('6 no moves rows on a screen draft', not exists (select 1 from public.bill_stock_moves where billid = b));
  perform pg_temp.rpc(pg_temp.edit_sql(68, b2, pg_temp.edit(b2, 3000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 3, 3000)))));
  perform pg_temp.ok('6 a bill saved without stock moves none on edit', pg_temp.stock(pg_temp.v1()) = s1 - 2);
  perform pg_temp.rpc(pg_temp.edit_sql(69, b, pg_temp.edit(b, 3000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 5, 5000)), '{"skip_stock": true}')));
  perform pg_temp.ok('6 skip_stock moves none on edit', pg_temp.stock(pg_temp.v1()) = s1 - 2);
end $$;

-- ---------- 7. store credit an edit cuts goes back to the customer, after the cash ----------
do $$
declare
  b int;
  b2 int;
  r jsonb;
  q text;
  li int;
begin
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9703, 'DFINFIXTURE000000000000003', 'Credit', 1000), (-9704, 'DFINFIXTURE000000000000004', 'Other', 0);

  -- 1000 paid as 400 store credit and 600 cash.
  b := pg_temp.sold(70, 1, 600, '{}', '{"customerid": -9703, "store_credit_used": 400, "net_amount": 600}');
  li := pg_temp.line_id(b);
  perform pg_temp.ok('7 credit taken at sale', pg_temp.credit(-9703) = 600);

  -- Down to 700: the cut comes off the cash. Credit stays used, 300 cash goes back.
  r := pg_temp.rpc(pg_temp.edit_sql(71, b, pg_temp.edit(b, 300,
    jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1, 700)),
    '{"excess": {"mode": "refund", "amount": 300, "salesmethodid": -9701}}', '{"totalamount": 700}')));
  perform pg_temp.ok('7 cash first: 300 refunded, credit kept', (r ->> 'store_credit_back')::numeric = 0
    and (r -> 'excess' ->> 'amount')::numeric = 300 and pg_temp.credit(-9703) = 600
    and (pg_temp.bill(b)).store_credit_used = 400);

  -- Down to 300: the rest of the cash goes back, and credit for the part below 400.
  q := pg_temp.edit_sql(72, b, pg_temp.edit(b, 0,
    jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1, 300)),
    '{"excess": {"mode": "refund", "amount": 300, "salesmethodid": -9701}}',
    '{"totalamount": 300, "store_credit_used": 300}'));
  r := pg_temp.rpc(q);
  perform pg_temp.ok('7 credit cut goes back', (r ->> 'store_credit_back')::numeric = 100 and pg_temp.credit(-9703) = 700
    and (select count(*) from public.store_credit_ledger where customerid = -9703 and ref_id = b::text
           and reason = 'bill_edit_credit_back' and delta = 100) = 1);
  perform pg_temp.ok('7 replay gives nothing back twice',
    (pg_temp.rpc(q) ->> 'replayed')::boolean and pg_temp.credit(-9703) = 700);

  -- Cancel then gives back the 300 credit still used and no cash: 400 credit and 600 cash in all.
  r := pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(73), b, 'return_payment',
    jsonb_build_object('expect', jsonb_build_object('finalized', true, 'paymentstatus', 'finalized'))));
  perform pg_temp.ok('7 edit then cancel returns exactly what was paid', pg_temp.credit(-9703) = 1000
    and (r ->> 'refund')::numeric = 0
    and (select -sum(amount) from public.bill_payments where billid = b and kind = 'refund') = 600);

  -- Refused: credit on a draft, credit going up, another customer on a bill that used credit.
  b2 := pg_temp.draft(-9703);
  perform pg_temp.ok('7 a draft holds no store credit', pg_temp.as_admin(pg_temp.edit_sql(74, b2, pg_temp.edit(b2, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 1)), '{}', '{"store_credit_used": 500}'))) = 'BILL_BAD_PAYLOAD');
  b2 := pg_temp.sold(75, 1, 900, '{}', '{"customerid": -9703, "store_credit_used": 100, "net_amount": 900}');
  perform pg_temp.ok('7 credit cannot go up', pg_temp.as_admin(pg_temp.edit_sql(76, b2, pg_temp.edit(b2, 900,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 1)), '{}', '{"store_credit_used": 200}'))) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('7 customer cannot change on a bill that used credit', pg_temp.as_admin(pg_temp.edit_sql(77, b2,
    pg_temp.edit(b2, 900, jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 1)), '{}',
      '{"customerid": -9704}'))) = 'BILL_CREDIT_CUSTOMER');
  perform pg_temp.ok('7 refusals moved no credit', pg_temp.credit(-9703) = 900 and pg_temp.credit(-9704) = 0);
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _df_checks;
rollback;
