-- Tests for schema/migration_voucher_states.sql. The whole file is one transaction that always
-- rolls back, it creates its own fixtures, and its final select returns only pass and fail counts.
-- A failed check also raises a WARNING naming that check.
-- Run locally (orders and the online hold/pay functions come from the online orders migrations):
--   scripts/test-db.sh up
--   scripts/test-db.sh sql <the migrations listed in schema/test_online_orders_holds.sql> \
--     schema/migration_bill_save.sql schema/migration_bill_stock_reduced.sql \
--     schema/migration_bill_cancel.sql schema/migration_bill_cancel_exchange_payout.sql \
--     schema/migration_bill_save_app_callers.sql schema/migration_bill_cancel_marker.sql \
--     schema/migration_bill_status_states.sql schema/migration_bill_add_payment.sql \
--     schema/migration_bill_payments_ledger.sql \
--     schema/migration_voucher_states.sql schema/test_voucher_states.sql
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local client_min_messages = warning;
-- A direct session: no API caller. pg_temp.as_authenticated switches in and out of one.
set local request.jwt.claims = '{}';

create temp table _vs_checks (label text not null, passed boolean not null) on commit drop;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _vs_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

-- 'ok', the error name (VOUCHER_BAD_TRANSITION and the like), or the SQLSTATE. The error
-- undoes only this statement.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return case when sqlerrm ~ '^[A-Z_]+$' then sqlerrm else sqlstate end;
end $$;

