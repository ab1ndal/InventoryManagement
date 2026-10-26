-- Online returns, Task 1: orders.delivered_at + manual "mark delivered".
-- Run after migration_online_orders_rebook.sql (online_order_apply_tracking below starts from
-- the rebook definition and keeps its hold while op_action = 'rebook').

alter table public.orders add column if not exists delivered_at timestamptz;

-- Backfill from the earliest delivered event (idempotent).
update public.orders o set delivered_at = e.first_at
  from (select order_id, min(created_at) as first_at from public.order_events where kind = 'delivered' group by order_id) e
 where e.order_id = o.id and o.delivered_at is null;

create or replace function public.online_order_apply_tracking(p_awb text, p_status text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  d jsonb := coalesce(p_payload, '{}'::jsonb);
  v_rank_old int;
  v_rank_new int;
  v_label text := coalesce(d ->> 'shipment_status', d ->> 'current_status', d ->> 'status');
  v_sid int := case when (d ->> 'shipment_status_id') ~ '^\d+$' then (d ->> 'shipment_status_id')::int end;
  v_from text;
  v_delivered_at timestamptz;
begin
  select * into o from public.orders where awb = p_awb for update;
  if not found then
    return jsonb_build_object('matched', false, 'changed', false);
  end if;
  v_from := o.status;
  -- R15: raw courier status kept on every update
  update public.orders set tracking_status_id = coalesce(v_sid, tracking_status_id),
         tracking_label = coalesce(v_label, tracking_label), tracking_updated_at = now(), updated_at = now()
   where id = o.id;

  -- Rebook in progress: the old shipment is being cancelled, so its updates must not move the order.
  if o.op_action = 'rebook' then
    perform public._online_event(o.id, 'tracking_held', o.status, o.status, null,
      jsonb_build_object('mapped_status', p_status, 'payload', d));
    return jsonb_build_object('matched', true, 'changed', false, 'held', true, 'status', o.status);
  end if;

  if p_status = 'problem' then
    update public.orders set problem = 'Courier: ' || coalesce(v_label, 'status ' || v_sid::text, 'exception')
     where id = o.id;
    perform public._online_event(o.id, 'courier_problem', o.status, o.status, null, d);
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;
  if p_status = 'cancelled' then
    if o.status in ('packed', 'shipped', 'out_for_delivery') then
      update public.orders set problem = 'Courier cancelled shipment — rebook or cancel' where id = o.id;
      perform public._online_event(o.id, 'courier_cancelled', o.status, o.status, null, d);
    end if;
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;

  v_rank_old := case o.status when 'packed' then 1 when 'shipped' then 2 when 'out_for_delivery' then 3
                              when 'delivered' then 4 when 'rto' then 5 when 'rto_received' then 6 else 0 end;
  v_rank_new := case p_status when 'shipped' then 2 when 'out_for_delivery' then 3 when 'delivered' then 4
                              when 'rto' then 5 else null end;
  if v_rank_new is null or v_rank_old = 0 or v_rank_old >= 4 or v_rank_new <= v_rank_old
     or (p_status = 'rto' and v_rank_old < 2) then
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;

  if p_status = 'delivered' then
    -- delivered_date is an UNVERIFIED Shiprocket key; use it only when it parses.
    begin
      v_delivered_at := (d ->> 'delivered_date')::timestamptz;
    exception when others then
      v_delivered_at := null;
    end;
  end if;
  update public.orders set status = p_status, updated_at = now(),
         delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, v_delivered_at, now()) else delivered_at end
   where id = o.id;
  perform public._online_event(o.id, p_status, v_from, p_status, null, d);
  if p_status in ('shipped', 'out_for_delivery', 'delivered') and v_rank_old < 2 then
    perform public._enqueue_job(o.id, 'email_shipped');
  end if;
  if p_status = 'delivered' then
    perform public._enqueue_job(o.id, 'email_delivered');
  end if;
  return jsonb_build_object('matched', true, 'changed', true, 'status', p_status);
end;
$$;

