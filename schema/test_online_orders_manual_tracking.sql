-- Tests for schema/migration_online_orders_manual_tracking.sql (carrier and tracking number on a
-- manual delivery, the public order JSON, grants). Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_any_state.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/migration_online_orders_pickup.sql schema/migration_online_orders_porter.sql \
--     schema/migration_online_orders_holds.sql schema/migration_online_orders_hold_cap.sql \
--     schema/migration_online_orders_manual_stages.sql \
--     schema/migration_online_orders_customer_tracking.sql \
--     schema/migration_online_orders_manual_tracking.sql schema/test_online_orders_manual_tracking.sql
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

create function pg_temp.track(p_order uuid, p_carrier text, p_number text) returns jsonb language sql as $$
  select public.online_order_set_manual_tracking(p_order, null, p_carrier, p_number)
$$;

create function pg_temp.events(p_order uuid, p_kind text) returns bigint language sql as $$
  select count(*) from public.order_events where order_id = p_order and kind = p_kind
$$;

-- ===================================================================
-- set, change, clear
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1, 'self');
  j jsonb;
  o public.orders;
begin
  j := pg_temp.track(p, '  India Post ', ' EE123456789IN ');
  select * into o from public.orders where id = p;
  assert (j ->> 'changed')::boolean and j ->> 'courier_name' = 'India Post' and j ->> 'tracking_number' = 'EE123456789IN', j::text;
  assert o.courier_name = 'India Post' and o.manual_tracking_number = 'EE123456789IN', 'stored trimmed';
  assert o.status = 'processed' and o.courier = 'self' and o.awb is null, 'status, courier and awb untouched';
  assert (select from_status = 'processed' and to_status = 'processed' and data ->> 'carrier' = 'India Post'
                 and data ->> 'tracking_number' = 'EE123456789IN'
            from public.order_events where order_id = p and kind = 'tracking_set'), 'event';
  assert public._order_public_json(o) ->> 'tracking_number' = 'EE123456789IN'
     and public._order_public_json(o) ->> 'courier_name' = 'India Post', 'public json';
  assert public._order_public_json(o) -> 'tracking_url' = 'null'::jsonb, 'no Shiprocket link for a manual number';
  -- same values again: no writes
  j := pg_temp.track(p, 'India Post', 'EE123456789IN');
  assert not (j ->> 'changed')::boolean, 'repeat: ' || j::text;
  assert pg_temp.events(p, 'tracking_set') = 1, 'one event';
  -- number only: carrier back to the default name
  j := pg_temp.track(p, '', 'D1234/56-7');
  select * into o from public.orders where id = p;
  assert o.courier_name = 'Bindal''s Creation' and o.manual_tracking_number = 'D1234/56-7', 'default name: ' || o.courier_name;
  -- clear both
  j := pg_temp.track(p, null, '   ');
  select * into o from public.orders where id = p;
  assert (j ->> 'changed')::boolean and o.manual_tracking_number is null and o.courier_name = 'Bindal''s Creation', j::text;
  assert public._order_public_json(o) -> 'tracking_number' = 'null'::jsonb, 'cleared in public json';
  assert pg_temp.events(p, 'tracking_set') = 3, 'three changes';
end $$;
rollback;

-- Porter default name; every stage from processed to delivered takes it; the stage ladder still works
begin;
do $$
declare
  p uuid := pg_temp.processed(pg_temp.mk_variant(1000, 5), 1, 1, 'porter');
  s text;
begin
  perform pg_temp.track(p, 'DTDC', 'X1');
  perform pg_temp.track(p, null, 'X1');
  assert (select courier_name from public.orders where id = p) = 'Porter', 'porter default';
  foreach s in array array['packed', 'shipped', 'out_for_delivery'] loop
    perform public.online_order_manual_advance(p, null, s);
    perform pg_temp.track(p, 'Porter', 'P-' || replace(s, '_', '-'));
    assert (select manual_tracking_number from public.orders where id = p) = 'P-' || replace(s, '_', '-'), s;
  end loop;
  perform public.online_order_mark_delivered(p, null, now(), '');
  perform pg_temp.track(p, 'Porter', 'P-late');
  assert (select status = 'delivered' and manual_tracking_number = 'P-late' from public.orders where id = p), 'delivered takes a fix';
