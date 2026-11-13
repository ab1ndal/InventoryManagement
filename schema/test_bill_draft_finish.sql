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
  r text;
begin
  perform pg_temp.rpc(pg_temp.save_sql(30, 'finalize_draft', pg_temp.finish(b, 'finalized',
    jsonb_build_array(pg_temp.line(null, pg_temp.v2(), 1)))));
  perform pg_temp.ok('4 removed line deleted', (select count(*) from public.bill_items where billid = b) = 1
    and not exists (select 1 from public.bill_items where billid = b and variantid = pg_temp.v1()));
  perform pg_temp.ok('4 its stock given back, the new line''s taken',
    pg_temp.stock(pg_temp.v1()) = s1 + 3 and pg_temp.stock(pg_temp.v2()) = s2 - 1);

  -- The screen sends the bill's own choice, which it locks once the bill is saved.
  perform pg_temp.ok('4 a draft saved without stock refuses skip_stock false at finish',
    pg_temp.as_admin(pg_temp.save_sql(33, 'finalize_draft', pg_temp.finish(b2, 'finalized',
      jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 5))))) = 'BILL_BAD_PAYLOAD'
    and (pg_temp.bill(b2)).paymentstatus = 'draft');
  perform pg_temp.rpc(pg_temp.save_sql(31, 'finalize_draft', pg_temp.finish(b2, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 5)), '{"skip_stock": true}')));
  perform pg_temp.ok('4 a bill saved without stock moves none later',
    pg_temp.stock(pg_temp.v1()) = s1 + 3 and (select quantity from public.bill_items where billid = b2) = 5);

  -- A draft that took stock cannot be finished as "Don't reduce stock": bill_cancel would give
  -- back lines it never took (17 has the whole case).
  b := pg_temp.draft(-9701, 1);
  r := pg_temp.as_admin(pg_temp.save_sql(32, 'finalize_draft', pg_temp.finish(b, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 4)), '{"skip_stock": true}')));
  perform pg_temp.ok('4 skip_stock on a draft that took stock refused',
    r = 'BILL_BAD_PAYLOAD' and pg_temp.stock(pg_temp.v1()) = s1 + 3 - 1
    and (pg_temp.bill(b)).paymentstatus = 'draft' and pg_temp.lines(b) = jsonb_build_array(jsonb_build_array(pg_temp.v1(), 1)));
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
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 3, 3000)), '{"skip_stock": true}')));
  perform pg_temp.ok('6 a bill saved without stock moves none on edit', pg_temp.stock(pg_temp.v1()) = s1 - 2);
  perform pg_temp.ok('6 skip_stock on a bill that took stock refused', pg_temp.as_admin(pg_temp.edit_sql(69, b,
    pg_temp.edit(b, 3000, jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 5, 5000)),
      '{"skip_stock": true}'))) = 'BILL_BAD_PAYLOAD'
    and pg_temp.stock(pg_temp.v1()) = s1 - 2 and (select quantity from public.bill_items where billid = b) = 3);
  perform pg_temp.ok('6 skip_stock false on a bill saved without stock refused', pg_temp.as_admin(pg_temp.edit_sql(70, b2,
    pg_temp.edit(b2, 3000, jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 1, 1000))))) = 'BILL_BAD_PAYLOAD'
    and pg_temp.stock(pg_temp.v1()) = s1 - 2);
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
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 1)),
    '{"excess": {"mode": "refund", "amount": 100, "salesmethodid": -9701}}',
    '{"store_credit_used": 200, "totalamount": 1000}'))) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('7 customer cannot change on a bill that used credit', pg_temp.as_admin(pg_temp.edit_sql(77, b2,
    pg_temp.edit(b2, 900, jsonb_build_array(pg_temp.line(pg_temp.line_id(b2), pg_temp.v1(), 1)), '{}',
      '{"customerid": -9704, "totalamount": 1000}'))) = 'BILL_CREDIT_CUSTOMER');
  perform pg_temp.ok('7 refusals moved no credit', pg_temp.credit(-9703) = 900 and pg_temp.credit(-9704) = 0);
end $$;

-- What the live admin policies allow staff on bills (the harness has no policies).
grant select, insert, update, delete on public.bills to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---------- 8. what a bill holds changes only by recorded money; no direct money writes ----------
do $$
declare
  b int := pg_temp.sold(80, 1, 1000);
  li int := pg_temp.line_id(b);
  li2 int;
  d int;
  r jsonb;
begin
  -- Re-finalize after adding an item: 500 more taken is recorded as a payment.
  r := pg_temp.rpc(pg_temp.edit_sql(81, b, pg_temp.edit(b, 1500,
    jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1), pg_temp.line(null, pg_temp.v2(), 1, 500)),
    '{"discount_codes": ["DFIN-TEST"]}', '{"payment_amount": 1500, "totalamount": 1500}')));
  perform pg_temp.ok('8 more received is a payment row', (select array_agg(amount order by payment_id)
    from public.bill_payments where billid = b) = '{1000, 500}'
    and (pg_temp.bill(b)).payment_amount = 1500 and (pg_temp.bill(b)).paymentstatus = 'finalized');
  select max(bill_item_id) into li2 from public.bill_items where billid = b;
  perform pg_temp.ok('8 discount use recorded on re-finalize', (select count(*) from public.discount_usage
    where billid = b and code = 'DFIN-TEST') = 1);
  perform pg_temp.ok('8 lowering what was received refused', pg_temp.as_admin(pg_temp.edit_sql(82, b,
    pg_temp.edit(b, 1500, jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1), pg_temp.line(li2, pg_temp.v2(), 1, 500)),
      '{}', '{"payment_amount": 1000}')))
    = 'BILL_RECEIVED_CHANGED');
  perform pg_temp.ok('8 raising it on a bill with payment rows refused', pg_temp.as_admin(pg_temp.edit_sql(83, b,
    pg_temp.edit(b, 2000, jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1), pg_temp.line(li2, pg_temp.v2(), 1, 500),
      pg_temp.line(null, pg_temp.v2(), 1, 500)), '{}', '{"payment_amount": 2000}')))
    = 'BILL_RECEIVED_CHANGED');

  b := pg_temp.sold(84, 1, 1000);
  perform pg_temp.ok('8 more than the net refused', pg_temp.as_admin(pg_temp.edit_sql(85, b,
    pg_temp.edit(b, 1200, jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1, 1200)), '{}',
      '{"payment_amount": 1300}'))) = 'BILL_OVERPAID');
  r := pg_temp.rpc(pg_temp.edit_sql(86, b, pg_temp.edit(b, 1500,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1, 1500)), '{}', '{"payment_amount": 1200}')));
  perform pg_temp.ok('8 part of the rise received leaves the bill part-paid', (pg_temp.bill(b)).paymentstatus = 'partial'
    and (pg_temp.bill(b)).payment_amount = 1200);
  r := pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(87), b, 'return_payment',
    jsonb_build_object('expect', jsonb_build_object('finalized', true, 'paymentstatus', 'partial'))));
  perform pg_temp.ok('8 cancel refunds what was received, once', (r ->> 'refund')::numeric = 1200);

  d := pg_temp.draft(-9701);
  perform pg_temp.ok('8 a draft records no discount use', pg_temp.as_admin(pg_temp.edit_sql(88, d,
    pg_temp.edit(d, 1000, jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)),
      '{"discount_codes": ["DFIN-TEST"]}'))) = 'BILL_BAD_PAYLOAD');