-- Like try, then runs the checks a commit would (the deferred vouchers_release_guard): this file
-- never commits, so without this a release would never be checked.
create function pg_temp.try_commit(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  set constraints public.vouchers_release_guard immediate;
  set constraints public.vouchers_release_guard deferred;
  return 'ok';
exception when others then
  return case when sqlerrm ~ '^[A-Z_]+$' then sqlerrm else sqlstate end;
end $$;

-- Runs p_sql in the authenticated role, the way PostgREST runs a signed-in caller (staff use
-- this role too). The claims carry no user, so the staff check in the RPCs fails. An error
-- undoes the role and claims with the statement.
create function pg_temp.as_authenticated(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return 'ok';
exception when others then
  return case when sqlerrm ~ '^[A-Z_]+$' then sqlerrm else sqlstate end;
end $$;

create function pg_temp.state(p_voucher text) returns text language sql as $$
  select public.voucher_state(v) from public.vouchers v where v.voucher_id = p_voucher
$$;

create function pg_temp.bill(p_status text default 'finalized') returns int language sql as $$
  insert into public.bills (paymentstatus, finalized, notes)
  values (p_status, p_status <> 'draft', 'VSTATE fixture')
  returning billid
$$;

create function pg_temp.voucher(p_code text) returns public.vouchers language sql as $$
  select * from public.vouchers where voucher_id = p_code
$$;

-- Fixture only: writes a row the triggers would refuse, to set up a state.
create function pg_temp.force(p_sql text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute p_sql;
  set local session_replication_role = origin;
end $$;

-- One line at 1000 with 99 shipping, part paid by the voucher, as the storefront quotes it.
create function pg_temp.order_with(p_voucher text) returns public.orders language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  pid text := 'VS' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_value numeric;
  r record;
  o public.orders;
begin
  insert into public.categories (categoryid, name) values ('Kurti', 'Kurti') on conflict do nothing;
  insert into public.products (productid, name, categoryid, purchaseprice, retailprice)
  values (pid, 'Test Kurti', 'Kurti', 500, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values (pid, 'M', 'Red', 5, v);
  select least(value, 1099) into v_value from public.vouchers where voucher_id = p_voucher;
  select * into r from public.online_order_create(
    jsonb_build_object(
      'contact', jsonb_build_object('name', 'Test Shopper', 'phone', '+919800000001', 'email', 'shopper@example.com'),
      'address', jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh',
                                    'pincode', '201001'),
      'voucher_code', p_voucher, 'subtotal', 1000, 'promo_discount', 0, 'shipping', 99,
      'voucher_applied', v_value, 'credit_applied', 0, 'gateway_amount', 1099 - v_value),
    jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 1000,
                                         'promo_share', 0, 'credit_part', least(v_value, 1000))),
    null);
  select * into o from public.orders where id = r.order_id;
  return o;
end $$;

create function pg_temp.pay(o public.orders) returns jsonb language sql as $$
  select public.online_order_confirm_payment(o.order_ref, 'cfpay_' || o.order_ref, o.gateway_amount, 'INR')
$$;

update public.storefront_settings set checkout_live = true where id = 1;
insert into public.vouchers (voucher_id, expiry_date, value, source) values
  ('VSTATE-A', current_date + 30, 300, 'online_refund'),
  ('VSTATE-OLD', current_date - 1, 300, 'online_refund'),
  ('VSTATE-H', current_date + 30, 300, 'online_refund'),
  ('VSTATE-H2', current_date + 30, 300, 'online_refund'),
  ('VSTATE-HX', current_date + 30, 300, 'online_refund'),
  ('VSTATE-N', current_date + 30, 300, 'online_refund'),
  ('VSTATE-I', current_date + 30, 300, 'online_refund'),
  ('VSTATE-R', current_date + 30, 300, 'online_refund'),
  ('VSTATE-C', current_date + 30, 300, 'online_refund'),
  ('VSTATE-F', current_date + 30, 300, 'online_refund'),
  ('VSTATE-P', current_date + 30, 300, 'online_refund'),
  ('VSTATE-Q', current_date + 30, 300, 'online_refund');
insert into public.customers (customerid, customer_ulid, first_name) values (-9301, 'VSTATEFIXTURE0000000000001', 'Fixture');

-- ---------- the checks hold even for a write the trigger does not see ----------
do $$
begin
  perform pg_temp.ok('redeemed without redeemed_at refused', pg_temp.try(format('select pg_temp.force(%L)', $q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_billid)
    values ('VSTATE-X1', current_date + 1, 1, true, (select pg_temp.bill()))$q$)) = '23514');
  perform pg_temp.ok('redeemed with neither bill nor order refused', pg_temp.try(format('select pg_temp.force(%L)', $q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_at)
    values ('VSTATE-X2', current_date + 1, 1, true, now())$q$)) = '23514');
  perform pg_temp.ok('bill link on an unredeemed voucher refused', pg_temp.try(format('select pg_temp.force(%L)', $q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed_billid)
    values ('VSTATE-X3', current_date + 1, 1, (select pg_temp.bill()))$q$)) = '23514');
  perform pg_temp.ok('redeemed_at on an unredeemed voucher refused', pg_temp.try(format('select pg_temp.force(%L)', $q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed_at)
    values ('VSTATE-X4', current_date + 1, 1, now())$q$)) = '23514');
  perform pg_temp.ok('redeemed null refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed)
    values ('VSTATE-X5', current_date + 1, 1, null)$q$) = '23502');
end $$;

-- ---------- hole 3: a new voucher is unspent and unheld ----------
do $$
declare
  o public.orders := pg_temp.order_with('VSTATE-I');
