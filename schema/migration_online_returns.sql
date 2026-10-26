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

-- Units of each item that can still be returned. Callers that act on the result must hold the
-- order row lock (online_return_open does).
create or replace function public.online_return_returnable(p_order_id uuid)
returns table (item_id uuid, units int)
language sql
stable
security definer
set search_path = public
as $$
  select i.id,
    greatest(0,
      i.shipped_qty
      - coalesce((select sum(ri.units) from public.order_return_items ri
                    join public.order_returns r on r.id = ri.return_id
                   where ri.item_id = i.id and r.order_id = i.order_id and r.status = 'open'), 0)
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