end $$;

do $$
declare
  b int := pg_temp.sold(90, 1, 1000);
  d int := pg_temp.draft(-9701);
  has_lock boolean := to_regproc('public._bills_money_via_rpc') is not null;
begin
  perform pg_temp.ok('8 direct raise of what was received refused', has_lock and pg_temp.as_admin(format(
    'update public.bills set payment_amount = 5000 where billid = %s', b)) = 'BILL_MONEY_DIRECT');
  perform pg_temp.ok('8 direct store credit on a paid bill refused', pg_temp.as_admin(format(
    'update public.bills set store_credit_used = 500 where billid = %s', b)) = 'BILL_MONEY_DIRECT');
  perform pg_temp.ok('8 direct store credit on a draft refused', pg_temp.as_admin(format(
    'update public.bills set store_credit_used = 500 where billid = %s', d)) = 'BILL_MONEY_DIRECT');
  perform pg_temp.ok('8 direct finalize of a draft refused', pg_temp.as_admin(format(
    $q$update public.bills set paymentstatus = 'finalized', finalized = true where billid = %s$q$, d)) = 'BILL_MONEY_DIRECT');
  perform pg_temp.ok('8 direct insert of a finalized bill refused', pg_temp.as_admin(
    $q$insert into public.bills (paymentstatus, finalized, notes, payment_amount) values ('finalized', true, 'DFIN', 900)$q$)
    = 'BILL_MONEY_DIRECT');
  perform pg_temp.ok('8 direct insert of a draft with credit refused', pg_temp.as_admin(
    $q$insert into public.bills (paymentstatus, finalized, notes, store_credit_used) values ('draft', false, 'DFIN', 900)$q$)
    = 'BILL_MONEY_DIRECT');
  perform pg_temp.ok('8 a plain draft insert and its amounts still save', pg_temp.as_admin(
    $q$insert into public.bills (paymentstatus, finalized, notes, payment_amount) values ('draft', false, 'DFIN', 900)$q$) = 'ok'
    and pg_temp.as_admin(format('update public.bills set payment_amount = 950, net_amount = 950 where billid = %s', d)) = 'ok');
  perform pg_temp.ok('8 notes and pdf path on a paid bill still save', pg_temp.as_admin(format(
    $q$update public.bills set notes = 'DFIN note', pdf_url = 'x.pdf' where billid = %s$q$, b)) = 'ok');
  -- A repair in the SQL editor runs as the owner, not as an API role.
  update public.bills set payment_amount = 1001 where billid = b;
  perform pg_temp.ok('8 the owner is not an API caller', (select payment_amount from public.bills where billid = b) = 1001);
end $$;

-- ---------- 9. vouchers are redeemed only inside bill_save ----------
do $$
declare
  b int := pg_temp.sold(95, 1, 1000);
begin
  insert into public.vouchers (voucher_id, customerid, expiry_date, value) values ('DFIN-LATE', -9701, current_date + 30, 100);
  perform pg_temp.ok('9 staff cannot spend a voucher on a finished bill', pg_temp.as_admin(format(
    'select public.voucher_redeem(%L, %s)', 'DFIN-LATE', b)) = '42501'
    and (select not redeemed from public.vouchers where voucher_id = 'DFIN-LATE'));
  perform pg_temp.ok('9 voucher_release is gone', to_regprocedure('public.voucher_release(text,int)') is null);
end $$;

-- ---------- 10. exchanges are written only by the database functions ----------
do $$
begin
  perform pg_temp.ok('10 staff cannot unlink a spent exchange', pg_temp.as_admin(
    'update public.exchanges set new_billid = null where exchangeid = -9701') = '42501'
    and (select new_billid from public.exchanges where exchangeid = -9701) is not null);
  perform pg_temp.ok('10 staff cannot mint exchange credit', pg_temp.as_admin(
    'insert into public.exchanges (quantity, customerid, credit_amount) values (1, -9701, 5000)') = '42501');
  perform pg_temp.ok('10 staff cannot delete an exchange', pg_temp.as_admin(
    'delete from public.exchanges where exchangeid = -9702') = '42501');
  perform pg_temp.ok('10 staff still read exchanges', pg_temp.as_admin(
    'select count(*) from public.exchanges') = 'ok');
end $$;

-- ---------- 11. a bill paid with store credit and then exchanged never pays out twice ----------
-- Paid 400 store credit + 600 cash, then 600 of it exchanged, then cancelled: what goes back to
-- the customer in all (store credit, cash, exchange credit) must be the 1000 paid. Exchange credit
-- is capped at the cash the bill holds (schema/migration_exchange_record_caps.sql), and bill_cancel
-- returns the store credit in full and the cash less exchange credit given.
do $$
declare
  b int;
  li int;
  r jsonb;
  ex numeric;
