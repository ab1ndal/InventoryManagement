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
