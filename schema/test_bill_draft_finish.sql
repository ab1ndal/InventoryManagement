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

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _df_checks;
rollback;
