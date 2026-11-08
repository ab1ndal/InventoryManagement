-- Tests for schema/migration_order_item_customer_title.sql: an online order line keeps the
-- customer title (products.display_title), not the inventory name. Each test is
-- `begin; do $$ ... $$; rollback;`.
-- Run locally: scripts/test-db.sh up, the online-orders migrations listed in
-- schema/test_online_orders_holds.sql, schema/migration_product_titles.sql, this migration,
-- then this file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
do $$
declare
  v uuid := gen_random_uuid();
  r record;
  v_title text;
  v_name text;
begin
  update public.storefront_settings set checkout_live = true where id = 1;
  insert into public.products (productid, name, categoryid, fabric, purchaseprice, retailprice, title_detail)
  values ('TTITLE1', 'Silk-Saree', 'SA', 'Silk', 500, 1000, 'Zari Border');
  insert into public.productsizecolors (productid, size, color, stock, variantid)
  values ('TTITLE1', 'FREE-SIZE', 'Red', 3, v);
  select display_title, name into v_title, v_name from public.products where productid = 'TTITLE1';
  assert v_title <> v_name, format('fixture title %L must differ from name %L', v_title, v_name);

  select * into r from public.online_order_create(
    jsonb_build_object(
      'contact', jsonb_build_object('name', 'Title Shopper', 'phone', '+919800000001'),
      'address', jsonb_build_object('line1', '1 Test Road', 'city', 'Ghaziabad', 'state', 'Uttar Pradesh', 'pincode', '201001'),
      'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
    jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1, 'unit_price', 1000)),
    null);

  assert (select product_name from public.order_items where order_id = r.order_id) = v_title,
    (select product_name from public.order_items where order_id = r.order_id);
end $$;
rollback;