begin
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9705, 'DFINFIXTURE000000000000005', 'Exchange', 400);
  b := pg_temp.sold(110, 1, 600, '{}', '{"customerid": -9705, "store_credit_used": 400, "net_amount": 600}');
  li := pg_temp.line_id(b);
  perform pg_temp.ok('11 sale took the 400 credit', pg_temp.credit(-9705) = 0);

  perform pg_temp.ok('11 exchange above the cash held refused', pg_temp.as_admin(format(
    'select public.exchange_record(%s, -9705, %L)', b,
    jsonb_build_array(jsonb_build_object('bill_item_id', li, 'quantity', 1, 'credit_amount', 1000)))) = 'EXCHANGE_OVER_HELD');
  perform pg_temp.ok('11 exchange of the cash held recorded', pg_temp.as_admin(format(
    'select public.exchange_record(%s, -9705, %L)', b,
    jsonb_build_array(jsonb_build_object('bill_item_id', li, 'quantity', 1, 'credit_amount', 600)))) = 'ok');

  r := pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(111), b, 'return_payment',
    jsonb_build_object('expect', jsonb_build_object('finalized', true, 'paymentstatus', 'finalized'))));
  select coalesce(sum(credit_amount), 0) into ex from public.exchanges e
   where e.original_bill_item_id = li and e.new_billid is null;
  perform pg_temp.ok('11 cancel: 400 credit back, no cash, 600 exchange credit pending',
    (r ->> 'store_credit_refunded')::numeric = 400 and (r ->> 'refund')::numeric = 0
    and pg_temp.credit(-9705) = 400 and ex = 600);
  perform pg_temp.ok('11 total out equals the 1000 paid',
    (r ->> 'store_credit_refunded')::numeric + (r ->> 'refund')::numeric + ex = 1000);
end $$;

-- ---------- 12. a bill records exactly the store credit the ledger took ----------
do $$
declare
  d int;
  b int;
  r jsonb;
  before_ledger int;
