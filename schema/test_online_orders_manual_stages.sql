-- Tests for schema/migration_online_orders_manual_stages.sql (Porter and self-delivery: Process,
-- the stage ladder, cancel before pickup, mark delivered). Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_any_state.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/migration_online_orders_pickup.sql schema/migration_online_orders_porter.sql \
--     schema/migration_online_orders_holds.sql schema/migration_online_orders_hold_cap.sql \
--     schema/migration_online_orders_manual_stages.sql schema/test_online_orders_manual_stages.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- fixture helpers (pg_temp: vanish with the session) ----------
create function pg_temp.go_live() returns void language sql as $$
  update public.storefront_settings set checkout_live = true where id = 1;
$$;

create function pg_temp.mk_variant(p_price numeric, p_stock numeric, p_cat text default 'Kurti')
returns uuid language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  pid text := 'T' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  insert into public.categories (categoryid, name) values (left(p_cat, 10), p_cat) on conflict do nothing;
  insert into public.products (productid, name, categoryid, purchaseprice, retailprice)
  values (pid, 'Test ' || p_cat, left(p_cat, 10), p_price / 2, p_price);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values (pid, 'M', 'Red', p_stock, v);
  return v;
end $$;

-- Builds a quote the way the edge function would (greedy shares, which satisfy the
-- same invariants) and calls online_order_create.
-- p_lines: [{v: variant uuid, qty}]; p_opt: {phone, promo_code, voucher_code, credit, shipping,
-- attempt_key, token_hash, fulfilment, address}. Pickup defaults to ₹0 shipping and a contact-only address.
create function pg_temp.mk_order(p_lines jsonb, p_opt jsonb default '{}'::jsonb)
returns table (order_id uuid, order_ref text, created boolean) language plpgsql as $$
declare
  l record;
  d public.discounts;
  v_items jsonb := '[]'::jsonb;
  v_sub numeric := 0; v_promo numeric := 0; v_ship numeric; v_due numeric; v_goods numeric;
  v_vouch numeric := 0; v_credit numeric := coalesce((p_opt ->> 'credit')::numeric, 0);
  v_rem_p numeric; v_rem_c numeric; v_p numeric; v_c numeric; v_val numeric;
begin
  for l in select (e ->> 'v')::uuid as v, (e ->> 'qty')::int as q, p.retailprice as price
             from jsonb_array_elements(p_lines) e
             join public.productsizecolors psc on psc.variantid = (e ->> 'v')::uuid
             join public.products p on p.productid = psc.productid loop
    v_sub := v_sub + l.price * l.q;
  end loop;
  if p_opt ? 'promo_code' then
    select * into d from public.discounts where code = p_opt ->> 'promo_code';
    v_promo := public._promo_value(d, v_sub);
  end if;
  v_goods := v_sub - v_promo;
  v_ship := coalesce((p_opt ->> 'shipping')::numeric,
                     case when v_goods >= 5000 or p_opt ->> 'fulfilment' = 'pickup' then 0 else 99 end);
  v_due := v_goods + v_ship;
  if p_opt ? 'voucher_code' then
    select least(value, v_due) into v_vouch from public.vouchers where voucher_id = p_opt ->> 'voucher_code';
  end if;
  if p_opt ? 'voucher_applied' then v_vouch := (p_opt ->> 'voucher_applied')::numeric; end if;
  v_rem_p := v_promo;
  v_rem_c := least(v_vouch + v_credit, v_goods);
  for l in select (e ->> 'v')::uuid as v, (e ->> 'qty')::int as q, p.retailprice as price
             from jsonb_array_elements(p_lines) e
             join public.productsizecolors psc on psc.variantid = (e ->> 'v')::uuid
             join public.products p on p.productid = psc.productid loop
    v_val := l.price * l.q;
    v_p := least(v_rem_p, v_val); v_rem_p := v_rem_p - v_p;
    v_c := least(v_rem_c, v_val - v_p); v_rem_c := v_rem_c - v_c;
    v_items := v_items || jsonb_build_object('variant_id', l.v, 'qty', l.q, 'unit_price', l.price,
                                             'promo_share', v_p, 'credit_part', v_c);
  end loop;
  return query select * from public.online_order_create(
    jsonb_build_object(
      'attempt_key', p_opt ->> 'attempt_key',
      'contact', jsonb_build_object('name', 'Test Shopper', 'phone', coalesce(p_opt ->> 'phone', '+919800000001'),
                                    'email', 'shopper@example.com'),
      'address', coalesce(p_opt -> 'address', case when p_opt ->> 'fulfilment' = 'pickup'
        then jsonb_build_object('name', 'Test Shopper', 'phone', '+919800000001')
        else jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001') end),
      'fulfilment', p_opt ->> 'fulfilment',
      'promo_code', p_opt ->> 'promo_code', 'voucher_code', p_opt ->> 'voucher_code',
      'subtotal', v_sub, 'promo_discount', v_promo, 'shipping', v_ship, 'voucher_applied', v_vouch,
      'credit_applied', v_credit, 'gateway_amount', v_due - v_vouch - v_credit,
      'access_token_hash', p_opt ->> 'token_hash'),
    v_items, (p_opt ->> 'auth_user')::uuid);
end $$;

create function pg_temp.gw(p_ref text) returns numeric language sql as $$
  select gateway_amount from public.orders where order_ref = p_ref
$$;

create function pg_temp.pay(p_ref text) returns jsonb language sql as $$
  select public.online_order_confirm_payment(p_ref, 'cfpay_' || p_ref, pg_temp.gw(p_ref), 'INR')
$$;

create function pg_temp.stock(p_v uuid) returns numeric language sql as $$
  select stock from public.productsizecolors where variantid = p_v
$$;


create function pg_temp.jobs(p_order uuid) returns text[] language sql as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.order_jobs where order_id = p_order
$$;


-- A paid ship order of one variant (₹99 shipping below ₹5,000); p_avail (when given) is set as the shelf check.
create function pg_temp.paid_ship(p_v uuid, p_qty int, p_avail int default null) returns uuid language plpgsql as $$
declare
  r record;
begin
  perform pg_temp.go_live();
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', p_v, 'qty', p_qty)));
  perform pg_temp.pay(r.order_ref);
  if p_avail is not null then
    perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), p_avail, null);
  end if;
  return r.order_id;