-- Superadmin-only is enforced in the Edge Function, not here.
create or replace function public.online_order_mark_delivered(
  p_order_id uuid, p_actor uuid, p_delivered_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if o.status not in ('shipped', 'out_for_delivery') or o.delivered_at is not null then
    raise exception 'order % must be shipped or out for delivery and not yet delivered (status %)', p_order_id, o.status;
  end if;
  if o.op_action is not null then
    raise exception 'order % has an operation in progress (%)', p_order_id, o.op_action;
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to mark an order delivered';
  end if;
  if p_delivered_at is null or p_delivered_at > now() then
    raise exception 'delivered date cannot be in the future';
  end if;
  if p_delivered_at < now() - interval '30 days' then
    raise exception 'delivered date cannot be more than 30 days ago';
  end if;
  if o.paid_at is not null and p_delivered_at < o.paid_at then
    raise exception 'delivered date cannot be before the order was paid';
  end if;

  update public.orders set status = 'delivered', delivered_at = p_delivered_at, updated_at = now()
   where id = o.id;
  perform public._online_event(o.id, 'delivered', o.status, 'delivered', p_actor,
    jsonb_build_object('manual', true, 'reason', v_reason, 'actor', p_actor));
  perform public._enqueue_job(o.id, 'email_delivered');
  return jsonb_build_object('changed', true, 'status', 'delivered', 'delivered_at', p_delivered_at);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_order_apply_tracking(text, text, jsonb)',
    'public.online_order_mark_delivered(uuid, uuid, timestamptz, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

-- ===================================================================
-- Task 2: return tables, returnable units, open / cancel
-- ===================================================================
-- Access is only through the service role (admin-order-action): RLS on, no policies.

alter table public.order_refunds drop constraint if exists order_refunds_reason_check;
alter table public.order_refunds add constraint order_refunds_reason_check
  check (reason in ('stock_race', 'unavailable', 'cancel', 'rto', 'return'));

create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (reason in ('damaged_wrong', 'change_of_mind')),
  status text not null default 'open' check (status in ('open', 'refunded', 'rejected', 'cancelled')),
  contacted_at timestamptz not null,
  note text not null,
  return_awb text,
  override_reason text,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  received_by uuid,
  received_at timestamptz,
  receive_note text,
  refund_id uuid references public.order_refunds(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_returns_order_idx on public.order_returns (order_id);

create table if not exists public.order_return_items (
  return_id uuid not null references public.order_returns(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  units integer not null check (units > 0),
  received_units integer check (received_units is null or received_units between 0 and units),
  restock_units integer check (restock_units is null or restock_units between 0 and units),
  primary key (return_id, item_id)
);

create table if not exists public.order_return_photos (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns(id) on delete cascade,
  path text not null unique,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);
create index if not exists order_return_photos_return_idx on public.order_return_photos (return_id);

alter table public.order_returns enable row level security;
alter table public.order_return_items enable row level security;
alter table public.order_return_photos enable row level security;

-- Units of each item still free to return, not floored at 0, leaving out open return
-- p_exclude_return (receive re-checks its own return's units against this).
create or replace function public._online_return_free_units(p_order_id uuid, p_exclude_return uuid)
returns table (item_id uuid, units int)
language sql
stable
security definer
set search_path = public
as $$
  select i.id,
    (i.shipped_qty
      - coalesce((select sum(ri.units) from public.order_return_items ri
                    join public.order_returns r on r.id = ri.return_id
                   where ri.item_id = i.id and r.order_id = i.order_id and r.status = 'open'
                     and r.id is distinct from p_exclude_return), 0)
      - coalesce((select sum(coalesce(ri.received_units, 0)) from public.order_return_items ri
                    join public.order_returns r on r.id = ri.return_id
                   where ri.item_id = i.id and r.order_id = i.order_id and r.status = 'refunded'), 0)
      -- in-store exchanges on the same bill line; rows written by online refunds carry order_refund_id
      - coalesce((select sum(e.quantity) from public.exchanges e
                   where i.bill_item_id is not null and e.original_bill_item_id = i.bill_item_id
                     and e.order_refund_id is null), 0)
    )::int
  from public.order_items i
  where i.order_id = p_order_id;
$$;

-- Units of each item that can still be returned. Callers that act on the result must hold the
-- order row lock (online_return_open does).
create or replace function public.online_return_returnable(p_order_id uuid)
returns table (item_id uuid, units int)
language sql
stable
security definer
set search_path = public
as $$
  select f.item_id, greatest(0, f.units) from public._online_return_free_units(p_order_id, null) f;
$$;

create or replace function public.online_return_open(
  p_order_id uuid, p_actor uuid, p_is_superadmin boolean, p_reason text, p_contacted_at timestamptz,
  p_items jsonb, p_note text, p_return_awb text, p_override_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_id uuid := gen_random_uuid();
  v_window interval;
  v_elapsed interval;
  v_override text := btrim(coalesce(p_override_reason, ''));
  v_outside boolean;
  e jsonb;
  v_item uuid;
  v_units int;
  v_avail int;
  v_total int := 0;
begin
  -- Order lock first: serialises concurrent opens so returnable units cannot be double-counted.
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;
  if o.status <> 'delivered' or o.delivered_at is null then
    raise exception 'order % is not delivered (status %)', p_order_id, o.status;
  end if;
  if p_reason is null or p_reason not in ('damaged_wrong', 'change_of_mind') then
    raise exception 'invalid return reason %', p_reason;
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'a note is required to open a return';
  end if;
  if p_contacted_at is null or p_contacted_at > now() then
    raise exception 'contact time cannot be in the future';
  end if;
  if p_contacted_at < o.delivered_at then
    raise exception 'contact time cannot be before delivery';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'return needs at least one item';
  end if;

  v_window := case p_reason when 'damaged_wrong' then interval '48 hours' else interval '7 days' end;
  v_elapsed := p_contacted_at - o.delivered_at;
  v_outside := v_elapsed > v_window;
  if v_outside and not (coalesce(p_is_superadmin, false) and v_override <> '') then
    raise exception 'return window closed (% of %)', v_elapsed, v_window;
  end if;

  insert into public.order_returns (id, order_id, reason, contacted_at, note, return_awb, override_reason, opened_by)
  values (v_id, o.id, p_reason, p_contacted_at, btrim(p_note), nullif(btrim(coalesce(p_return_awb, '')), ''),
          case when v_outside then v_override end, p_actor);

  for e in select * from jsonb_array_elements(p_items) loop
    v_item := (e ->> 'item_id')::uuid;
    v_units := (e ->> 'units')::int;
    if v_item is null or v_units is null or v_units <= 0 then
      raise exception 'invalid return item %', e;
    end if;
    select r.units into v_avail from public.online_return_returnable(o.id) r where r.item_id = v_item;
    if v_avail is null then
      raise exception 'item % is not on order %', v_item, o.id;
    end if;
    if v_units > v_avail then
      raise exception 'only % returnable unit(s) for item %, asked for %', v_avail, v_item, v_units;
    end if;
    -- primary key rejects the same item listed twice
    insert into public.order_return_items (return_id, item_id, units) values (v_id, v_item, v_units);
    v_total := v_total + v_units;
  end loop;

  perform public._online_event(o.id, 'return_opened', o.status, o.status, p_actor,
    jsonb_build_object('return_id', v_id, 'reason', p_reason, 'units', v_total,
      'contacted_at', p_contacted_at, 'override_reason', case when v_outside then v_override end));
  return v_id;
end;
$$;

create or replace function public.online_return_cancel(p_return_id uuid, p_actor uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.order_returns;
  o public.orders;
begin
  -- Same lock order as open: order row first, then the return row.
  select r.* into ret from public.order_returns r where r.id = p_return_id;
  if not found then
    raise exception 'return % not found', p_return_id;
  end if;
  select * into o from public.orders where id = ret.order_id for update;
  select * into ret from public.order_returns where id = p_return_id for update;
  if ret.status <> 'open' then
    raise exception 'return % is % and cannot be cancelled', p_return_id, ret.status;
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'a note is required to cancel a return';
  end if;
  update public.order_returns set status = 'cancelled', updated_at = now() where id = ret.id;
  perform public._online_event(o.id, 'return_cancelled', o.status, o.status, p_actor,
    jsonb_build_object('return_id', ret.id, 'note', btrim(p_note)));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_return_returnable(uuid)',
    'public.online_return_open(uuid, uuid, boolean, text, timestamptz, jsonb, text, text, text)',
    'public.online_return_cancel(uuid, uuid, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

-- ===================================================================
-- Task 3: receive and refund, preview
-- ===================================================================

-- Validates receive input for an open return and works out what to refund:
-- {units: [{item_id, units}] (received > 0 only), include_shipping, received, short}.
-- Shipping (damaged_wrong only) when, after this receive, every shipped unit of the order has
-- been received back across refunded returns. Receive calls this under its locks; preview without.
create or replace function public._online_return_plan(p_return_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ret public.order_returns;
  e jsonb;
  ri public.order_return_items;
  v_item uuid;
  v_recv int;
  v_restock int;
  v_avail int;
  v_seen uuid[] := '{}';
  v_units jsonb := '[]'::jsonb;
  v_received int := 0;
  v_short boolean := false;
  v_shipped int;
  v_back int;
begin
  select * into ret from public.order_returns where id = p_return_id;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'received items must be a list';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    v_item := (e ->> 'item_id')::uuid;
    v_recv := (e ->> 'received_units')::int;
    v_restock := (e ->> 'restock_units')::int;
    select * into ri from public.order_return_items where return_id = ret.id and item_id = v_item;
    if not found then
      raise exception 'item % is not on return %', v_item, ret.id;
    end if;
    if v_item = any(v_seen) then
      raise exception 'item % listed twice', v_item;
    end if;
    v_seen := v_seen || v_item;
    if v_recv is null or v_recv < 0 or v_recv > ri.units then
      raise exception 'received pieces for item % must be 0 to %, got %', v_item, ri.units, v_recv;
    end if;
    if v_restock is null or v_restock < 0 or v_restock > v_recv then
      raise exception 'restock pieces for item % must be 0 to % (received), got %', v_item, v_recv, v_restock;
    end if;
    -- unfloored, so units exchanged in store beyond this return's own count still show
    select f.units into v_avail from public._online_return_free_units(ret.order_id, ret.id) f where f.item_id = v_item;
    if v_recv > v_avail then
      raise exception 'item % was exchanged in store; reduce received pieces', v_item;
    end if;
    if v_recv > 0 then
      v_units := v_units || jsonb_build_object('item_id', v_item, 'units', v_recv);
    end if;
    v_received := v_received + v_recv;
    v_short := v_short or v_recv < ri.units;
  end loop;
  if cardinality(v_seen) <> (select count(*) from public.order_return_items where return_id = ret.id) then
    raise exception 'every item on return % must be listed', ret.id;
  end if;

  select coalesce(sum(i.shipped_qty), 0) into v_shipped from public.order_items i where i.order_id = ret.order_id;
  select coalesce(sum(x.received_units), 0) into v_back
    from public.order_return_items x join public.order_returns r on r.id = x.return_id
   where r.order_id = ret.order_id and r.status = 'refunded';
  return jsonb_build_object('units', v_units, 'received', v_received, 'short', v_short,
    'include_shipping', ret.reason = 'damaged_wrong' and v_received > 0 and v_back + v_received >= v_shipped);
end;
$$;

-- Amounts _online_refund_create would refund for p_units (same _cum_alloc split from the current
-- refunded_qty, same shipping rule), without writing. Keep in step with _online_refund_create:
-- online_return_receive raises if the two ever disagree.
create or replace function public._online_return_amounts(p_order_id uuid, p_units jsonb, p_include_shipping boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  u record;
  v_credit numeric(12,2) := 0;
  v_gateway numeric(12,2) := 0;
  v_ship numeric(12,2) := 0;
begin
  select * into o from public.orders where id = p_order_id;
  if p_include_shipping and o.shipping > 0 and not exists (
       select 1 from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
        where r.order_id = o.id and l.source in ('shipping_credit', 'shipping_gateway')) then
    v_ship := o.shipping_credit_part + o.shipping_gateway_part;
  end if;
  for u in select x.item_id, x.units from jsonb_to_recordset(coalesce(p_units, '[]'::jsonb)) as x(item_id uuid, units int)
            where x.units > 0 loop
    select * into it from public.order_items where id = u.item_id and order_id = o.id;
    if not found then
      raise exception 'refund: item % not in order %', u.item_id, o.order_ref;
    end if;
    if it.refunded_qty + u.units > it.qty then
      raise exception 'refund: item % would refund % of % units', it.id, it.refunded_qty + u.units, it.qty;
    end if;
    v_credit := v_credit + public._cum_alloc(it.credit_part, it.qty, it.refunded_qty + u.units)
                         - public._cum_alloc(it.credit_part, it.qty, it.refunded_qty);
    v_gateway := v_gateway + public._cum_alloc(it.gateway_part, it.qty, it.refunded_qty + u.units)
                           - public._cum_alloc(it.gateway_part, it.qty, it.refunded_qty);
  end loop;
  return jsonb_build_object('credit_part', v_credit, 'gateway_part', v_gateway, 'shipping', v_ship,
                            'total', v_credit + v_gateway + v_ship);
end;
$$;

create or replace function public._online_return_refund_json(p_refund uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('credit_part', r.credit_amount, 'gateway_part', r.gateway_amount,
                            'shipping', r.shipping_amount, 'total', r.total_amount)
    from public.order_refunds r where r.id = p_refund
$$;

-- Read-only refund preview for the receive dialog; receive recomputes under its locks.
create or replace function public.online_return_preview(p_return_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ret public.order_returns;
  v_plan jsonb;
begin
  select * into ret from public.order_returns where id = p_return_id;
  if not found then
    raise exception 'return % not found', p_return_id;
  end if;
  if ret.status <> 'open' then
    raise exception 'return % is %', p_return_id, ret.status;
  end if;
  v_plan := public._online_return_plan(ret.id, p_items);
  return public._online_return_amounts(ret.order_id, v_plan -> 'units', (v_plan ->> 'include_shipping')::boolean);
end;
$$;

-- p_items: [{item_id, received_units, restock_units}] for every item on the return.
-- Returns {status, refund_id, refund: {credit_part, gateway_part, shipping, total}}; a repeat call on a
-- refunded / rejected return returns the stored result.
create or replace function public.online_return_receive(p_return_id uuid, p_actor uuid, p_items jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.order_returns;
  o public.orders;
  v_plan jsonb;
  v_ship boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_expected jsonb;
  v_refund uuid;
  v_actual jsonb;
  e jsonb;
  v_restocked int := 0;
begin
  select * into ret from public.order_returns where id = p_return_id;
  if not found then
    raise exception 'return % not found', p_return_id;
  end if;
  -- Lock order shared with open/cancel and the in-store exchange RPC: order, bill items by id, return.
  select * into o from public.orders where id = ret.order_id for update;
  perform 1 from public.bill_items where billid = o.bill_id order by bill_item_id for update;
  select * into ret from public.order_returns where id = p_return_id for update;

  if ret.status in ('refunded', 'rejected') then
    return jsonb_build_object('status', ret.status, 'refund_id', ret.refund_id,
                              'refund', public._online_return_refund_json(ret.refund_id));
  end if;
  if ret.status <> 'open' then
    raise exception 'return % is % and cannot be received', p_return_id, ret.status;
  end if;

  v_plan := public._online_return_plan(ret.id, p_items);
  v_ship := (v_plan ->> 'include_shipping')::boolean;
  if (v_plan ->> 'short')::boolean and v_note is null then
    raise exception 'a note is required when pieces fail the check';
  end if;
  if ret.reason = 'damaged_wrong'
     and not exists (select 1 from public.order_return_photos where return_id = ret.id) then
    raise exception 'add at least one photo before receiving a damaged/wrong return';
  end if;

  for e in select * from jsonb_array_elements(p_items) loop
    update public.order_return_items
       set received_units = (e ->> 'received_units')::int, restock_units = (e ->> 'restock_units')::int
     where return_id = ret.id and item_id = (e ->> 'item_id')::uuid;
  end loop;

  if (v_plan ->> 'received')::int = 0 then
    update public.order_returns
       set status = 'rejected', received_by = p_actor, received_at = now(), receive_note = v_note, updated_at = now()
     where id = ret.id;
    perform public._online_event(o.id, 'return_rejected', o.status, o.status, p_actor,
      jsonb_build_object('return_id', ret.id, 'note', v_note));
    return jsonb_build_object('status', 'rejected', 'refund_id', null, 'refund', null);
  end if;

  for e in select x.value from jsonb_array_elements(p_items) x where (x.value ->> 'restock_units')::int > 0 loop
    perform public._stock_apply(
      (select i.variantid from public.order_items i where i.id = (e ->> 'item_id')::uuid),
      (e ->> 'restock_units')::int);
    v_restocked := v_restocked + (e ->> 'restock_units')::int;
  end loop;

  v_expected := public._online_return_amounts(o.id, v_plan -> 'units', v_ship);
  v_refund := public._online_refund_create(o.id, 'return', v_plan -> 'units', v_ship, p_actor);
  v_actual := public._online_return_refund_json(v_refund);
  if v_actual is distinct from v_expected then
    raise exception 'return refund % differs from preview % (return %)', v_actual, v_expected, ret.id;
  end if;
  perform public._online_bill_offset(v_refund,
    case ret.reason when 'damaged_wrong' then 'Return: damaged/wrong' else 'Return: change of mind' end, v_ship);

  update public.order_returns
     set status = 'refunded', refund_id = v_refund, received_by = p_actor, received_at = now(),
         receive_note = v_note, updated_at = now()
   where id = ret.id;
  perform public._online_event(o.id, 'return_refunded', o.status, o.status, p_actor,
    jsonb_build_object('return_id', ret.id, 'refund_id', v_refund, 'received', (v_plan ->> 'received')::int,
      'restocked', v_restocked, 'include_shipping', v_ship, 'amounts', v_actual));
  return jsonb_build_object('status', 'refunded', 'refund_id', v_refund, 'refund', v_actual);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._online_return_free_units(uuid, uuid)',
    'public._online_return_plan(uuid, jsonb)',
    'public._online_return_amounts(uuid, jsonb, boolean)',
    'public._online_return_refund_json(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.online_return_preview(uuid, jsonb)',
    'public.online_return_receive(uuid, uuid, jsonb, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

-- ===================================================================
-- Task 4: return photos (private bucket, server-built paths)
-- ===================================================================

-- Skipped where there is no storage schema (local test harness).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('order-returns', 'order-returns', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
    on conflict (id) do update
      set public = false,
          file_size_limit = 10485760,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  end if;
end $$;

-- Clients never choose a path: the server asks for one per return and uploads to exactly it.
create or replace function public.online_return_photo_path(p_return_id uuid, p_ext text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.order_returns%rowtype;
  v_ext text := lower(btrim(coalesce(p_ext, '')));
begin
  select * into ret from public.order_returns where id = p_return_id;
  if not found then
    raise exception 'return % not found', p_return_id;
  end if;
  if ret.status <> 'open' then
    raise exception 'return % is % and cannot take photos', p_return_id, ret.status;
  end if;
  if v_ext not in ('jpg', 'png', 'webp', 'heic') then
    raise exception 'unsupported photo extension %, use jpg, png, webp or heic', v_ext;
  end if;
  return ret.order_id || '/' || ret.id || '/' || gen_random_uuid() || '.' || v_ext;
end;
$$;

-- Records an uploaded photo. The path must be exactly the shape online_return_photo_path issues
-- for this return; a duplicate path raises a unique violation.
create or replace function public.online_return_add_photo(p_return_id uuid, p_path text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.order_returns%rowtype;
  v_id uuid;
begin
  select * into ret from public.order_returns where id = p_return_id for update;
  if not found then
    raise exception 'return % not found', p_return_id;
  end if;
  if ret.status <> 'open' then
    raise exception 'return % is % and cannot take photos', p_return_id, ret.status;
  end if;
  -- \A..\Z: plain $ would accept a trailing newline
  if p_path is null or p_path !~ ('\A' || ret.order_id || '/' || ret.id || '/[0-9a-f-]{36}\.(jpg|png|webp|heic)\Z') then
    raise exception 'invalid photo path for return %', p_return_id;
  end if;
  insert into public.order_return_photos (return_id, path, uploaded_by)
  values (ret.id, p_path, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_return_photo_path(uuid, text)',
    'public.online_return_add_photo(uuid, text, uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

-- ===================================================================
-- Task 7: in-store exchange as one locked RPC
-- ===================================================================
-- Replaces ExchangePage's three browser writes (restock, manual stock, exchanges insert) with one
-- transaction, and re-checks the returnable quantity under the same locks online_return_receive takes
-- (order row, then bill_items by id), so a unit can't be exchanged in store and refunded online.
-- p_items: [{bill_item_id, quantity, credit_amount, reason, product_name, product_code, variantid,
-- manual_item_id}]. Returns the new exchange ids in input order.
create or replace function public.exchange_record(p_billid int, p_customerid int, p_items jsonb)
returns int[]
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  e jsonb;
  bi public.bill_items;
  v_qty int;
  v_used numeric;
  v_shipped int;
  v_free int;
  v_id int;
  v_ids int[] := '{}';
begin
  -- same guard as stock_adjust: active admins (and service_role) only
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or p_items = '[]'::jsonb then
    raise exception 'exchange_record: no items';
  end if;

  select * into o from public.orders where bill_id = p_billid for update;
  -- in transit: a later RTO would restock and offset the same unit again (ruling RA6)
  if o.id is not null and o.delivered_at is null then
    raise exception 'online order not delivered yet';
  end if;
  perform 1 from public.bill_items
   where bill_item_id in (select (x ->> 'bill_item_id')::int from jsonb_array_elements(p_items) x)
   order by bill_item_id for update;

  for e in select * from jsonb_array_elements(p_items) loop
    select * into bi from public.bill_items where bill_item_id = (e ->> 'bill_item_id')::int;
    if not found or bi.billid <> p_billid then
      raise exception 'item % is not on bill %', e ->> 'bill_item_id', p_billid;
    end if;
    v_qty := (e ->> 'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'item %: quantity must be positive', bi.bill_item_id;
    end if;

    -- every exchanges row on the line counts, online refund offsets included
    select coalesce(sum(quantity), 0) into v_used from public.exchanges where original_bill_item_id = bi.bill_item_id;
    if v_used + v_qty > bi.quantity then
      raise exception 'item % already returned (% of %)', bi.bill_item_id, v_used, trim_scale(bi.quantity);
    end if;

    -- online bill: units in an open return or already refunded are not free either (ruling RA3)
    if o.id is not null then
      select sum(i.shipped_qty), sum(f.units) into v_shipped, v_free
        from public._online_return_free_units(o.id, null) f
        join public.order_items i on i.id = f.item_id
       where i.bill_item_id = bi.bill_item_id;
      if v_free is not null and v_qty > v_free then
        raise exception 'item % already returned (% of %)', bi.bill_item_id, v_shipped - v_free, v_shipped;
      end if;
    end if;

    if bi.variantid is not null then
      perform public._stock_apply(bi.variantid, v_qty);
    elsif nullif(e ->> 'manual_item_id', '') is not null then
      update public.manual_items set stock = coalesce(stock, 0) + v_qty
       where manual_item_id = e ->> 'manual_item_id';
    end if;

    insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount, voucher_id,
                                  product_name, product_code)
    values (bi.bill_item_id, v_qty, e ->> 'reason', p_customerid, (e ->> 'credit_amount')::numeric, null,
            e ->> 'product_name', e ->> 'product_code')
    returning exchangeid into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;
revoke all on function public.exchange_record(int, int, jsonb) from public, anon;
grant execute on function public.exchange_record(int, int, jsonb) to authenticated, service_role;