begin
  insert into public.customers (customerid, customer_ulid, first_name, store_credit) values
    (-9707, 'DFINFIXTURE000000000000007', 'Twice', 500),
    (-9708, 'DFINFIXTURE000000000000008', 'Held', 400);

  -- -9702 has no credit. Before, the finish recorded 800 and took 0 (the floor at the balance),
  -- and bill_edit cutting it to 0 then gave 800 back: credit minted.
  d := pg_temp.draft(-9702);
  perform pg_temp.ok('12 credit the customer does not have is refused', pg_temp.as_admin(pg_temp.save_sql(120, 'finalize_draft',
    pg_temp.finish(d, 'finalized', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"customerid": -9702, "store_credit_used": 800, "payment_amount": 200}'))) = 'BILL_CREDIT_SHORT');
  perform pg_temp.ok('12 refused finish leaves the draft and the balance', (pg_temp.bill(d)).paymentstatus = 'draft'
    and (pg_temp.bill(d)).store_credit_used = 0 and pg_temp.credit(-9702) = 0
    and not exists (select 1 from public.store_credit_ledger where customerid = -9702));
  -- So an edit cutting the credit to 0 has none to give back that was never taken.
  perform pg_temp.as_admin(pg_temp.edit_sql(121, d,
    pg_temp.edit(d, 1000, jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"store_credit_used": 0}')));
  perform pg_temp.ok('12 no credit minted by a later edit', pg_temp.credit(-9702) = 0);

  -- The same 500 spent from two windows: the second finds it gone.
  d := pg_temp.draft(-9707);
  b := pg_temp.sold(122, 1, 500, '{}', '{"customerid": -9707, "store_credit_used": 500, "net_amount": 500}');
  perform pg_temp.ok('12 first bill took the 500', pg_temp.credit(-9707) = 0 and (pg_temp.bill(b)).store_credit_used = 500
    and (select sum(delta) from public.store_credit_ledger where customerid = -9707 and ref_id = b::text) = -500);
  perform pg_temp.ok('12 stale draft cannot spend it again', pg_temp.as_admin(pg_temp.save_sql(123, 'finalize_draft',
    pg_temp.finish(d, 'finalized', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"customerid": -9707, "store_credit_used": 500, "payment_amount": 500}'))) = 'BILL_CREDIT_SHORT');
  perform pg_temp.ok('12 second window''s new bill cannot either', pg_temp.as_admin(pg_temp.save_sql(124, 'finalize_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9707, 'notes', 'DFIN twice', 'totalamount', 1000,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', 500, 'store_credit_used', 500,
        'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_CREDIT_SHORT');
  perform pg_temp.ok('12 nor a part-paid one', pg_temp.as_admin(pg_temp.save_sql(125, 'partial_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9707, 'notes', 'DFIN twice', 'totalamount', 1000,
        'net_amount', 500, 'paymentstatus', 'partial', 'finalized', true, 'payment_amount', 0,
        'store_credit_used', 500, 'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_CREDIT_SHORT');
  perform pg_temp.ok('12 store credit on a bill with no customer refused', pg_temp.as_admin(pg_temp.save_sql(126, 'finalize_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', null, 'notes', 'DFIN nobody', 'totalamount', 1000,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', 990, 'store_credit_used', 10,
        'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_CREDIT_SHORT');

  -- The whole balance, to the paisa, is fine; a paisa more is not.
  perform pg_temp.ok('12 a paisa over the balance refused', pg_temp.as_admin(pg_temp.save_sql(127, 'finalize_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9708, 'notes', 'DFIN edge', 'totalamount', 1000,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', 599.99, 'store_credit_used', 400.01,
        'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_CREDIT_SHORT');

  -- H3: a draft holding store_credit_used (from before the direct-write lock) and a finish that
  -- leaves the key out. Before, the bill kept 300 and the ledger took nothing.
  d := pg_temp.draft(-9708);
  update public.bills set store_credit_used = 300 where billid = d;
  before_ledger := (select count(*) from public.store_credit_ledger where customerid = -9708);
  r := pg_temp.rpc(pg_temp.save_sql(128, 'finalize_draft',
    pg_temp.finish(d, 'finalized', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"customerid": -9708, "payment_amount": 700}') #- '{bill,store_credit_used}'));
  perform pg_temp.ok('12 a draft''s own credit figure is taken when the finish leaves it out',
    (pg_temp.bill(d)).store_credit_used = 300 and pg_temp.credit(-9708) = 100
    and (select count(*) from public.store_credit_ledger where customerid = -9708) = before_ledger + 1
    and (select delta from public.store_credit_ledger where customerid = -9708 and ref_id = d::text) = -300);
  d := pg_temp.draft(-9702);
  update public.bills set store_credit_used = 300 where billid = d;
  perform pg_temp.ok('12 and refused when the balance is short', pg_temp.as_admin(pg_temp.save_sql(129, 'finalize_draft',
    pg_temp.finish(d, 'finalized', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"customerid": -9702, "payment_amount": 700}') #- '{bill,store_credit_used}')) = 'BILL_CREDIT_SHORT');
end $$;

-- ---------- 13. a draft is finished only by bill_save ----------
do $$
declare
  d int := pg_temp.draft(-9701);
  st text;
begin
  foreach st in array array['finalized', 'partial'] loop
    perform pg_temp.ok('13 bill_edit cannot make a draft ' || st, pg_temp.as_admin(pg_temp.edit_sql(130, d,
      pg_temp.edit(d, 1000, jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
        jsonb_build_object('paymentstatus', st, 'finalized', true, 'payment_amount', 5000)))) = 'BILL_BAD_PAYLOAD');
  end loop;
  perform pg_temp.ok('13 nor mark it finalized while calling it a draft', pg_temp.as_admin(pg_temp.edit_sql(131, d,
    pg_temp.edit(d, 1000, jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"finalized": true}'))) = 'BILL_BAD_PAYLOAD');
  perform pg_temp.ok('13 the draft is still a draft with nothing received', (pg_temp.bill(d)).paymentstatus = 'draft'
    and not (pg_temp.bill(d)).finalized and (pg_temp.bill(d)).payment_amount is null
    and not exists (select 1 from public.bill_payments where billid = d));
  perform pg_temp.ok('13 Save Changes on a draft still saves', pg_temp.as_admin(pg_temp.edit_sql(132, d,
    pg_temp.edit(d, 1000, jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"payment_amount": 900}'))) = 'ok' and (pg_temp.bill(d)).payment_amount = 900);
end $$;

-- ---------- 14. a bill cannot record more received than it comes to ----------
do $$
declare
  d int;
  b int;
  r jsonb;
begin
  perform pg_temp.ok('14 9000 received on a 1000 bill refused', pg_temp.as_admin(pg_temp.save_sql(140, 'finalize_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9701, 'notes', 'DFIN over', 'totalamount', 1000,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', 9000, 'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_OVERPAID');
  perform pg_temp.ok('14 a rupee past the screen''s ₹100 refused', pg_temp.as_admin(pg_temp.save_sql(141, 'finalize_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9701, 'notes', 'DFIN over', 'totalamount', 1000,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', 1100.01, 'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_OVERPAID');
  -- The screen and the CLI let staff record up to ₹100 over the total as received.
  b := pg_temp.sold(142, 1, 1100, '{}', '{"net_amount": null}');
  perform pg_temp.ok('14 up to ₹100 over is recorded, net stored', (pg_temp.bill(b)).payment_amount = 1100
    and (pg_temp.bill(b)).net_amount = 1000);
  -- Credit lowers what is due: 1000 cash on a 1000 bill that also used 400 credit is 400 over.
  perform pg_temp.ok('14 credit counts against what is due', pg_temp.as_admin(pg_temp.save_sql(143, 'finalize_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9701, 'notes', 'DFIN over', 'totalamount', 1000,
        'paymentstatus', 'finalized', 'finalized', true, 'payment_amount', 1000, 'store_credit_used', 400,
        'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')))) = 'BILL_OVERPAID');

  d := pg_temp.draft(-9701);
  perform pg_temp.ok('14 a draft finished with 5000 received on 1000 refused', pg_temp.as_admin(pg_temp.save_sql(144, 'finalize_draft',
    pg_temp.finish(d, 'finalized', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"payment_amount": 5000}'))) = 'BILL_OVERPAID' and (pg_temp.bill(d)).paymentstatus = 'draft');
  perform pg_temp.ok('14 a part-paid finish at or above its net refused', pg_temp.as_admin(pg_temp.save_sql(145, 'partial_draft',
    pg_temp.finish(d, 'partial', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)),
      '{"first_payment": {"amount": 1001, "salesmethodid": -9701}}', '{"payment_amount": 1001, "net_amount": 1000}')))
    = 'BILL_OVERPAID');
  perform pg_temp.ok('14 nor a new part-paid one', pg_temp.as_admin(pg_temp.save_sql(146, 'partial_create',
    jsonb_build_object('bill', jsonb_build_object('customerid', -9701, 'notes', 'DFIN over', 'totalamount', 1000,
        'net_amount', 1000, 'paymentstatus', 'partial', 'finalized', true, 'payment_amount', 9000,
        'salesmethodid', -9701),
      'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id'),
      'first_payment', jsonb_build_object('amount', 9000, 'salesmethodid', -9701)))) = 'BILL_OVERPAID');

  -- A draft's stale net (from its last Save Changes) is replaced by the finish's.
  update public.bills set net_amount = 5 where billid = d;
  r := pg_temp.rpc(pg_temp.save_sql(147, 'finalize_draft',
    pg_temp.finish(d, 'finalized', jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
      '{"payment_amount": 1000}')));
  perform pg_temp.ok('14 finished draft stores its own net', (pg_temp.bill(d)).net_amount = 1000
    and (pg_temp.bill(d)).payment_amount = 1000);
end $$;

-- ---------- 15. bills from before net_amount was stored (net null) still edit, exchange, cancel ----------
-- Most paid-in-one-go bills on production have net_amount null (finalize never wrote it).
do $$
declare
  b int;
  li int;
  r jsonb;
begin
  insert into public.bills (customerid, notes, document_type, totalamount, gst_total, discount_total, taxable_total,
                            paymentstatus, finalized, applied_codes, payment_amount, net_amount, salesmethodid,
                            orderdate, stock_reduced)
  values (-9701, 'DFIN legacy', 'bos', 1500, 0, 0, 1500, 'finalized', true, '{}', 1500, null, -9701,
          '2026-11-12', true)
  returning billid into b;
  insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code, subtotal, gst_amount, total)
  values (b, 1, 1000, pg_temp.v1(), 'DFIN item', 'DFP1', 1000, 0, 1000)
  returning bill_item_id into li;
  insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code, subtotal, gst_amount, total)
  values (b, 1, 500, pg_temp.v2(), 'DFIN item', 'DFP1', 500, 0, 500);
  perform pg_temp.ok('15 a payment on it is still nothing due', pg_temp.as_admin(format(
    'select public.bill_add_payment(%L, %s, 100, -9701, null)', pg_temp.k(150), b)) = 'BILL_NOTHING_DUE');
  perform pg_temp.ok('15 exchange within the cash held recorded', pg_temp.as_admin(format(
    'select public.exchange_record(%s, -9701, %L)', b,
    jsonb_build_array(jsonb_build_object('bill_item_id', li, 'quantity', 1, 'credit_amount', 500)))) = 'ok');
  -- Taking the 500 line off leaves 500 of the 1500 received over; staff put it on store credit.
  r := pg_temp.rpc(pg_temp.edit_sql(151, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1)),
    '{"excess": {"mode": "store_credit", "amount": 500}}')));
  perform pg_temp.ok('15 edit settles the excess over a null net', (r -> 'excess' ->> 'amount')::numeric = 500
    and (pg_temp.bill(b)).net_amount = 1000 and (pg_temp.bill(b)).payment_amount = 1000
    and (select sum(amount) from public.bill_payments where billid = b) = 1000);
  r := pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(152), b, 'return_payment',
    jsonb_build_object('expect', jsonb_build_object('finalized', true, 'paymentstatus', 'finalized'))));
  perform pg_temp.ok('15 cancel pays back the cash held less exchange credit: 1500 out in all',
    (r ->> 'refund')::numeric = 500);

  -- Cancelled straight away, a null-net bill refunds what was received.
  insert into public.bills (customerid, notes, document_type, totalamount, paymentstatus, finalized, payment_amount,
                            net_amount, salesmethodid, orderdate, stock_reduced)
  values (-9701, 'DFIN legacy', 'bos', 1000, 'finalized', true, 1000, null, -9701, '2026-11-12', false)
  returning billid into b;
  insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code, subtotal, gst_amount, total)
  values (b, 1, 1000, pg_temp.v1(), 'DFIN item', 'DFP1', 1000, 0, 1000);
  r := pg_temp.rpc(format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(153), b, 'return_payment',
    jsonb_build_object('expect', jsonb_build_object('finalized', true, 'paymentstatus', 'finalized'))));
  perform pg_temp.ok('15 cancel refunds the 1000 received', (r ->> 'refund')::numeric = 1000);
end $$;

-- ---------- 16. money figures from the client are 0 or more, and the net is the server's ----------
-- As pg_temp.as_admin, with the error's detail too.
create function pg_temp.as_admin_detail(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.admin_id(), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || ': ' || coalesce(v_detail, '');
end $$;

-- A new bill as the screen's create ops send it, for one 1000 line.
create function pg_temp.create_sql(p_key int, p_op text, p_bill jsonb, p_extra jsonb default '{}') returns text language sql as $$
  select pg_temp.save_sql(p_key, p_op, jsonb_build_object(
    'bill', jsonb_build_object('customerid', -9711, 'notes', 'DFIN money', 'totalamount', 1000,
      'paymentstatus', case when p_op like 'partial%' then 'partial' else 'finalized' end, 'finalized', true,
      'payment_amount', 1000, 'salesmethodid', -9701, 'orderdate', '2026-11-12T00:00:00+05:30') || p_bill,
    'items', jsonb_build_array(pg_temp.line(null, pg_temp.v1(), 1) - 'bill_item_id')) || p_extra)
$$;

do $$
declare
  b int;
  d int;
  r text;
  j jsonb;
  bills_before int;
begin
  insert into public.customers (customerid, customer_ulid, first_name, store_credit) values
    (-9711, 'DFINFIXTURE000000000000011', 'Money', 0),
    (-9712, 'DFINFIXTURE000000000000012', 'Money credit', 300);

  -- bill_edit: a negative store_credit_used read as a cut and credited the customer the difference.
  b := pg_temp.sold(160, 1, 1000, '{}', '{"customerid": -9711}');
  r := pg_temp.as_admin_detail(pg_temp.edit_sql(161, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)), '{}', '{"store_credit_used": -500}')));
  perform pg_temp.ok('16 edit refuses store_credit_used 0 -> -500, no credit given',
    r = 'BILL_BAD_PAYLOAD: store_credit_used must be 0 or more'
    and pg_temp.credit(-9711) = 0 and (pg_temp.bill(b)).store_credit_used = 0);
  b := pg_temp.sold(162, 1, 700, '{}', '{"customerid": -9712, "store_credit_used": 300}');
  r := pg_temp.as_admin(pg_temp.edit_sql(163, b, pg_temp.edit(b, 700,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)), '{}',
    '{"store_credit_used": -200, "totalamount": 1000}')));
  perform pg_temp.ok('16 edit refuses store_credit_used 300 -> -200, no credit given',
    r = 'BILL_BAD_PAYLOAD' and pg_temp.credit(-9712) = 0 and (pg_temp.bill(b)).store_credit_used = 300);

  -- bill_edit: a net sent below what the lines and credit come to made an excess to credit.
  b := pg_temp.sold(164, 1, 1000, '{}', '{"customerid": -9711}');
  r := pg_temp.as_admin(pg_temp.edit_sql(165, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)),
    '{"excess": {"mode": "store_credit", "amount": 1000}}', '{"net_amount": 0}')));
  perform pg_temp.ok('16 edit works out the net itself: a sent net of 0 makes no excess',
    r = 'BILL_EXCESS_CHANGED' and pg_temp.credit(-9711) = 0);
  j := pg_temp.rpc(pg_temp.edit_sql(166, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)), '{}', '{"net_amount": 0}')));
  perform pg_temp.ok('16 edit stores its own net, not the one sent',
    j ->> 'excess' is null and (pg_temp.bill(b)).net_amount = 1000 and pg_temp.credit(-9711) = 0);
  r := pg_temp.as_admin(pg_temp.edit_sql(167, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)),
    '{"excess": {"mode": "store_credit", "amount": -5}}')));
  perform pg_temp.ok('16 edit refuses a negative excess amount', r = 'BILL_BAD_PAYLOAD');
  r := pg_temp.as_admin(pg_temp.edit_sql(168, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)), '{}', '{"totalamount": "NaN"}')));
  perform pg_temp.ok('16 edit refuses a total that is not a number', r = 'BILL_BAD_PAYLOAD');

  -- bill_save: a negative credit used raised the net, so 1600 was taken on a 1000 bill (and
  -- bill_cancel to store credit then gave 1600).
  select count(*) into bills_before from public.bills where customerid = -9711;
  r := pg_temp.as_admin_detail(pg_temp.create_sql(170, 'finalize_create',
    '{"store_credit_used": -500, "payment_amount": 1600}'));
  perform pg_temp.ok('16 finalize_create refuses store_credit_used -500',
    r = 'BILL_BAD_PAYLOAD: store_credit_used must be 0 or more');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(171, 'finalize_create',
    '{"exchange_credit_used": -500, "payment_amount": 1600}'));
  perform pg_temp.ok('16 finalize_create refuses exchange_credit_used -500',
    r = 'BILL_BAD_PAYLOAD: exchange_credit_used must be 0 or more');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(172, 'finalize_create', '{"payment_amount": -50}'));
  perform pg_temp.ok('16 finalize_create refuses payment_amount -50',
    r = 'BILL_BAD_PAYLOAD: payment_amount must be 0 or more');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(173, 'finalize_create', '{"exchange_cash_refund": -500}'));
  perform pg_temp.ok('16 finalize_create refuses exchange_cash_refund -500',
    r = 'BILL_BAD_PAYLOAD: exchange_cash_refund must be 0 or more');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(174, 'finalize_create', '{}',
    '{"exchange_balance_to_credit": -500}'));
  perform pg_temp.ok('16 finalize_create refuses exchange_balance_to_credit -500',
    r = 'BILL_BAD_PAYLOAD: exchange_balance_to_credit must be 0 or more');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(175, 'finalize_create', '{"totalamount": -1000, "payment_amount": 0}'));
  perform pg_temp.ok('16 finalize_create refuses totalamount -1000',
    r = 'BILL_BAD_PAYLOAD: totalamount must be 0 or more');
  r := pg_temp.as_admin(pg_temp.create_sql(176, 'finalize_create', '{"totalamount": "Infinity", "payment_amount": 9000}'));
  perform pg_temp.ok('16 finalize_create refuses an infinite total', r = 'BILL_BAD_PAYLOAD');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(177, 'partial_create', '{"net_amount": -5, "payment_amount": 0}'));
  perform pg_temp.ok('16 partial_create refuses net_amount -5',
    r = 'BILL_BAD_PAYLOAD: net_amount must be 0 or more');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(178, 'partial_create', '{"payment_amount": -10}',
    '{"first_payment": {"amount": -10, "salesmethodid": -9701}}'));
  perform pg_temp.ok('16 partial_create refuses a negative first payment',
    r = 'BILL_BAD_PAYLOAD: payment_amount must be 0 or more');
  -- A net sent above the lines' let a part-paid bill record 8000 received on 1000.
  r := pg_temp.as_admin(pg_temp.create_sql(179, 'partial_create', '{"net_amount": 9000, "payment_amount": 8000}',
    '{"first_payment": {"amount": 8000, "salesmethodid": -9701}}'));
  perform pg_temp.ok('16 partial_create ignores a sent net of 9000 on 1000: overpaid', r = 'BILL_OVERPAID');
  r := pg_temp.as_admin(pg_temp.create_sql(180, 'finalize_create', '{"net_amount": 9000, "payment_amount": 9000}'));
  perform pg_temp.ok('16 finalize_create ignores a sent net of 9000 on 1000: overpaid', r = 'BILL_OVERPAID');
  perform pg_temp.ok('16 nothing refused was saved',
    (select count(*) from public.bills where customerid = -9711) = bills_before
    and pg_temp.credit(-9711) = 0);
  -- A sent net below it is not stored either: the bill keeps what the lines come to.
  j := pg_temp.rpc(pg_temp.create_sql(181, 'partial_create', '{"net_amount": 5, "payment_amount": 400}',
    '{"first_payment": {"amount": 400, "salesmethodid": -9701}}'));
  perform pg_temp.ok('16 partial_create stores its own net', (pg_temp.bill((j ->> 'billid')::int)).net_amount = 1000);

  -- The draft ops, the same.
  d := pg_temp.draft(-9711);
  r := pg_temp.as_admin_detail(pg_temp.save_sql(182, 'finalize_draft', pg_temp.finish(d, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
    '{"customerid": -9711, "store_credit_used": -500, "payment_amount": 1600}')));
  perform pg_temp.ok('16 finalize_draft refuses store_credit_used -500',
    r = 'BILL_BAD_PAYLOAD: store_credit_used must be 0 or more' and (pg_temp.bill(d)).paymentstatus = 'draft');
  r := pg_temp.as_admin(pg_temp.save_sql(183, 'partial_draft', pg_temp.finish(d, 'partial',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)),
    '{"first_payment": {"amount": 8000, "salesmethodid": -9701}}',
    '{"customerid": -9711, "net_amount": 9000, "payment_amount": 8000}')));
  perform pg_temp.ok('16 partial_draft ignores a sent net of 9000 on 1000: overpaid',
    r = 'BILL_OVERPAID' and (pg_temp.bill(d)).paymentstatus = 'draft');
  -- A total above what the lines add up to (plus a rupee) raised the net and what could be received.
  r := pg_temp.as_admin_detail(pg_temp.create_sql(185, 'finalize_create', '{"totalamount": 5000, "payment_amount": 5000}'));
  perform pg_temp.ok('16 finalize_create refuses a total above its lines',
    r = 'BILL_BAD_PAYLOAD: totalamount is more than the lines add up to');
  r := pg_temp.as_admin_detail(pg_temp.create_sql(186, 'partial_create', '{"totalamount": 5000, "payment_amount": 4000}',
    '{"first_payment": {"amount": 4000, "salesmethodid": -9701}}'));
  perform pg_temp.ok('16 partial_create refuses a total above its lines',
    r = 'BILL_BAD_PAYLOAD: totalamount is more than the lines add up to');
  perform pg_temp.ok('16 a total a rupee over its lines is rounding',
    pg_temp.as_admin(pg_temp.create_sql(187, 'finalize_create', '{"totalamount": 1001, "payment_amount": 1001}')) = 'ok');
  r := pg_temp.as_admin_detail(pg_temp.save_sql(188, 'finalize_draft', pg_temp.finish(d, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}',
    '{"customerid": -9711, "totalamount": 5000, "payment_amount": 5000}')));
  perform pg_temp.ok('16 finalize_draft refuses a total above its lines',
    r = 'BILL_BAD_PAYLOAD: totalamount is more than the lines add up to' and (pg_temp.bill(d)).paymentstatus = 'draft');
  r := pg_temp.as_admin_detail(pg_temp.save_sql(189, 'partial_draft', pg_temp.finish(d, 'partial',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)),
    '{"first_payment": {"amount": 4000, "salesmethodid": -9701}}',
    '{"customerid": -9711, "totalamount": 5000, "payment_amount": 4000}')));
  perform pg_temp.ok('16 partial_draft refuses a total above its lines',
    r = 'BILL_BAD_PAYLOAD: totalamount is more than the lines add up to' and (pg_temp.bill(d)).paymentstatus = 'draft');
  b := pg_temp.sold(190, 1, 1000, '{}', '{"customerid": -9711}');
  r := pg_temp.as_admin_detail(pg_temp.edit_sql(191, b, pg_temp.edit(b, 5000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1)), '{}', '{"salesmethodid": -9701, "payment_amount": 5000}')));
  perform pg_temp.ok('16 edit refuses a total above its lines',
    r = 'BILL_BAD_PAYLOAD: totalamount is more than the lines add up to'
    and (pg_temp.bill(b)).payment_amount = 1000 and (pg_temp.bill(b)).totalamount = 1000);
  r := pg_temp.as_admin_detail(pg_temp.edit_sql(192, b, pg_temp.edit(b, 5000, null, '{}',
    '{"salesmethodid": -9701, "payment_amount": 5000}') - 'items' - 'salesperson_ids' - 'skip_stock'));
  perform pg_temp.ok('16 edit without items refuses a total above the saved lines',
    r = 'BILL_BAD_PAYLOAD: totalamount is more than the lines add up to' and (pg_temp.bill(b)).payment_amount = 1000);

  -- A key the draft op leaves out is checked as the draft holds it.
  update public.bills set exchange_cash_refund = -500 where billid = d;
  r := pg_temp.as_admin(pg_temp.save_sql(184, 'finalize_draft', pg_temp.finish(d, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 1)), '{}', '{"customerid": -9711}')));
  perform pg_temp.ok('16 finalize_draft refuses the draft''s own negative exchange_cash_refund',
    r = 'BILL_BAD_PAYLOAD' and (pg_temp.bill(d)).paymentstatus = 'draft');
