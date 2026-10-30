-- Tests for schema/migration_online_orders_porter.sql (Porter: manual dispatch, claim guard,
-- mark delivered without a reason, public tracking link). Each test is `begin; do $$ ... $$; rollback;`.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_r7.sql \
--     schema/migration_online_orders_any_state.sql \
--     schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql \
--     schema/migration_online_orders_rebook.sql schema/migration_online_returns.sql \
--     schema/migration_online_orders_pickup.sql schema/migration_online_orders_porter.sql \
--     schema/test_online_orders_porter.sql
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

-- ===================================================================
-- dispatch: everything on the shelf
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_ship(v, 2, 2);
  j jsonb;
  j2 jsonb;
  o public.orders;
  pub jsonb;
begin
  -- the shiprocket_create job already made a Shiprocket order: it comes back for the caller to cancel
  perform public.online_order_checkpoint(p, 'sr_create', '{"sr_order_id":"901","sr_shipment_id":"902"}');
  j := public.online_order_dispatch_manual(p, null, '  https://porter.in/track/abc123  ');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'shipped' and o.status = 'shipped', 'shipped: ' || j::text;
  assert (j ->> 'changed')::boolean and j ->> 'sr_order_id' = '901', 'first call: changed + sr order to cancel';
  assert o.courier = 'porter' and o.courier_name = 'Porter', 'courier recorded';
  assert o.manual_tracking_url = 'https://porter.in/track/abc123', 'link trimmed and stored';
  assert o.awb is null and o.op_action is null, 'no AWB, no op';
  assert o.bill_id is not null and (j ->> 'bill_id')::int = o.bill_id, 'bill created';
  assert j -> 'refund_id' = 'null'::jsonb and not (j ->> 'all_unavailable')::boolean, 'nothing refunded';
  assert (select shipped_qty from public.order_items where order_id = p) = 2, 'shipped_qty = dispatched units';
  assert (select count(*) from public.bill_items where billid = o.bill_id) = 2, 'goods line + Shipping line';
  assert (select final_amount from public.bills where billid = o.bill_id) = 2099, 'bill total incl. shipping';
  assert (select count(*) from public.order_jobs where order_id = p and kind = 'email_shipped' and ref_id = 'porter') = 1,
    'shipped email queued under its own ref';
  assert (select data ->> 'courier' from public.order_events where order_id = p and kind = 'shipped') = 'porter', 'event';
  assert pg_temp.stock(v) = 3, 'stock stays taken';
  pub := public._order_public_json(o);
  assert pub ->> 'courier' = 'porter' and pub ->> 'tracking_url' = 'https://porter.in/track/abc123', 'public json: ' || pub::text;
  j2 := public.online_order_dispatch_manual(p, null, 'https://porter.in/other');
  assert j2 - 'changed' - 'sr_order_id' = j - 'changed' - 'sr_order_id', 'repeat returns the stored result: ' || j2::text;
  assert not (j2 ->> 'changed')::boolean and j2 -> 'sr_order_id' = 'null'::jsonb, 'repeat: no second Shiprocket cancel';
  assert (select manual_tracking_url from public.orders where id = p) = 'https://porter.in/track/abc123', 'repeat keeps the link';
  assert (select count(*) from public.bills where notes = 'Online order ' || o.order_ref) = 1, 'one bill';
end $$;
rollback;

-- no link: allowed; public json has no tracking url
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1, 1);
  j jsonb;
  o public.orders;
begin
  j := public.online_order_dispatch_manual(p, null, '   ');
  select * into o from public.orders where id = p;
  assert o.status = 'shipped' and o.manual_tracking_url is null, 'blank link stored as null';
  assert j -> 'sr_order_id' = 'null'::jsonb, 'no Shiprocket order yet';
  assert public._order_public_json(o) -> 'tracking_url' = 'null'::jsonb, 'no tracking url';
end $$;
rollback;

-- ===================================================================
-- dispatch: shelf check refunds
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_ship(v, 2, 1);
  j jsonb;
  o public.orders;
begin
  j := public.online_order_dispatch_manual(p, null, null);
  select * into o from public.orders where id = p;
  assert o.status = 'shipped', 'partial still ships';
  assert (select reason = 'unavailable' and units = 1 and total_amount = 1000
            from public.order_refunds where id = (j ->> 'refund_id')::uuid), 'one unit refunded';
  assert (select quantity from public.bill_items where billid = o.bill_id and variantid = v) = 1, 'bill lists the dispatched unit';
  assert pg_temp.stock(v) = 3, 'the missing unit is not restocked (it was never on the shelf)';
end $$;
rollback;

begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 5);
  p uuid := pg_temp.paid_ship(v, 2, 0);
  j jsonb;
  o public.orders;
begin
  perform public.online_order_checkpoint(p, 'sr_create', '{"sr_order_id":"901","sr_shipment_id":"902"}');
  j := public.online_order_dispatch_manual(p, null, 'https://porter.in/x');
  select * into o from public.orders where id = p;
  assert j ->> 'status' = 'cancelled' and o.status = 'cancelled' and (j ->> 'all_unavailable')::boolean, j::text;
  assert j ->> 'sr_order_id' = '901', 'the Shiprocket order still needs cancelling';
  assert o.bill_id is null and o.courier is null and o.manual_tracking_url is null, 'no bill, never dispatched';
  assert (select total_amount from public.order_refunds where id = (j ->> 'refund_id')::uuid) = 2099, 'all refunded incl. shipping';
  assert not exists (select 1 from public.order_jobs where order_id = p and kind = 'email_shipped'), 'no shipped email';
  assert public.online_order_dispatch_manual(p, null, null) - 'changed' - 'sr_order_id' = j - 'changed' - 'sr_order_id',
    'repeat returns the stored result';
