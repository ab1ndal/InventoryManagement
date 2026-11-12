-- Tests for schema/migration_voucher_states.sql. The whole file is one transaction that always
-- rolls back, it creates its own fixtures, and its final select returns only pass and fail counts.
-- A failed check also raises a WARNING naming that check.
-- Run locally (orders and the online hold/pay functions come from the online orders migrations):
--   scripts/test-db.sh up
--   scripts/test-db.sh sql <the migrations listed in schema/test_online_orders_holds.sql> \
--     schema/migration_bill_save.sql schema/migration_bill_stock_reduced.sql \
--     schema/migration_bill_cancel.sql schema/migration_bill_cancel_exchange_payout.sql \
--     schema/migration_voucher_states.sql schema/test_voucher_states.sql
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local client_min_messages = warning;

create temp table _vs_checks (label text not null, passed boolean not null) on commit drop;

create function pg_temp.ok(p_label text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into _vs_checks values (p_label, coalesce(p_cond, false));
  if p_cond is not true then
    raise warning 'FAIL: %', p_label;
  end if;
end $$;

-- 'ok', VOUCHER_BAD_TRANSITION, or the SQLSTATE. The error undoes only this statement.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return case when sqlerrm = 'VOUCHER_BAD_TRANSITION' then sqlerrm else sqlstate end;
end $$;

create function pg_temp.state(p_voucher text) returns text language sql as $$
  select public.voucher_state(v) from public.vouchers v where v.voucher_id = p_voucher
$$;

create function pg_temp.bill() returns int language sql as $$
  insert into public.bills (paymentstatus, finalized, notes) values ('finalized', true, 'VSTATE fixture')
  returning billid
$$;

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
  ('VSTATE-N', current_date + 30, 300, 'online_refund');

-- ---------- invalid combinations are refused on write ----------
do $$
begin
  perform pg_temp.ok('redeemed without redeemed_at refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_billid)
    values ('VSTATE-X1', current_date + 1, 1, true, (select pg_temp.bill()))$q$) = '23514');
  perform pg_temp.ok('redeemed with neither bill nor order refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_at)
    values ('VSTATE-X2', current_date + 1, 1, true, now())$q$) = '23514');
  perform pg_temp.ok('bill link on an unredeemed voucher refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed_billid)
    values ('VSTATE-X3', current_date + 1, 1, (select pg_temp.bill()))$q$) = '23514');
  perform pg_temp.ok('redeemed_at on an unredeemed voucher refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed_at)
    values ('VSTATE-X4', current_date + 1, 1, now())$q$) = '23514');
  perform pg_temp.ok('redeemed null refused', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed)
    values ('VSTATE-X5', current_date + 1, 1, null)$q$) = '23502');
  perform pg_temp.ok('a valid in-store redemption inserts', pg_temp.try($q$
    insert into public.vouchers (voucher_id, expiry_date, value, redeemed, redeemed_at, redeemed_billid)
    values ('VSTATE-X6', current_date + 1, 1, true, now(), (select pg_temp.bill()))$q$) = 'ok');
end $$;

-- ---------- voucher_state ----------
do $$
begin
  perform pg_temp.ok('state available', pg_temp.state('VSTATE-A') = 'available');
  perform pg_temp.ok('state expired', pg_temp.state('VSTATE-OLD') = 'expired');
  perform pg_temp.ok('state redeemed', pg_temp.state('VSTATE-X6') = 'redeemed');
end $$;

-- ---------- in store: available -> redeemed (bill) -> available ----------
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

  -- The billing screen's undo of a failed save, and bill_cancel, write exactly this.
  perform pg_temp.ok('undoing the bill redemption allowed', pg_temp.try(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
      where voucher_id = ''VSTATE-A'' and redeemed_billid = %s', b1)) = 'ok');
  perform pg_temp.ok('available again after the undo', pg_temp.state('VSTATE-A') = 'available');
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
  b int := pg_temp.bill();
  b_other int := pg_temp.bill();
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
  perform public.voucher_redeem('VSTATE-A', b_other);
  perform pg_temp.ok('a bill-redeemed voucher cannot be held', pg_temp.try(format(
    'update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null,
       held_order_id = %L where voucher_id = ''VSTATE-A''', o2.id)) = 'VOUCHER_BAD_TRANSITION');
  update public.vouchers set redeemed = false, redeemed_at = null, redeemed_billid = null
   where voucher_id = 'VSTATE-A';

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
  update public.vouchers set expiry_date = current_date - 1 where voucher_id = 'VSTATE-HX';
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