end $$;

-- ---------- 17. stock choice, cancelled lines, credit customer and discount use are the bill's ----------
-- Steps after a refusal run through as_admin, so a refusal missing shows as a failed check, not an abort.
create function pg_temp.newc(p_id int, p_credit numeric) returns int language sql as $$
  insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (p_id, 'DFINFIXTURE' || lpad((-p_id)::text, 15, '0'), 'DFIN 17', p_credit) returning customerid
$$;
create function pg_temp.cancel_sql(p_key int, p_b int, p_mode text) returns text language sql as $$
  select format('select public.bill_cancel(%L, %s, %L, %L)', pg_temp.k(p_key), p_b, p_mode,
    jsonb_build_object('expect', (select jsonb_build_object('finalized', finalized, 'paymentstatus', paymentstatus)
                                    from public.bills where billid = p_b)))
$$;

-- H6: skip_stock switched between edits made stock. 1 -> 5 with skip_stock moved nothing, 5 -> 1
-- without it gave back 4, and cancel gave back nothing more: 3 created.
do $$
declare
  s0 numeric := pg_temp.stock(pg_temp.v1());
  b int := pg_temp.sold(200, 1, 1000, '{}', '{"customerid": -9702}');
  r text;
begin
  r := pg_temp.as_admin(pg_temp.edit_sql(201, b, pg_temp.edit(b, 5000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 5, 5000)), '{"skip_stock": true}')));
  perform pg_temp.ok('17 H6 skip_stock on an edit of a stock-taking bill refused',
    r = 'BILL_BAD_PAYLOAD' and pg_temp.lines(b) = jsonb_build_array(jsonb_build_array(pg_temp.v1(), 1)));
  r := pg_temp.as_admin(pg_temp.edit_sql(202, b, pg_temp.edit(b, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v1(), 1, 1000)))));
  perform pg_temp.as_admin(pg_temp.cancel_sql(203, b, 'return_payment'));
  perform pg_temp.ok('17 H6 sell, edit, cancel leaves stock as it was',
    (pg_temp.bill(b)).paymentstatus = 'cancelled' and pg_temp.stock(pg_temp.v1()) = s0);