end $$;

-- A paid ship order, shelf checked and processed by hand.
create function pg_temp.processed(p_v uuid, p_qty int, p_avail int, p_courier text default 'porter')
returns uuid language plpgsql as $$
declare
  p uuid := pg_temp.paid_ship(p_v, p_qty, p_avail);
begin
  perform public.online_order_manual_process(p, null, p_courier);
  return p;
end $$;

create function pg_temp.bills(p_order uuid) returns bigint language sql as $$
  select count(*) from public.bills b join public.orders o on b.notes = 'Online order ' || o.order_ref where o.id = p_order
$$;

create function pg_temp.shipped_jobs(p_order uuid) returns bigint language sql as $$
  select count(*) from public.order_jobs where order_id = p_order and kind = 'email_shipped'
$$;

create function pg_temp.events(p_order uuid, p_kind text) returns bigint language sql as $$
  select count(*) from public.order_events where order_id = p_order and kind = p_kind
$$;

create function pg_temp.status(p_order uuid) returns text language sql as $$
  select status from public.orders where id = p_order
$$;

create function pg_temp.refunded(p_order uuid) returns numeric language sql as $$
  select coalesce(sum(total_amount), 0) from public.order_refunds where order_id = p_order
$$;

create function pg_temp.shipping_legs(p_order uuid) returns bigint language sql as $$
  select count(*) from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
   where r.order_id = p_order and l.source in ('shipping_credit', 'shipping_gateway')
$$;

create function pg_temp.cancel(p_order uuid) returns uuid language plpgsql as $$
declare
  c jsonb := public.online_order_claim(p_order, 'cancel', null, 'k-cancel');
begin
  assert (c ->> 'claimed')::boolean, 'cancel claim refused: ' || c::text;
  assert c ->> 'status' = 'cancelling', 'claim moves it to cancelling';
  return public.online_order_cancel(p_order, null, 'customer asked');
end $$;

-- A Shiprocket order packed and billed, sent back to paid by a rebook (bill kept, attempt 2).
create function pg_temp.rebooked(p_v uuid, p_qty int) returns uuid language plpgsql as $$
declare
  p uuid := pg_temp.paid_ship(p_v, p_qty, p_qty);
begin
  perform public.online_order_claim(p, 'process', null, 'op-pack');
  perform public.online_order_prepare_process(p, null);
  perform public.online_order_checkpoint(p, 'awb', jsonb_build_object('awb', 'AWB' || left(p::text, 8), 'courier_id', 7, 'courier_name', 'Test Courier'), 'op-pack');
  perform public.online_order_checkpoint(p, 'label', '{"label_url":"https://x/label.pdf"}', 'op-pack');
  perform public.online_order_mark_packed(p, '{}'::jsonb, null, 'op-pack');
  perform public.online_order_apply_tracking((select awb from public.orders where id = p), 'shipped',
    '{"shipment_status_id":6,"shipment_status":"SHIPPED"}');
  perform public.online_order_claim(p, 'rebook', null, 'op-rb');
  perform public.online_order_checkpoint(p, 'sr_cancelled', '{}', 'op-rb');
  perform public.online_order_rebook(p, null, 'op-rb', false, 'box back from courier');
  return p;
