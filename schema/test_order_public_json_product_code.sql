-- Tests for schema/migration_order_public_json_product_code.sql: the customer order JSON
-- (online_order_lookup, my_online_orders) carries each line's product code. Each test is
-- `begin; do $$ ... $$; rollback;`.
-- Run locally: scripts/test-db.sh up, the online-orders migrations listed in
-- schema/test_online_orders_customer_tracking.sql, this migration, then this file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
do $$
declare
  v uuid := gen_random_uuid();
  r record;
  v_json jsonb;
begin
  update public.storefront_settings set checkout_live = true where id = 1;
  insert into public.products (productid, name, categoryid, fabric, purchaseprice, retailprice)
  values ('TCODE1', 'Silk-Saree', 'SA', 'Silk', 500, 1000);
  insert into public.productsizecolors (productid, size, color, stock, variantid)
  values ('TCODE1', 'FREE-SIZE', 'Red', 3, v);

  select * into r from public.online_order_create(
    jsonb_build_object(
      'contact', jsonb_build_object('name', 'Code Shopper', 'phone', '+919800000002'),
      'address', jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001'),
      'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
    jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 1000)),
    null);

  select public._order_public_json(o) into v_json from public.orders o where o.id = r.order_id;
  assert v_json -> 'items' -> 0 ->> 'productid' = 'TCODE1', v_json ->> 'items';
end $$;
rollback;