end $$;

-- Nor can stock_reduced be flipped by a direct write (section 8 granted the table): a draft saved
-- without stock and then marked stock_reduced would have bill_cancel give back its lines.
do $$
declare
  d int := pg_temp.draft(-9702, 1, false);
begin
  perform pg_temp.ok('17 stock_reduced cannot be changed directly', pg_temp.as_admin(format(
    'update public.bills set stock_reduced = true where billid = %s', d)) = 'BILL_MONEY_DIRECT'
    and (pg_temp.bill(d)).stock_reduced is false);
end $$;

-- H7: a draft that took 1 finished with skip_stock and 5, then cancelled, gave back 5: 4 created.
do $$
declare
  s0 numeric := pg_temp.stock(pg_temp.v1());
  d int := pg_temp.draft(-9702, 1);
  r text;
begin
  r := pg_temp.as_admin(pg_temp.save_sql(204, 'finalize_draft', pg_temp.finish(d, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 5, 5000)), '{"skip_stock": true}',
    '{"customerid": -9702, "totalamount": 5000, "payment_amount": 5000}')));
  perform pg_temp.ok('17 H7 finish with skip_stock on a draft that took stock refused',
    r = 'BILL_BAD_PAYLOAD' and (pg_temp.bill(d)).paymentstatus = 'draft');
  perform pg_temp.as_admin(pg_temp.save_sql(205, 'finalize_draft', pg_temp.finish(d, 'finalized',
    jsonb_build_array(pg_temp.line(pg_temp.line_id(d), pg_temp.v1(), 5, 5000)), '{}',
    '{"customerid": -9702, "totalamount": 5000, "payment_amount": 5000}')));
  perform pg_temp.ok('17 H7 finish takes the 4 added', pg_temp.stock(pg_temp.v1()) = s0 - 5);
  perform pg_temp.as_admin(pg_temp.cancel_sql(206, d, 'return_payment'));
  perform pg_temp.ok('17 H7 draft, finish, cancel leaves stock as it was', pg_temp.stock(pg_temp.v1()) = s0);