end $$;

-- ===================================================================
-- constraints: new values added, every old value kept
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1);
  c text;
  s text;
begin
  foreach c in array array['shiprocket', 'porter', 'self'] loop
    update public.orders set courier = c where id = p;
  end loop;
  begin
    update public.orders set courier = 'dhl' where id = p;
    assert false, 'courier check';
  exception when check_violation then null;
  end;
  foreach s in array array['pending_payment', 'paid', 'processing', 'processed', 'cancelling', 'packed', 'shipped',
                           'out_for_delivery', 'delivered', 'payment_failed', 'expired', 'cancelled', 'rto',
                           'rto_received', 'ready_for_pickup'] loop
    assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'online_orders_status_check')
           like '%''' || s || '''%', 'status check keeps ' || s;
  end loop;
  begin
    update public.orders set status = 'nonsense' where id = p;
    assert false, 'status check';
  exception when check_violation then null;
  end;
end $$;
rollback;

-- ===================================================================
-- process: everything on the shelf
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_ship(v, 2, 2);
  j jsonb;
  j2 jsonb;
  o public.orders;
begin
  perform public.online_order_checkpoint(p, 'sr_create', '{"sr_order_id":"901","sr_shipment_id":"902"}');
  j := public.online_order_manual_process(p, null, 'porter');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'processed' and o.status = 'processed', j::text;
  assert (j ->> 'changed')::boolean and j ->> 'sr_order_id' = '901', 'first call: changed + sr order to cancel';
  assert j -> 'refund_id' = 'null'::jsonb and not (j ->> 'all_unavailable')::boolean, 'nothing refunded';
  assert o.courier = 'porter' and o.courier_name = 'Porter' and o.process_error is null, 'courier recorded';
  assert o.process_plan ->> 'courier' = 'porter' and jsonb_array_length(o.process_plan -> 'shippable_items') = 1, 'plan stored';
  assert o.bill_id is null and pg_temp.bills(p) = 0, 'no bill yet';
  assert (select shipped_qty from public.order_items where order_id = p) = 0, 'nothing shipped yet';
  assert pg_temp.shipped_jobs(p) = 0, 'no shipped email yet';
  assert (select from_status = 'paid' and to_status = 'processed' and data ->> 'courier' = 'porter' and data ? 'refund_id'
            from public.order_events where order_id = p and kind = 'processed'), 'event';
  assert public._order_public_json(o) -> 'tracking_url' = 'null'::jsonb, 'no tracking link';
  -- a repeat, even naming another courier, is the stored result
  j2 := public.online_order_manual_process(p, null, 'self');
  assert j2 - 'changed' - 'sr_order_id' = j - 'changed' - 'sr_order_id', 'repeat returns the stored result: ' || j2::text;
  assert not (j2 ->> 'changed')::boolean and j2 -> 'sr_order_id' = 'null'::jsonb, 'repeat: no second Shiprocket cancel';
  assert (select courier from public.orders where id = p) = 'porter', 'repeat keeps the courier';
  assert pg_temp.events(p, 'processed') = 1, 'one event';
end $$;
rollback;

-- self: courier name; partial shelf refunds at Process and a repeat does not refund twice
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_ship(v, 2, 1);
  j jsonb;
  j2 jsonb;
  o public.orders;
begin
  j := public.online_order_manual_process(p, null, 'self');
  select * into o from public.orders where id = p;
  assert o.status = 'processed' and o.courier = 'self' and o.courier_name = 'Bindal''s Creation', 'self: ' || o.courier_name;
  assert j -> 'sr_order_id' = 'null'::jsonb, 'no Shiprocket order yet';
  assert (select reason = 'unavailable' and units = 1 and total_amount = 1000
            from public.order_refunds where id = (j ->> 'refund_id')::uuid), 'one unit refunded, no shipping';
  assert pg_temp.stock(v) = 3, 'the missing unit is not restocked (it was never on the shelf)';
  j2 := public.online_order_manual_process(p, null, 'self');
  assert j2 ->> 'refund_id' = j ->> 'refund_id' and not (j2 ->> 'changed')::boolean, 'stored refund id';
  assert (select count(*) from public.order_refunds where order_id = p) = 1, 'one refund';
end $$;
rollback;

-- ===================================================================
-- process: none available
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_ship(v, 2, 0);
  j jsonb;
  j2 jsonb;
  o public.orders;
begin
  perform public.online_order_checkpoint(p, 'sr_create', '{"sr_order_id":"901","sr_shipment_id":"902"}');
  j := public.online_order_manual_process(p, null, 'self');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'cancelled' and o.status = 'cancelled' and (j ->> 'all_unavailable')::boolean, j::text;
  assert j ->> 'sr_order_id' = '901', 'the Shiprocket order still needs cancelling';
  assert o.courier is null and o.courier_name is null and o.bill_id is null, 'courier not set, no bill';
  assert o.process_plan ->> 'courier' = 'self', 'plan keeps the courier for the retry guard';
  assert (select total_amount from public.order_refunds where id = (j ->> 'refund_id')::uuid) = 2099, 'all refunded incl. shipping';
  assert (select data ->> 'reason' from public.order_events where order_id = p and kind = 'cancelled') = 'no item available', 'event';
  assert pg_temp.shipped_jobs(p) = 0, 'no shipped email';
  j2 := public.online_order_manual_process(p, null, 'self');
  assert j2 - 'changed' - 'sr_order_id' = j - 'changed' - 'sr_order_id' and not (j2 ->> 'changed')::boolean, 'repeat: ' || j2::text;
end $$;
rollback;

-- ===================================================================
-- process: refusals
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 9);
  p uuid := pg_temp.paid_ship(v, 1);
  r record;
  bad text;
begin
  foreach bad in array array['shiprocket', 'dhl', '', null] loop
    begin
      perform public.online_order_manual_process(p, null, bad);
      assert false, 'bad courier accepted: ' || coalesce(bad, 'null');
    exception when raise_exception then
      assert sqlerrm = 'manual_process: courier must be porter or self', sqlerrm;
    end;
  end loop;
  begin
    perform public.online_order_manual_process(p, null, 'porter');
    assert false, 'needs the shelf check';
  exception when raise_exception then
    assert sqlerrm = 'availability not set for every item', sqlerrm;
  end;
  perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 1, null);
  update public.orders set awb = 'AWB-X' where id = p;
  begin
    perform public.online_order_manual_process(p, null, 'porter');
    assert false, 'booked courier refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_process: order must be paid%', sqlerrm;
  end;
  update public.orders set awb = null where id = p;
  perform public.online_order_claim(p, 'process', null, 'k-process');
  begin
    perform public.online_order_manual_process(p, null, 'porter');
    assert false, 'processing order refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_process: order must be paid%', sqlerrm;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  begin
    perform public.online_order_manual_process(r.order_id, null, 'porter');
    assert false, 'pickup refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_process: order % is not a ship order', sqlerrm;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  begin
    perform public.online_order_manual_process(r.order_id, null, 'porter');
    assert false, 'unpaid refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_process: order must be paid%', sqlerrm;
  end;
end $$;
rollback;

-- shelf check is closed once processed
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
begin
  begin
    perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 0, null);
    assert false, 'shelf check refused after processed';
  exception when raise_exception then
    assert sqlerrm like 'availability can only be set while the order is paid%', sqlerrm;
  end;
end $$;
rollback;

-- ===================================================================
-- advance: the full ladder
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.processed(v, 2, 2);
  j jsonb;
  o public.orders;
begin
  j := public.online_order_manual_advance(p, null, 'packed');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'packed' and (j ->> 'changed')::boolean and j -> 'bill_id' = 'null'::jsonb, j::text;
  assert o.status = 'packed' and o.bill_id is null and pg_temp.shipped_jobs(p) = 0, 'packed has no side effects';
  assert (select shipped_qty from public.order_items where order_id = p) = 0, 'nothing shipped at packed';
  assert (select from_status = 'processed' and to_status = 'packed' and data = '{"courier":"porter"}'::jsonb
            from public.order_events where order_id = p and kind = 'packed'), 'packed event';

  j := public.online_order_manual_advance(p, null, 'shipped');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'shipped' and (j ->> 'changed')::boolean and (j ->> 'bill_id')::int = o.bill_id, j::text;
  assert o.bill_id is not null and pg_temp.bills(p) = 1, 'bill at Picked up';
  assert (select final_amount from public.bills where billid = o.bill_id) = 2099, 'bill total incl. shipping';
  assert (select shipped_qty = 2 and status = 'shipped' from public.order_items where order_id = p), 'shipped_qty and item status';
  assert (select count(*) from public.order_jobs where order_id = p and kind = 'email_shipped' and ref_id = 'manual') = 1, 'email under ref manual';
  assert (select from_status = 'packed' and to_status = 'shipped' and data ->> 'courier' = 'porter' and (data ->> 'bill_id')::int = o.bill_id
            from public.order_events where order_id = p and kind = 'shipped'), 'shipped event';

  j := public.online_order_manual_advance(p, null, 'out_for_delivery');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'out_for_delivery' and (j ->> 'changed')::boolean and (j ->> 'bill_id')::int = o.bill_id, j::text;
  assert o.status = 'out_for_delivery' and pg_temp.bills(p) = 1 and pg_temp.shipped_jobs(p) = 1, 'no second bill or email';
  assert (select data = '{"courier":"porter"}'::jsonb from public.order_events where order_id = p and kind = 'out_for_delivery'), 'ofd event';
  assert pg_temp.stock(v) = 3, 'stock stays taken';
end $$;
rollback;

-- skipping: Processed straight to Out for delivery does the bill and email once
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.processed(v, 2, 1, 'self');
  j jsonb;
  o public.orders;
begin
  j := public.online_order_manual_advance(p, null, 'out_for_delivery');
  select * into o from public.orders where id = p;
  assert o.status = 'out_for_delivery' and (j ->> 'bill_id')::int = o.bill_id, j::text;
  assert pg_temp.bills(p) = 1 and pg_temp.shipped_jobs(p) = 1, 'exactly one bill and one email';
  assert (select shipped_qty from public.order_items where order_id = p) = 1, 'shipped_qty = what was available';
  assert (select quantity from public.bill_items where billid = o.bill_id and variantid = v) = 1, 'bill lists the shipped unit';
  assert pg_temp.events(p, 'out_for_delivery') = 1 and pg_temp.events(p, 'shipped') = 0 and pg_temp.events(p, 'packed') = 0, 'one event of the target kind';
  assert (select from_status = 'processed' and (data ->> 'bill_id')::int = o.bill_id
            from public.order_events where order_id = p and kind = 'out_for_delivery'), 'event carries the bill';
end $$;
rollback;

-- repeat and backward are no-ops
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
  j jsonb;
  n bigint;
  t text;
begin
  j := public.online_order_manual_advance(p, null, 'packed');
  select count(*) into n from public.order_events where order_id = p;
  j := public.online_order_manual_advance(p, null, 'packed');
  assert not (j ->> 'changed')::boolean and j ->> 'status' = 'packed', 'repeat: ' || j::text;
  assert (select count(*) from public.order_events where order_id = p) = n, 'repeat writes nothing';

  j := public.online_order_manual_advance(p, null, 'out_for_delivery');
  select count(*) into n from public.order_events where order_id = p;
  foreach t in array array['packed', 'shipped', 'out_for_delivery'] loop
    j := public.online_order_manual_advance(p, null, t);
    assert not (j ->> 'changed')::boolean and j ->> 'status' = 'out_for_delivery', t || ': ' || j::text;
    assert (j ->> 'bill_id') is not null, 'no-op still reports the bill';
  end loop;
  assert (select count(*) from public.order_events where order_id = p) = n, 'backward writes nothing';
  assert pg_temp.bills(p) = 1 and pg_temp.shipped_jobs(p) = 1, 'one bill, one email';

  perform public.online_order_mark_delivered(p, null, now(), '');
  j := public.online_order_manual_advance(p, null, 'out_for_delivery');
  assert not (j ->> 'changed')::boolean and j ->> 'status' = 'delivered', 'delivered stays: ' || j::text;
end $$;
rollback;

-- ===================================================================
-- advance: refusals
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 9);
  p uuid := pg_temp.processed(v, 1, 1);
  q uuid;
  r record;
  bad text;
begin
  foreach bad in array array['delivered', 'processed', 'paid', '', null] loop
    begin
      perform public.online_order_manual_advance(p, null, bad);
      assert false, 'bad target accepted: ' || coalesce(bad, 'null');
    exception when raise_exception then
      assert sqlerrm like 'manual_advance: bad target%', sqlerrm;
    end;
  end loop;
  assert pg_temp.status(p) = 'processed', 'untouched';

  -- Shiprocket: courier null and an explicit 'shiprocket'
  q := pg_temp.paid_ship(v, 1, 1);
  update public.orders set status = 'packed', awb = 'AWB-T2' where id = q;
  begin
    perform public.online_order_manual_advance(q, null, 'shipped');
    assert false, 'Shiprocket order refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_advance: order % is not a manual delivery', sqlerrm;
  end;
  update public.orders set courier = 'shiprocket' where id = q;
  begin
    perform public.online_order_manual_advance(q, null, 'shipped');
    assert false, 'explicit Shiprocket order refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_advance: order % is not a manual delivery', sqlerrm;
  end;

  -- pickup, even with a courier somehow on it
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  begin
    perform public.online_order_manual_advance(r.order_id, null, 'packed');
    assert false, 'pickup refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_advance: order % is not a manual delivery', sqlerrm;
  end;
  update public.orders set courier = 'porter' where id = r.order_id;
  begin
    perform public.online_order_manual_advance(r.order_id, null, 'packed');
    assert false, 'pickup with a courier refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_advance: order % is not a manual delivery', sqlerrm;
  end;

  -- claimed for cancel, then cancelled
  perform public.online_order_claim(p, 'cancel', null, 'k-cancel');
  begin
    perform public.online_order_manual_advance(p, null, 'packed');
    assert false, 'cancelling refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_advance: order % has an operation in progress (cancel)', sqlerrm;
  end;
  perform public.online_order_cancel(p, null, 'customer asked');
  begin
    perform public.online_order_manual_advance(p, null, 'packed');
    assert false, 'cancelled refused';
  exception when raise_exception then
    assert sqlerrm like 'manual_advance: order % cannot advance from status cancelled', sqlerrm;
  end;
  assert pg_temp.status(p) = 'cancelled' and pg_temp.bills(p) = 0, 'cancelled stays cancelled';
end $$;
rollback;

-- ===================================================================
-- old dispatch_manual orders keep working
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 2, 2);
  j jsonb;
  b int;
begin
  perform public.online_order_dispatch_manual(p, null, 'https://porter.in/track/abc');
  select bill_id into b from public.orders where id = p;
  assert pg_temp.bills(p) = 1 and pg_temp.shipped_jobs(p) = 1, 'old flow: bill + email done';
  j := public.online_order_manual_advance(p, null, 'packed');
  assert not (j ->> 'changed')::boolean and j ->> 'status' = 'shipped', 'cannot go back to packed';
  j := public.online_order_manual_advance(p, null, 'out_for_delivery');
  assert (j ->> 'changed')::boolean and j ->> 'status' = 'out_for_delivery' and (j ->> 'bill_id')::int = b, j::text;
  assert pg_temp.bills(p) = 1 and pg_temp.shipped_jobs(p) = 1, 'no second bill or email';
  assert (select count(*) from public.order_jobs where order_id = p and kind = 'email_shipped' and ref_id = 'manual') = 0, 'no manual email';
  assert public._order_public_json((select o from public.orders o where id = p)) ->> 'tracking_url' = 'https://porter.in/track/abc',
    'old orders keep their pasted link';
  perform public.online_order_mark_delivered(p, null, now(), '');
  assert pg_temp.status(p) = 'delivered', 'and closes';
  j := public.online_order_manual_process(p, null, 'porter');
  assert not (j ->> 'changed')::boolean and j ->> 'status' = 'delivered', 'process retry on an old order is the stored result';
end $$;
rollback;

-- ===================================================================
-- a rebooked order keeps its bill
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 9);
  p uuid := pg_temp.rebooked(v, 2);
  b int;
  j jsonb;
begin
  select bill_id into b from public.orders where id = p;
  assert b is not null and pg_temp.status(p) = 'paid', 'fixture: paid, bill kept';
  perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 1, null);
  j := public.online_order_manual_process(p, null, 'self');
  assert j ->> 'status' = 'processed', j::text;
  assert (select count(*) from public.exchanges where order_refund_id = (j ->> 'refund_id')::uuid and reason = 'Rebook: unavailable') = 1,
    'unavailable unit offset on the bill';
  j := public.online_order_manual_advance(p, null, 'shipped');
  assert (j ->> 'bill_id')::int = b and pg_temp.bills(p) = 1, 'same bill, none added: ' || j::text;
  assert (select shipped_qty from public.order_items where order_id = p) = 1, 'shipped_qty is the second shipment';
  assert (select count(*) from public.order_jobs where order_id = p and kind = 'email_shipped' and ref_id = 'manual') = 1, 'second shipment emails';
end $$;
rollback;

-- rebooked, cancelled at processed: the kept bill is offset in full
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 9);
  p uuid := pg_temp.rebooked(v, 2);
  s0 numeric := pg_temp.stock(v);
  rid uuid;
begin
  perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 2, null);
  perform public.online_order_manual_process(p, null, 'porter');
  rid := pg_temp.cancel(p);
  assert (select total_amount from public.order_refunds where id = rid) = 2099, 'full refund incl. shipping';
  assert (select count(*) from public.exchanges where order_refund_id = rid and reason = 'Cancel after rebook') = 2, 'goods + shipping offset';
  assert pg_temp.stock(v) = s0 + 2, 'restocked';
end $$;
rollback;

-- ===================================================================
-- cancel before pickup: money and stock
-- ===================================================================
-- (a) full shelf, cancelled at processed
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.processed(v, 2, 2);
  rid uuid;
  o public.orders;
begin
  assert pg_temp.stock(v) = 3, 'fixture: two taken';
  rid := pg_temp.cancel(p);
  select * into o from public.orders where id = p;
  assert o.status = 'cancelled' and o.op_action is null, 'cancelled, op cleared';
  assert (select reason = 'cancel' and units = 2 and shipping_amount = 99 and total_amount = 2099
            from public.order_refunds where id = rid), 'full refund incl. shipping';
  assert pg_temp.stock(v) = 5, 'stock restored';
  assert pg_temp.shipping_legs(p) = 1, 'one shipping leg';
  assert pg_temp.refunded(p) = o.gateway_amount, 'refunded equals paid';
  assert (select from_status from public.order_events where order_id = p and kind = 'claimed') = 'processed', 'claimed from processed';
end $$;
rollback;

-- (b) partial shelf: one unit refunded at Process, cancelled at packed
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.processed(v, 2, 1);
  rid uuid;
  o public.orders;
begin
  perform public.online_order_manual_advance(p, null, 'packed');
  assert pg_temp.refunded(p) = 1000 and pg_temp.shipping_legs(p) = 0, 'fixture: one unit refunded, shipping kept';
  rid := pg_temp.cancel(p);
  select * into o from public.orders where id = p;
  assert (select reason = 'cancel' and units = 1 and shipping_amount = 99 and total_amount = 1099
            from public.order_refunds where id = rid), 'remaining unit + shipping';
  assert pg_temp.stock(v) = 4, 'restocks exactly the one unit on the shelf';
  assert pg_temp.refunded(p) = o.gateway_amount and o.gateway_amount = 2099, 'total refunded equals the amount paid';
  assert pg_temp.shipping_legs(p) = 1, 'shipping refunded once';
  assert (select refunded_qty = 2 and status = 'refunded' from public.order_items where order_id = p), 'item fully refunded';
end $$;
rollback;

-- (c) no bill exists: no offset; a repeat of cancel returns the same refund
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 2, 1, 'self');
  rid uuid;
begin
  perform public.online_order_manual_advance(p, null, 'packed');
  rid := pg_temp.cancel(p);
  assert (select bill_id from public.orders where id = p) is null and pg_temp.bills(p) = 0, 'no bill';
  assert not exists (select 1 from public.exchanges e join public.order_refunds r on r.id = e.order_refund_id where r.order_id = p), 'no bill offset';
  assert public.online_order_cancel(p, null, 'again') = rid, 'repeat returns the same refund';
  assert pg_temp.shipping_legs(p) = 1, 'repeat refunds nothing';
end $$;
rollback;

-- ===================================================================
-- claim matrix
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 90);
  p uuid;
  c jsonb;
  a text;
  st text;
  cr text;
  r record;
begin
  -- manual, before pickup: cancel only
  foreach cr in array array['porter', 'self'] loop
    foreach st in array array['processed', 'packed'] loop
      p := pg_temp.processed(v, 1, 1, cr);
      if st = 'packed' then perform public.online_order_manual_advance(p, null, 'packed'); end if;
      foreach a in array array['process', 'send_back', 'rebook'] loop
        c := public.online_order_claim(p, a, null, 'k-' || a);
        assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', cr || '/' || st || '/' || a || ': ' || c::text;
      end loop;
      assert pg_temp.status(p) = st, 'refusals leave it';
      c := public.online_order_claim(p, 'cancel', null, 'k-cancel');
      assert (c ->> 'claimed')::boolean and c ->> 'status' = 'cancelling', cr || '/' || st || '/cancel: ' || c::text;
    end loop;
    -- manual, after pickup: nothing
    foreach st in array array['shipped', 'out_for_delivery', 'delivered'] loop
      p := pg_temp.processed(v, 1, 1, cr);
      if st = 'delivered' then
        perform public.online_order_manual_advance(p, null, 'shipped');
        perform public.online_order_mark_delivered(p, null, now(), '');
      else
        perform public.online_order_manual_advance(p, null, st);
      end if;
      foreach a in array array['process', 'send_back', 'rebook', 'cancel'] loop
        c := public.online_order_claim(p, a, null, 'k-' || a);
        assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', cr || '/' || st || '/' || a || ': ' || c::text;
      end loop;
      assert pg_temp.status(p) = st, 'refusals leave it';
    end loop;
  end loop;

  -- Shiprocket: paid cancels, packed does not (null courier and explicit)
  p := pg_temp.paid_ship(v, 1, 1);
  c := public.online_order_claim(p, 'cancel', null, 'k-cancel');
  assert (c ->> 'claimed')::boolean, 'Shiprocket paid: cancel';
  p := pg_temp.paid_ship(v, 1, 1);
  c := public.online_order_claim(p, 'process', null, 'k-process');
  assert (c ->> 'claimed')::boolean, 'Shiprocket paid: process';
  foreach cr in array array[null, 'shiprocket'] loop
    p := pg_temp.paid_ship(v, 1, 1);
    update public.orders set status = 'packed', awb = 'AWB-' || left(p::text, 8), courier = cr where id = p;
    c := public.online_order_claim(p, 'cancel', null, 'k-cancel');
    assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', 'Shiprocket packed: no cancel: ' || c::text;
    assert pg_temp.status(p) = 'packed', 'Shiprocket packed stays';
    c := public.online_order_claim(p, 'rebook', null, 'k-rebook');
    assert (c ->> 'claimed')::boolean, 'Shiprocket packed: rebook still works: ' || c::text;
  end loop;

  -- pickup: cancel only, from paid and ready_for_pickup
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  c := public.online_order_claim(r.order_id, 'process', null, 'k-process');
  assert not (c ->> 'claimed')::boolean, 'pickup: no process';
  c := public.online_order_claim(r.order_id, 'cancel', null, 'k-cancel');
  assert (c ->> 'claimed')::boolean, 'pickup paid: cancel';
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  perform public.online_order_set_availability(r.order_id, (select id from public.order_items where order_id = r.order_id), 1, null);
  perform public.online_order_mark_ready(r.order_id, null);
  c := public.online_order_claim(r.order_id, 'cancel', null, 'k-cancel');
  assert (c ->> 'claimed')::boolean, 'pickup ready: cancel';
end $$;
rollback;

-- ===================================================================
-- mark delivered
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 2, 2, 'self');
  it uuid;
begin
  begin
    perform public.online_order_mark_delivered(p, null, now(), '');
    assert false, 'still in the shop';
  exception when raise_exception then
    assert sqlerrm like 'order % must be shipped or out for delivery%', sqlerrm;
  end;
  perform public.online_order_manual_advance(p, null, 'out_for_delivery');
  perform public.online_order_mark_delivered(p, null, now(), '   ');
  assert (select status = 'delivered' and delivered_at is not null from public.orders where id = p), 'delivered';
  assert (select data ->> 'reason' from public.order_events where order_id = p and kind = 'delivered') = 'Delivered by shop',
    'default reason recorded';
  assert 'email_delivered' = any (pg_temp.jobs(p)), 'delivered email queued';
  select id into it from public.order_items where order_id = p;
  assert (select units from public.online_return_returnable(p) where item_id = it) = 2, 'both units returnable';
  perform public.online_return_open(p, null, false, 'change_of_mind', now(),
    jsonb_build_array(jsonb_build_object('item_id', it, 'units', 1)), 'customer called', null, null);
end $$;
rollback;

begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
  q uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1);
begin
  perform public.online_order_manual_advance(p, null, 'shipped');
  perform public.online_order_mark_delivered(p, null, now(), null);
  assert (select data ->> 'reason' from public.order_events where order_id = p and kind = 'delivered') = 'Delivered by Porter', 'Porter default';
  perform public.online_order_manual_advance(q, null, 'shipped');
  perform public.online_order_mark_delivered(q, null, now(), ' rider confirmed ');
  assert (select data ->> 'reason' from public.order_events where order_id = q and kind = 'delivered') = 'rider confirmed', 'given reason kept';
end $$;
rollback;

begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1, 1);
begin
  update public.orders set status = 'shipped', awb = 'AWB-T1' where id = p;
  begin
    perform public.online_order_mark_delivered(p, null, now(), '');
    assert false, 'Shiprocket order needs a reason';
  exception when raise_exception then
    assert sqlerrm = 'a reason is required to mark an order delivered', sqlerrm;
  end;
end $$;
rollback;

-- ===================================================================
-- grants
-- ===================================================================
begin;
do $$
declare
  f text;
begin
  foreach f in array array['public.online_order_manual_process(uuid, uuid, text)',
                           'public.online_order_manual_advance(uuid, uuid, text)',
                           'public.online_order_mark_delivered(uuid, uuid, timestamptz, text)',
                           'public.online_order_claim(uuid, text, uuid, text)'] loop
    assert has_function_privilege('service_role', f, 'execute'), f || ': service_role';
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      f || ': anon/authenticated must not execute';
  end loop;
end $$;
rollback;