end $$;
rollback;

-- ===================================================================
-- refusals
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 9);
  p uuid := pg_temp.processed(v, 1, 1, 'self');
  q uuid;
  r record;
  bad text;
begin
  foreach bad in array array['-lead', 'EE12;drop', 'a<b>', repeat('9', 41), 'tab' || chr(9) || 'x', 'नंबर'] loop
    begin
      perform pg_temp.track(p, null, bad);
      assert false, 'bad number accepted: ' || bad;
    exception when raise_exception then
      assert sqlerrm like 'tracking number must be%', sqlerrm;
    end;
  end loop;
  foreach bad in array array['<script>', 'India Post;', repeat('a', 41), '.dot'] loop
    begin
      perform pg_temp.track(p, bad, 'EE1');
      assert false, 'bad carrier accepted: ' || bad;
    exception when raise_exception then
      assert sqlerrm like 'carrier must be%', sqlerrm;
    end;
  end loop;
  perform pg_temp.track(p, 'Shree Maruti (B&D) Co. / Ltd-1', repeat('9', 40));
  assert (select manual_tracking_number from public.orders where id = p) = repeat('9', 40), '40 chars allowed';
  -- the column refuses a bad value written around the function
  begin
    update public.orders set manual_tracking_number = 'bad;value' where id = p;
    assert false, 'column check';
  exception when check_violation then null;
  end;
  -- paid (not processed yet), Shiprocket, pickup, cancelling, cancelled, unknown
  q := pg_temp.paid_ship(v, 1, 1);
  begin
    perform pg_temp.track(q, 'India Post', 'EE1');
    assert false, 'paid order refused';
  exception when raise_exception then
    assert sqlerrm like 'set_manual_tracking: order % is not a manual delivery', sqlerrm;
  end;
  update public.orders set status = 'packed', awb = 'AWB-X' where id = q;
  begin
    perform pg_temp.track(q, 'India Post', 'EE1');
    assert false, 'Shiprocket order refused';
  exception when raise_exception then
    assert sqlerrm like 'set_manual_tracking: order % is not a manual delivery', sqlerrm;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  update public.orders set courier = 'self' where id = r.order_id;
  begin
    perform pg_temp.track(r.order_id, 'India Post', 'EE1');
    assert false, 'pickup refused';
  exception when raise_exception then
    assert sqlerrm like 'set_manual_tracking: order % is not a manual delivery', sqlerrm;
  end;
  q := pg_temp.processed(v, 1, 1, 'self');
  perform public.online_order_claim(q, 'cancel', null, 'k-cancel');
  begin
    perform pg_temp.track(q, 'India Post', 'EE1');
    assert false, 'cancelling refused';
  exception when raise_exception then
    assert sqlerrm like 'set_manual_tracking: order % cannot take a tracking number in status cancelling', sqlerrm;
  end;
  perform public.online_order_cancel(q, null, 'customer asked');
  begin
    perform pg_temp.track(q, 'India Post', 'EE1');
    assert false, 'cancelled refused';
  exception when raise_exception then
    assert sqlerrm like 'set_manual_tracking: order % cannot take a tracking number in status cancelled', sqlerrm;
  end;
  begin
    perform pg_temp.track(gen_random_uuid(), 'India Post', 'EE1');
    assert false, 'unknown order';
  exception when raise_exception then
    assert sqlerrm like 'order % not found', sqlerrm;
  end;
end $$;
rollback;

-- ===================================================================
-- grants
-- ===================================================================
begin;
do $$
declare
  f text := 'public.online_order_set_manual_tracking(uuid, uuid, text, text)';
begin
  assert has_function_privilege('service_role', f, 'execute'), 'service_role';
  assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
    'not callable by shoppers or staff directly';
  assert not has_function_privilege('anon', 'public._order_public_json(public.orders)', 'execute'), 'public json stays internal';
end $$;
rollback;