end $$;
rollback;

-- ===================================================================
-- dispatch: refusals
-- ===================================================================
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1000, 9);
  p uuid := pg_temp.paid_ship(v, 1);
  r record;
  c jsonb;
  u text;
begin
  begin
    perform public.online_order_dispatch_manual(p, null, null);
    assert false, 'needs the shelf check';
  exception when raise_exception then
    assert sqlerrm = 'availability not set for every item', sqlerrm;
  end;
  perform public.online_order_set_availability(p, (select id from public.order_items where order_id = p), 1, null);
  foreach u in array array['http://porter.in/x', 'javascript:alert(1)', 'https://porter.in/a b',
                                     'https://' || repeat('a', 500)] loop
    begin
      perform public.online_order_dispatch_manual(p, null, u);
      assert false, 'bad link accepted: ' || u;
    exception when raise_exception then
      assert sqlerrm = 'tracking link must be an https:// link', sqlerrm;
    end;
  end loop;
  c := public.online_order_claim(p, 'process', null, 'k-process');
  assert (c ->> 'claimed')::boolean, 'process claimed';
  begin
    perform public.online_order_dispatch_manual(p, null, null);
    assert false, 'processing order refused';
  exception when raise_exception then
    assert sqlerrm like 'dispatch_manual: order must be paid%', sqlerrm;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)), '{"fulfilment":"pickup"}');
  perform pg_temp.pay(r.order_ref);
  begin
    perform public.online_order_dispatch_manual(r.order_id, null, null);
    assert false, 'pickup refused';
  exception when raise_exception then
    assert sqlerrm like 'dispatch_manual: order % is not a ship order', sqlerrm;
  end;
  select * into r from pg_temp.mk_order(jsonb_build_array(jsonb_build_object('v', v, 'qty', 1)));
  begin
    perform public.online_order_dispatch_manual(r.order_id, null, null);
    assert false, 'unpaid refused';
  exception when raise_exception then
    assert sqlerrm like 'dispatch_manual: order must be paid%', sqlerrm;
  end;
  begin
    update public.orders set manual_tracking_url = 'http://x' where id = r.order_id;
    assert false, 'column check';
  exception when check_violation then null;
  end;
  begin
    update public.orders set courier = 'dhl' where id = r.order_id;
    assert false, 'courier check';
  exception when check_violation then null;
  end;
end $$;
rollback;

-- ===================================================================
-- claim: a Porter order is never handed to Shiprocket
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1, 1);
  c jsonb;
  a text;
begin
  perform public.online_order_dispatch_manual(p, null, null);
  foreach a in array array['process', 'send_back', 'rebook', 'cancel'] loop
    c := public.online_order_claim(p, a, null, 'k-' || a);
    assert not (c ->> 'claimed')::boolean and c ->> 'reason' = 'status', a || ' refused: ' || c::text;
  end loop;
  assert (select status = 'shipped' and op_action is null from public.orders where id = p), 'order untouched';
end $$;
rollback;

-- ===================================================================
-- mark delivered: reason optional for Porter, returns work
-- ===================================================================
begin;
do $$
declare
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 2, 2);
  it uuid;
  j jsonb;
  o public.orders;
begin
  perform public.online_order_dispatch_manual(p, null, null);
  j := public.online_order_mark_delivered(p, null, now(), '  ');
  select * into o from public.orders where id = p;
  assert o.status = 'delivered' and o.delivered_at is not null, 'delivered';
  assert (select data ->> 'reason' from public.order_events where order_id = p and kind = 'delivered') = 'Delivered by Porter',
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
  p uuid := pg_temp.paid_ship(pg_temp.mk_variant(1000, 5), 1, 1);
begin
  -- A Shiprocket order (no courier set) still needs the reason.
  update public.orders set status = 'shipped', awb = 'AWB-T1' where id = p;
  begin
    perform public.online_order_mark_delivered(p, null, now(), '');
    assert false, 'Shiprocket order needs a reason';
  exception when raise_exception then
    assert sqlerrm = 'a reason is required to mark an order delivered', sqlerrm;
  end;
  assert (public._order_public_json((select o from public.orders o where id = p))) ->> 'tracking_url'
         = 'https://shiprocket.co/tracking/AWB-T1', 'Shiprocket tracking url unchanged';
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
  foreach f in array array['public.online_order_dispatch_manual(uuid, uuid, text)',
                           'public.online_order_mark_delivered(uuid, uuid, timestamptz, text)',
                           'public.online_order_claim(uuid, text, uuid, text)'] loop
    assert has_function_privilege('service_role', f, 'execute'), f || ': service_role';
    assert not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
      f || ': anon/authenticated must not execute';
  end loop;
  assert not has_function_privilege('anon', 'public._order_public_json(public.orders)', 'execute'), 'public json helper';
end $$;
rollback;