begin
  perform pg_temp.ok('insert as redeemed by a bill refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_at, redeemed_billid)
    values ('VSTATE-X6', current_date + 1, 1, true, now(), (select pg_temp.bill()))$q$) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('insert as held refused', pg_temp.try(format($q$
    insert into public.vouchers (voucher_id, expiry_date, value, held_order_id)
    values ('VSTATE-X7', current_date + 1, 1, %L)$q$, o.id)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('insert as held and expired refused', pg_temp.try(format($q$
    insert into public.vouchers (voucher_id, expiry_date, value, held_order_id)
    values ('VSTATE-X8', current_date - 1, 1, %L)$q$, o.id)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('insert as redeemed online with another bill refused', pg_temp.try(format($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_at, held_order_id, redeemed_billid)
    values ('VSTATE-X9', current_date + 1, 1, true, now(), %L, (select pg_temp.bill()))$q$, o.id))
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('insert as expired allowed', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value) values ('VSTATE-X10', current_date - 1, 1)$q$) = 'ok');
end $$;

-- ---------- voucher_state ----------
do $$
begin
  perform pg_temp.ok('state available', pg_temp.state('VSTATE-A') = 'available');
  perform pg_temp.ok('state expired', pg_temp.state('VSTATE-OLD') = 'expired');
  perform public.voucher_redeem('VSTATE-R', pg_temp.bill());
  perform pg_temp.ok('state redeemed', pg_temp.state('VSTATE-R') = 'redeemed');
end $$;

-- ---------- in store: available -> redeemed (bill) ----------
do $$
declare
  b1 int := pg_temp.bill();
  b2 int := pg_temp.bill();
begin
  perform pg_temp.ok('voucher_redeem with no bill raises, never redeems nowhere',
    pg_temp.try('select public.voucher_redeem(''VSTATE-A'', null)') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('still available after the refused redeem', pg_temp.state('VSTATE-A') = 'available');

  perform pg_temp.ok('voucher_redeem redeems an available voucher', public.voucher_redeem('VSTATE-A', b1));
  perform pg_temp.ok('redeemed against b1', (select redeemed and redeemed_billid = b1 and redeemed_at is not null
      and held_order_id is null from public.vouchers where voucher_id = 'VSTATE-A'));
  perform pg_temp.ok('second voucher_redeem refused', not public.voucher_redeem('VSTATE-A', b2));
  perform pg_temp.ok('moving the redemption to another bill refused', pg_temp.try(format(
    'update public.vouchers set redeemed_billid = %s where voucher_id = ''VSTATE-A''', b2)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('re-stamping redeemed_at refused', pg_temp.try(
    'update public.vouchers set redeemed_at = now() - interval ''1 day'' where voucher_id = ''VSTATE-A''')
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('editing the note of a redeemed voucher allowed', pg_temp.try(
    'update public.vouchers set note = ''checked'' where voucher_id = ''VSTATE-A''') = 'ok');
  perform pg_temp.ok('half an undo (flag only) refused', pg_temp.try(
    'update public.vouchers set redeemed = false where voucher_id = ''VSTATE-A''') = '23514');
end $$;

-- ---------- hole 1: a live bill's voucher is never freed ----------
do $$
declare
  b1 int := (select redeemed_billid from public.vouchers where voucher_id = 'VSTATE-A');
  b2 int := pg_temp.bill();
begin
  perform pg_temp.ok('staff have no direct write on vouchers',
    not has_table_privilege('authenticated', 'public.vouchers', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.vouchers', 'INSERT')
    and not has_table_privilege('authenticated', 'public.vouchers', 'DELETE')
    and has_table_privilege('authenticated', 'public.vouchers', 'SELECT'));
  perform pg_temp.ok('a direct release through the API refused', pg_temp.as_authenticated(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
      where voucher_id = ''VSTATE-A'' and redeemed_billid = %s', b1)) = '42501');
  -- The old billing screen undo, written by a function: refused at commit while b1 stands.
  perform pg_temp.ok('releasing a finalized bill''s voucher refused at commit', pg_temp.try_commit(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
      where voucher_id = ''VSTATE-A'' and redeemed_billid = %s', b1)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('still spent on b1', (pg_temp.voucher('VSTATE-A')).redeemed_billid = b1);
  perform pg_temp.ok('so it cannot pay a second bill', not public.voucher_redeem('VSTATE-A', b2));
  perform pg_temp.ok('voucher_release refuses a finalized bill', pg_temp.try_commit(format(
    'select public.voucher_release(''VSTATE-A'', %s)', b1)) = 'VOUCHER_RELEASE_REFUSED');
  perform pg_temp.ok('a partial bill counts as live', pg_temp.try_commit(format(
    'with b as (update public.bills set paymentstatus = ''partial'' where billid = %1$s returning billid)
     update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
      where redeemed_billid = (select billid from b)', b1)) = 'VOUCHER_BAD_TRANSITION');
end $$;

-- ---------- releases that are allowed: cancelled, discarded, draft ----------
do $$
declare
  b1 int := (select redeemed_billid from public.vouchers where voucher_id = 'VSTATE-A');
  bc int := pg_temp.bill();
  bn int := pg_temp.bill();
  d int := pg_temp.bill('draft');
  r text;
begin
  -- bill_cancel frees the voucher before it marks the bill cancelled; the commit check passes.
  update public.bills set customerid = -9301 where billid = bc;
  perform public.voucher_redeem('VSTATE-C', bc);
  r := pg_temp.try_commit(format(
    $q$select public.bill_cancel(gen_random_uuid(), %s, 'return_payment',
       '{"expect": {"finalized": true, "paymentstatus": "finalized"}, "restore_older_stock": true}')$q$, bc));
  perform pg_temp.ok('bill_cancel releases its voucher and passes the commit check', r = 'ok'
    and pg_temp.state('VSTATE-C') = 'available'
    and (select paymentstatus from public.bills where billid = bc) = 'cancelled');
  -- Fixture: only bill_cancel may mark a bill cancelled (schema/migration_bill_cancel_marker.sql),
  -- so set the marker it sets.
  perform set_config('app.bill_cancel', 'on', true);
  update public.bills set paymentstatus = 'cancelled' where billid = b1;
  perform set_config('app.bill_cancel', '', true);
  r := pg_temp.try_commit(format('update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
      where redeemed_billid = %s', b1));
  perform pg_temp.ok('a cancelled bill''s voucher released by a function passes the commit check',
    r = 'ok' and pg_temp.state('VSTATE-A') = 'available');

  -- hole 2: never spent on a cancelled bill
  perform pg_temp.ok('voucher_redeem refuses a cancelled bill', pg_temp.try(format(
    'select public.voucher_redeem(''VSTATE-A'', %s)', bc)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('still available after redeem on a cancelled bill', pg_temp.state('VSTATE-A') = 'available');

  -- bill_discard: the billing screen abandoning a bill it just inserted
  perform public.voucher_redeem('VSTATE-A', bn);
  r := pg_temp.try_commit(format('select public.bill_discard(%s)', bn));
  perform pg_temp.ok('bill_discard frees the voucher and deletes the bill together', r = 'ok'
    and pg_temp.state('VSTATE-A') = 'available' and not exists (select 1 from public.bills where billid = bn));
  perform pg_temp.ok('bill_discard refuses a cancelled bill', pg_temp.try(format(
    'select public.bill_discard(%s)', bc)) = 'BILL_DISCARD_REFUSED');
  perform pg_temp.ok('bill_discard of a missing bill does nothing', pg_temp.try(format(
    'select public.bill_discard(%s)', bn)) = 'ok');

  -- hole 2: a draft's finalize redeems first; if marking it finalized fails, voucher_release
  perform pg_temp.ok('voucher_redeem allowed on a draft', public.voucher_redeem('VSTATE-A', d));
  r := pg_temp.try_commit(format('select public.voucher_release(''VSTATE-A'', %s)', d));
  perform pg_temp.ok('voucher_release frees a draft''s voucher', r = 'ok' and pg_temp.state('VSTATE-A') = 'available');
  perform public.voucher_redeem('VSTATE-A', d);
  perform pg_temp.ok('releasing a draft''s voucher, then finalizing it, refused at commit', pg_temp.try_commit(format(
    'with v as (update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
                 where redeemed_billid = %1$s returning 1)
     update public.bills set paymentstatus = ''finalized'', finalized = true
      where billid = %1$s and exists (select 1 from v)', d)) = 'VOUCHER_BAD_TRANSITION');
  r := pg_temp.as_authenticated(format('select public.voucher_release(''VSTATE-A'', %s)', d));
  perform pg_temp.ok('voucher_release by an API caller without staff rights refused',
    r = '42501' and pg_temp.state('VSTATE-A') = 'redeemed');
  perform public.voucher_release('VSTATE-A', d);
end $$;

-- ---------- hole 4: no delete, no edits once relied on ----------
do $$
declare
  o public.orders := pg_temp.order_with('VSTATE-F');
begin
  perform pg_temp.ok('deleting a redeemed voucher refused', pg_temp.try(
    'delete from public.vouchers where voucher_id = ''VSTATE-R''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('deleting a held voucher refused', pg_temp.try(
    'delete from public.vouchers where voucher_id = ''VSTATE-F''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('deleting an expired voucher allowed', pg_temp.try(
    'delete from public.vouchers where voucher_id = ''VSTATE-X10''') = 'ok');
  perform pg_temp.ok('raising a redeemed voucher''s value refused', pg_temp.try(
    'update public.vouchers set value = value + 100 where voucher_id = ''VSTATE-R''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('changing a held voucher''s value refused', pg_temp.try(
    'update public.vouchers set value = 5000 where voucher_id = ''VSTATE-F''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('extending a held voucher refused', pg_temp.try(
    'update public.vouchers set expiry_date = expiry_date + 365 where voucher_id = ''VSTATE-F''')
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('moving a redeemed voucher to another customer refused', pg_temp.try(
    'update public.vouchers set customerid = -9301 where voucher_id = ''VSTATE-R''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('renaming a redeemed voucher refused', pg_temp.try(
    'update public.vouchers set voucher_id = ''VSTATE-R2'' where voucher_id = ''VSTATE-R''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('changing an available voucher''s value allowed', pg_temp.try(
    'update public.vouchers set value = 301 where voucher_id = ''VSTATE-A''') = 'ok');
end $$;

-- ---------- expired never moves ----------
do $$
declare
  b int := pg_temp.bill();
begin
  perform pg_temp.ok('voucher_redeem refuses an expired voucher', not public.voucher_redeem('VSTATE-OLD', b));
  perform pg_temp.ok('direct redeem of an expired voucher refused', pg_temp.try(format(
    'update public.vouchers set redeemed = true, redeemed_at = now(), redeemed_billid = %s
      where voucher_id = ''VSTATE-OLD''', b)) = 'VOUCHER_BAD_TRANSITION');
end $$;

-- ---------- online: available -> held -> redeemed (online) -> bill linked ----------
do $$
declare
  o public.orders := pg_temp.order_with('VSTATE-H');
  o2 public.orders := pg_temp.order_with('VSTATE-H2');
  o3 public.orders := pg_temp.order_with('VSTATE-Q');
  b int := pg_temp.bill();
  b_other int := pg_temp.bill();
  d int := pg_temp.bill('draft');
  res jsonb;
begin
  perform pg_temp.ok('order holds the voucher', pg_temp.state('VSTATE-H') = 'held'
    and (select held_order_id from public.vouchers where voucher_id = 'VSTATE-H') = o.id);
  perform pg_temp.ok('voucher_redeem refuses a held voucher', not public.voucher_redeem('VSTATE-H', b));
  perform pg_temp.ok('direct bill redeem of a held voucher refused', pg_temp.try(format(
    'update public.vouchers set redeemed = true, redeemed_at = now(), redeemed_billid = %s
      where voucher_id = ''VSTATE-H''', b)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('moving a hold to another order refused', pg_temp.try(format(
    'update public.vouchers set held_order_id = %L where voucher_id = ''VSTATE-H''', o2.id))
    = 'VOUCHER_BAD_TRANSITION');

  perform pg_temp.ok('holding an expired voucher refused', pg_temp.try(format(
    'update public.vouchers set held_order_id = %L where voucher_id = ''VSTATE-OLD''', o2.id))
    = 'VOUCHER_BAD_TRANSITION');
  perform public.voucher_redeem('VSTATE-A', d);
  perform pg_temp.ok('a bill-redeemed voucher cannot be held', pg_temp.try(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null,
       held_order_id = %L where voucher_id = ''VSTATE-A''', o2.id)) = 'VOUCHER_BAD_TRANSITION');
  perform public.voucher_release('VSTATE-A', d);

  -- hole 3: a hold or an online redemption must match its order
  perform pg_temp.ok('holding for an order that names another voucher refused', pg_temp.try(format(
    'update public.vouchers set held_order_id = %L where voucher_id = ''VSTATE-P''', o2.id))
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('redeeming a held voucher while its order is unpaid refused', pg_temp.try(
    'update public.vouchers set redeemed = true, redeemed_at = now() where voucher_id = ''VSTATE-H2''')
    = 'VOUCHER_BAD_TRANSITION');
  perform public._online_release_holds(o3);
  perform pg_temp.ok('re-holding for its own pending order allowed', pg_temp.try(format(
    'update public.vouchers set held_order_id = %L where voucher_id = ''VSTATE-Q''', o3.id)) = 'ok');
  update public.orders set status = 'paid' where id = o3.id;
  perform pg_temp.ok('releasing the hold of a paid order refused', pg_temp.try(
    'update public.vouchers set held_order_id = null where voucher_id = ''VSTATE-Q''') = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.force('update public.vouchers set held_order_id = null where voucher_id = ''VSTATE-Q''');
  update public.orders set status = 'processing' where id = o3.id;
  perform pg_temp.ok('holding for an order past payment refused', pg_temp.try(format(
    'update public.vouchers set held_order_id = %L where voucher_id = ''VSTATE-Q''', o3.id))
    = 'VOUCHER_BAD_TRANSITION');

  res := pg_temp.pay(o);
  perform pg_temp.ok('payment confirmed: ' || res::text, res ->> 'result' in ('paid', 'ok', 'confirmed')
    or (select status from public.orders where id = o.id) = 'paid');
  perform pg_temp.ok('paid order redeemed the voucher, hold kept as the spender',
    (select redeemed and redeemed_at is not null and redeemed_billid is null and held_order_id = o.id
       from public.vouchers where voucher_id = 'VSTATE-H'));

  perform pg_temp.ok('undoing an online redemption refused', pg_temp.try(
    'update public.vouchers set redeemed = false, redeemed_at = null where voucher_id = ''VSTATE-H''')
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('dropping the spending order refused', pg_temp.try(format(
    'update public.vouchers set held_order_id = null, redeemed_billid = %s where voucher_id = ''VSTATE-H''', b))
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('releasing holds leaves a redeemed voucher alone', pg_temp.try(format(
    'select public._online_release_holds(o) from public.orders o where o.id = %L', o.id)) = 'ok'
    and pg_temp.state('VSTATE-H') = 'redeemed');

  update public.orders set bill_id = b where id = o.id;
  perform pg_temp.ok('linking a bill that is not the order''s refused', pg_temp.try(format(
    'update public.vouchers set redeemed_billid = %s where voucher_id = ''VSTATE-H''', b_other))
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('linking the order''s own bill allowed', pg_temp.try(format(
    'update public.vouchers set redeemed_billid = %s where voucher_id = ''VSTATE-H''', b)) = 'ok');
  perform pg_temp.ok('re-linking to another bill refused', pg_temp.try(format(
    'update public.vouchers set redeemed_billid = %s where voucher_id = ''VSTATE-H''', b_other))
    = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('bill_cancel style undo of the online bill''s voucher refused', pg_temp.try(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
      where redeemed_billid = %s', b)) = 'VOUCHER_BAD_TRANSITION');
  perform pg_temp.ok('deleting the spending order refused', pg_temp.try(format(
    'delete from public.orders where id = %L', o.id)) = 'VOUCHER_BAD_TRANSITION');
end $$;

-- ---------- held -> available / expired on release ----------
do $$
declare
  o public.orders := pg_temp.order_with('VSTATE-HX');
  o2 public.orders := pg_temp.order_with('VSTATE-N');
begin
  perform pg_temp.force('update public.vouchers set expiry_date = current_date - 1 where voucher_id = ''VSTATE-HX''');
  perform pg_temp.ok('a held voucher stays held past expiry', pg_temp.state('VSTATE-HX') = 'held');
  perform public._online_release_holds(o);
  perform pg_temp.ok('release after expiry leaves it expired', pg_temp.state('VSTATE-HX') = 'expired');
  perform public._online_release_holds(o2);
  perform pg_temp.ok('release makes it available', pg_temp.state('VSTATE-N') = 'available');
end $$;

-- ---------- held -> available when the order row is deleted (FK set null) ----------
do $$
declare
  o public.orders := pg_temp.order_with('VSTATE-N');
begin
  perform pg_temp.ok('held again by a new order', pg_temp.state('VSTATE-N') = 'held');
  perform pg_temp.ok('deleting an unpaid order frees its held voucher', pg_temp.try(format(
    'delete from public.orders where id = %L', o.id)) = 'ok'
    and pg_temp.state('VSTATE-N') = 'available');
end $$;

select count(*) filter (where passed) as pass, count(*) filter (where not passed) as fail from _vs_checks;
rollback;
