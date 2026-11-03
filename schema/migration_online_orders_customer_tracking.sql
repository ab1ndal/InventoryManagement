-- Customer tracking details (2026-11-02): step times, delivery city and pincode, and item photos on
-- /track and the order page. All of it is data the database already holds; nothing new is stored.
-- Deploy order: this migration, then the order-status function, then the frontend. Only adds fields,
-- so the old frontend and the old handler keep working against it.
-- Run after migration_online_orders_manual_stages.sql. Idempotent; no BEGIN/COMMIT.
--
-- ============================== CONTRACT ==============================
-- _order_tracking_json(p_order_id uuid) returns jsonb, or null for an unknown order. Service role
--   only: the order-status function calls it, and _order_public_json calls it as definer.
--   {status_times: {<status>: timestamptz}, delivery_city, delivery_pincode, item_images: {<line_no>: url}}
--   status_times holds only the statuses a timeline step shows: paid, processing, processed,
--     ready_for_pickup, packed, shipped, out_for_delivery, delivered. Latest order_events row per
--     to_status that really moved the order (to_status <> from_status). Three exceptions:
--     paid is the payment confirmation (kind 'paid'), because send back and rebook also write
--       to_status 'paid' and "Order placed" must not move to the day of the rebook.
--     Events before the latest send back or rebook are ignored: that attempt was undone, so a step
--       the next attempt skips has no time, not the old attempt's.
--     delivered is orders.delivered_at when set, because staff can backdate a manual delivery and
--       the event then holds the time of the click. The return window counts from the same value.
--   delivery_city, delivery_pincode: from orders.address, ship orders only. Name, street lines,
--     landmark and phone stay out: /track needs just an order number and a phone number.
--   item_images: productimages.imageurl for each line with a photo: the item's colour
--     (productcolor = order_items.color) first, then lowest displayorder, then lowest imageid.
-- _order_public_json: adds status_times, delivery_city, delivery_pincode, and items[].image_url
--   (null when there is no photo). Existing fields unchanged.
-- =====================================================================
set local lock_timeout = '3s';

create or replace function public._order_tracking_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status_times',
      coalesce((
        select jsonb_object_agg(t.to_status, t.happened_at)
          from (
            select e.to_status, max(e.created_at) as happened_at
              from public.order_events e
             where e.order_id = o.id
               and e.to_status <> e.from_status
               and e.to_status in ('paid', 'processing', 'processed', 'ready_for_pickup', 'packed',
                                   'shipped', 'out_for_delivery', 'delivered')
               and case when e.to_status = 'paid' then e.kind = 'paid'
                        else e.id > coalesce((select max(r.id) from public.order_events r
                                               where r.order_id = o.id and r.kind in ('sent_back', 'rebooked')), 0)
                   end
             group by e.to_status
          ) t), '{}'::jsonb)
      || case when o.delivered_at is not null then jsonb_build_object('delivered', o.delivered_at) else '{}'::jsonb end,
    'delivery_city', case when o.fulfilment = 'ship' then nullif(btrim(o.address ->> 'city'), '') end,
    'delivery_pincode', case when o.fulfilment = 'ship' then nullif(btrim(o.address ->> 'pincode'), '') end,
    'item_images',
      coalesce((
        select jsonb_object_agg(i.line_no::text, photo.imageurl)
          from public.order_items i
          cross join lateral (
            select p.imageurl
              from public.productimages p
             where p.productid = i.productid and btrim(p.imageurl) <> ''
             order by (p.productcolor = i.color) is true desc, p.displayorder nulls last, p.imageid
             limit 1
          ) photo
         where i.order_id = o.id), '{}'::jsonb))
    from public.orders o
   where o.id = p_order_id
$$;

create or replace function public._order_public_json(o public.orders)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_ref', o.order_ref, 'status', o.status, 'fulfilment', o.fulfilment, 'courier', o.courier,
    'created_at', o.created_at, 'paid_at', o.paid_at,
    'subtotal', o.subtotal, 'promo_discount', o.promo_discount, 'shipping', o.shipping,
    'voucher_applied', o.voucher_applied, 'credit_applied', o.credit_applied,
    'gateway_amount', o.gateway_amount, 'courier_name', o.courier_name, 'awb', o.awb,
    'tracking_label', o.tracking_label,
    'tracking_url', case when o.awb is not null then 'https://shiprocket.co/tracking/' || o.awb
                         when o.courier = 'porter' then o.manual_tracking_url end,
    'status_times', x.tracking -> 'status_times',
    'delivery_city', x.tracking ->> 'delivery_city',
    'delivery_pincode', x.tracking ->> 'delivery_pincode',
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.product_name, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'status', i.status, 'refunded_qty', i.refunded_qty,
        'image_url', x.tracking -> 'item_images' ->> i.line_no::text)
        order by i.line_no) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
    from (select public._order_tracking_json(o.id) as tracking) x
$$;

revoke all on function public._order_tracking_json(uuid) from public, anon, authenticated;
grant execute on function public._order_tracking_json(uuid) to service_role;
revoke all on function public._order_public_json(public.orders) from public, anon, authenticated;