end $$;

-- H8: bill_edit on a cancelled bill, every column sent back as it is, rewrote its lines and stock.
do $$
declare
  b int := pg_temp.sold(207, 1, 1000, '{}', '{"customerid": -9702}');
  s1 numeric;
  r text;
  p jsonb;
  li int;
begin
  li := pg_temp.line_id(b);
  perform pg_temp.as_admin(pg_temp.cancel_sql(208, b, 'return_payment'));
  -- As on production, where staff write lines directly for drafts.
  grant select, insert, update, delete on public.bill_items to authenticated;
  s1 := pg_temp.stock(pg_temp.v1());
  p := (select jsonb_build_object(
          'expect', jsonb_build_object('paymentstatus', x.paymentstatus, 'payment_amount', x.payment_amount),
          'bill', jsonb_build_object('customerid', x.customerid, 'notes', x.notes, 'totalamount', x.totalamount,
            'gst_total', x.gst_total, 'discount_total', x.discount_total, 'taxable_total', x.taxable_total,
            'net_amount', x.net_amount, 'applied_codes', to_jsonb(x.applied_codes), 'payment_amount', x.payment_amount,
            'final_amount', x.final_amount, 'saleslocationid', x.saleslocationid, 'salesmethodid', x.salesmethodid,
            'paymentstatus', x.paymentstatus, 'finalized', x.finalized, 'store_credit_used', x.store_credit_used,
            'orderdate', x.orderdate),
          'items', jsonb_build_array(pg_temp.line(li, pg_temp.v1(), 1) || '{"quantity": 0.5}'),
          'salesperson_ids', '[]'::jsonb, 'skip_stock', false)
        from public.bills x where x.billid = b);
  r := pg_temp.as_admin(pg_temp.edit_sql(209, b, p));
  perform pg_temp.ok('17 H8 bill_edit on a cancelled bill refused',
    r = 'BILL_BAD_TRANSITION' and (select quantity from public.bill_items where bill_item_id = li) = 1
    and pg_temp.stock(pg_temp.v1()) = s1);
  perform pg_temp.ok('17 H8 a cancelled bill''s line cannot be updated',
    pg_temp.as_admin(format('update public.bill_items set quantity = 0.5 where bill_item_id = %s', li)) = 'BILL_BAD_TRANSITION');
  perform pg_temp.ok('17 H8 nor deleted',
    pg_temp.as_admin(format('delete from public.bill_items where bill_item_id = %s', li)) = 'BILL_BAD_TRANSITION');
  perform pg_temp.ok('17 H8 nor a line added',
    pg_temp.as_admin(format('insert into public.bill_items (billid, quantity, mrp, product_name, subtotal, gst_amount, total) '
                            'values (%s, 1, 1000, %L, 1000, 0, 1000)', b, 'DFIN item')) = 'BILL_BAD_TRANSITION');
