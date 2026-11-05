-- A failed refund leg needs a person to act, so a delayed or repeated Cashfree status must not hide it
-- by moving the leg back to processing. A late success still counts, because the money did move.
-- A future retry of a failed leg must be its own explicit action, not a status passed through here.

create or replace function public.online_refund_set_status(
  p_leg_id uuid, p_status text, p_cf_refund_id text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.order_refund_legs;
  v_order uuid;
begin
  if p_status is null or p_status not in ('processing', 'completed', 'failed') then
    raise exception 'online_refund_set_status: bad status %', p_status;
  end if;
  select * into l from public.order_refund_legs where id = p_leg_id for update;
  if not found then raise exception 'refund leg % not found', p_leg_id; end if;
  if l.destination is distinct from 'original' then
    raise exception 'refund leg % is not a refund to the original method', p_leg_id;
  end if;
  if l.status = 'completed' then
    return;  -- terminal
  end if;
  if l.status = 'failed' and p_status <> 'completed' then
    select order_id into v_order from public.order_refunds where id = l.refund_id;
    perform public._online_event(v_order, 'refund_leg_status_ignored', null, null, null,
      jsonb_build_object('leg_id', l.id, 'status', p_status, 'cf_refund_id', p_cf_refund_id, 'note', p_note));
    return;
  end if;
  update public.order_refund_legs
     set status = p_status, cf_refund_id = coalesce(p_cf_refund_id, cf_refund_id),
         note = coalesce(p_note, note), updated_at = now(),
         completed_at = case when p_status = 'completed' then now() end
   where id = l.id;
  perform public._online_refund_recompute(l.refund_id);
  select order_id into v_order from public.order_refunds where id = l.refund_id;
  perform public._online_event(v_order, 'refund_leg_' || p_status, null, null, null,
    jsonb_build_object('leg_id', l.id, 'cf_refund_id', p_cf_refund_id, 'note', p_note));
end;
$$;
