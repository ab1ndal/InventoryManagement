-- Online orders: bill-offset helper for refunds made after a Bill of Supply exists.
-- Spec: docs/superpowers/specs/2026-10-26-online-order-unstick-rebook-design.md
-- ("Changes from the adversarial review" item 4).
-- Requires: schema/migration_online_orders.sql (and _r7/_refunds/_ship).
-- Idempotent: safe to apply twice. No BEGIN/COMMIT (exec_sql runs it in one txn).
--
-- ============================== CONTRACT ==============================
-- SECURITY DEFINER, search_path = public, execute granted to service_role only.
--
-- exchanges.order_refund_id uuid, exchanges.order_item_id uuid
--   Which online refund / order item an offset row belongs to. Unique per
--   (order_refund_id, order_item_id) for item rows; unique per order_refund_id for the
--   shipping row (order_item_id null), so the helper is idempotent under any race.
-- _online_bill_offset(p_refund uuid, p_reason text, p_include_shipping boolean) returns void
--   No-op when the order has no bill. Writes one exchanges row per order_refund_items row
--   (reason = p_reason, new_billid = the online bill so in-store billing never offers it as
--   unused credit), links order_refund_items.exchange_id, and when p_include_shipping and the
--   refund has shipping_gateway/shipping_credit legs, one row against the bill's Shipping
--   line worth their sum. Serialised per refund by a row lock; safe to call repeatedly.
-- online_order_rto_received(p_order_id uuid, p_actor uuid) returns uuid
--   Unchanged behaviour; offsets via _online_bill_offset(refund, 'RTO', false).
-- =====================================================================

alter table public.exchanges add column if not exists order_refund_id uuid;
alter table public.exchanges add column if not exists order_item_id uuid;

create unique index if not exists exchanges_refund_item_uidx
  on public.exchanges (order_refund_id, order_item_id) where order_item_id is not null;
create unique index if not exists exchanges_refund_shipping_uidx
  on public.exchanges (order_refund_id) where order_refund_id is not null and order_item_id is null;

create or replace function public._online_bill_offset(p_refund uuid, p_reason text, p_include_shipping boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  ri record;
  v_voucher text;
  v_ship numeric;
  v_ship_item integer;
  v_ex integer;
begin
  -- Row lock serialises concurrent callers for the same refund.
  perform 1 from public.order_refunds where id = p_refund for update;
  if not found then raise exception 'refund % not found', p_refund; end if;
  select o2.* into o from public.orders o2 join public.order_refunds r on r.order_id = o2.id where r.id = p_refund;
  if o.bill_id is null then return; end if;

  select l.voucher_id into v_voucher from public.order_refund_legs l
   where l.refund_id = p_refund and l.voucher_id is not null order by l.created_at limit 1;

  for ri in select x.item_id, x.units, x.credit_amount + x.gateway_amount as value, i.bill_item_id,
                   i.product_name, i.productid
              from public.order_refund_items x join public.order_items i on i.id = x.item_id
             where x.refund_id = p_refund loop
    v_ex := null;
    insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount,
                                  voucher_id, new_billid, product_name, product_code,
                                  order_refund_id, order_item_id)
    values (ri.bill_item_id, ri.units, p_reason, o.customerid, ri.value, v_voucher, o.bill_id,
            ri.product_name, ri.productid, p_refund, ri.item_id)
    on conflict do nothing
    returning exchangeid into v_ex;
    if v_ex is null then
      select e.exchangeid into v_ex from public.exchanges e
       where e.order_refund_id = p_refund and e.order_item_id = ri.item_id;
    end if;
    update public.order_refund_items set exchange_id = v_ex where refund_id = p_refund and item_id = ri.item_id;
  end loop;

  if p_include_shipping then
    select coalesce(sum(l.amount), 0) into v_ship from public.order_refund_legs l
     where l.refund_id = p_refund and l.source in ('shipping_gateway', 'shipping_credit');
    if v_ship > 0 then
      select bi.bill_item_id into v_ship_item from public.bill_items bi
       where bi.billid = o.bill_id and bi.product_name = 'Shipping' and bi.variantid is null
       order by bi.bill_item_id limit 1;
      if v_ship_item is not null then
        insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount,
                                      voucher_id, new_billid, product_name, product_code,
                                      order_refund_id, order_item_id)
        values (v_ship_item, 1, p_reason, o.customerid, v_ship, v_voucher, o.bill_id,
                'Shipping', null, p_refund, null)
        on conflict do nothing;
      end if;
    end if;
  end if;
end;
$$;

create or replace function public.online_order_rto_received(p_order_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_n int;
  v_refund uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status = 'rto_received' then
    return (select r.id from public.order_refunds r where r.order_id = o.id and r.reason = 'rto');
  end if;
  if o.status <> 'rto' then raise exception 'parcel received back is only for RTO orders (now %)', o.status; end if;

  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    v_n := least(it.shipped_qty - it.rto_qty, it.qty - it.refunded_qty);
    if v_n > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', v_n);
      perform public._stock_apply(it.variantid, v_n);
      update public.order_items set rto_qty = rto_qty + v_n where id = it.id;
    end if;
  end loop;

  v_refund := public._online_refund_create(o.id, 'rto', v_units, false, p_actor);

  if v_refund is not null then
    perform public._online_bill_offset(v_refund, 'RTO', false);
  end if;

  update public.orders set status = 'rto_received', updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'rto_received', 'rto', 'rto_received', p_actor,
    jsonb_build_object('refund_id', v_refund, 'units', v_units));
  return v_refund;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._online_bill_offset(uuid, text, boolean)',
    'public.online_order_rto_received(uuid, uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
