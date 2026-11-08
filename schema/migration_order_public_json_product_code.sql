-- Customer order JSON (/track lookup, account orders) carries each line's product
-- code, so a customer can quote it for an exchange and staff find the item.
-- Body copied from the live definition (pg_get_functiondef, 2026-11-07);
-- only the items object gains 'productid'.

CREATE OR REPLACE FUNCTION public._order_public_json(o orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'order_ref', o.order_ref, 'status', o.status, 'fulfilment', o.fulfilment, 'courier', o.courier,
    'created_at', o.created_at, 'paid_at', o.paid_at,
    'subtotal', o.subtotal, 'promo_discount', o.promo_discount, 'shipping', o.shipping,
    'voucher_applied', o.voucher_applied, 'credit_applied', o.credit_applied,
    'gateway_amount', o.gateway_amount, 'courier_name', o.courier_name, 'awb', o.awb,
    'tracking_number', o.manual_tracking_number,
    'tracking_label', o.tracking_label,
    'tracking_url', case when o.awb is not null then 'https://shiprocket.co/tracking/' || o.awb
                         when o.courier = 'porter' then o.manual_tracking_url end,
    'status_times', x.tracking -> 'status_times',
    'delivery_city', x.tracking ->> 'delivery_city',
    'delivery_pincode', x.tracking ->> 'delivery_pincode',
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.product_name, 'productid', i.productid, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'status', i.status, 'refunded_qty', i.refunded_qty,
        'image_url', x.tracking -> 'item_images' ->> i.line_no::text)
        order by i.line_no) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
    from (select public._order_tracking_json(o.id) as tracking) x
$function$

;