end $$;

-- H9: customer swapped on a bill paid with exchange credit whose balance went to store credit.
-- Cancel took the balance back from the new customer while the first kept it.
do $$
declare
  x int := pg_temp.newc(-9721, 0);
  y int := pg_temp.newc(-9722, 500);
  a int;
  b int;
  e int;
  r text;
begin
  a := pg_temp.sold(210, 1, 1000, '{}', jsonb_build_object('customerid', x));
  perform pg_temp.as_admin(format('select public.exchange_record(%s, %s, %L)', a, x,
    jsonb_build_array(jsonb_build_object('bill_item_id', pg_temp.line_id(a), 'quantity', 1, 'credit_amount', 1000))));
  select max(exchangeid) into e from public.exchanges where customerid = x;
  b := (pg_temp.rpc(pg_temp.create_sql(211, 'finalize_create',
         jsonb_build_object('customerid', x, 'totalamount', 500, 'exchange_credit_used', 500, 'payment_amount', 0),
         jsonb_build_object('exchange_ids', jsonb_build_array(e), 'exchange_balance_to_credit', 500,
                            'items', jsonb_build_array(pg_temp.line(null, pg_temp.v2(), 1, 500) - 'bill_item_id')))) ->> 'billid')::int;
  perform pg_temp.ok('17 H9 balance put on the first customer''s credit', pg_temp.credit(x) = 500);
  r := pg_temp.as_admin(pg_temp.edit_sql(212, b, pg_temp.edit(b, 500,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(b), pg_temp.v2(), 1, 500)), '{}',
    jsonb_build_object('customerid', y, 'totalamount', 500))));
  perform pg_temp.ok('17 H9 customer swap on a bill paid with exchange credit refused',
    r = 'BILL_CREDIT_CUSTOMER' and (pg_temp.bill(b)).customerid = x);
  perform pg_temp.as_admin(pg_temp.cancel_sql(213, b, 'return_payment'));
  perform pg_temp.ok('17 H9 cancel takes the balance back from the customer who got it',
    pg_temp.credit(x) = 0 and pg_temp.credit(y) = 500
    and (select new_billid is null from public.exchanges where exchangeid = e));

  -- An edit's excess put on store credit ties the bill to that customer too.
  a := pg_temp.sold(214, 2, 2000, '{}', jsonb_build_object('customerid', x));
  perform pg_temp.as_admin(pg_temp.edit_sql(215, a, pg_temp.edit(a, 1000,
    jsonb_build_array(pg_temp.line(pg_temp.line_id(a), pg_temp.v1(), 1, 1000)),
    '{"excess": {"mode": "store_credit", "amount": 1000}}')));
  perform pg_temp.ok('17 H9 customer swap after excess credit refused',
    pg_temp.as_admin(pg_temp.edit_sql(216, a, pg_temp.edit(a, 1000,
      jsonb_build_array(pg_temp.line(pg_temp.line_id(a), pg_temp.v1(), 1, 1000)), '{}',
      jsonb_build_object('customerid', y)))) = 'BILL_CREDIT_CUSTOMER');
  -- A plain cash bill can still change customer.
  a := pg_temp.sold(217, 1, 1000, '{}', jsonb_build_object('customerid', x));
  perform pg_temp.ok('17 H9 customer change on a cash bill still allowed',
    pg_temp.as_admin(pg_temp.edit_sql(218, a, pg_temp.edit(a, 1000,
      jsonb_build_array(pg_temp.line(pg_temp.line_id(a), pg_temp.v1(), 1, 1000)), '{}',
      jsonb_build_object('customerid', y)))) = 'ok' and (pg_temp.bill(a)).customerid = y);
end $$;


select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _df_checks;
rollback;
