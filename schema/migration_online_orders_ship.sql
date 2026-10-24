-- Online orders, Ship + admin-action slice: job retry and the checkout live switch.
-- Plan: docs/superpowers/plans/2026-10-23-online-orders.md Tasks 7–8 (R2, R3).
-- Requires: schema/migration_online_orders.sql.
-- Idempotent: safe to apply twice. No BEGIN/COMMIT (exec_sql runs it in one txn).
--
-- ============================== CONTRACT ==============================
-- SECURITY DEFINER, search_path = public, execute granted to service_role only.
--
-- online_job_retry(p_order_id uuid) returns int
--   Makes the order's pending/failed order_jobs due now (failed → pending with
--   attempts reset to 0, so they get a fresh 10 tries). Running jobs are left alone.
--   Clears orders.problem when it is the 'Job <kind> failed: ...' text that
--   online_job_finish writes. Returns the number of jobs reset.
-- online_set_checkout_live(p_live boolean, p_actor uuid) returns jsonb
--   p_actor must be an active superadmin in profiles. Sets
--   storefront_settings.checkout_live and appends storefront_settings_log.
--   Returns {checkout_live, changed, updated_at}.
-- =====================================================================

create table if not exists public.storefront_settings_log (
  id bigint generated always as identity primary key,
  checkout_live boolean not null,
  actor uuid not null,
  created_at timestamptz not null default now()
);
alter table public.storefront_settings_log enable row level security;
revoke all on table public.storefront_settings_log from public, anon, authenticated;
grant all on table public.storefront_settings_log to service_role;

create or replace function public.online_job_retry(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'order % not found', p_order_id;
  end if;
  update public.order_jobs
     set status = 'pending', run_after = now(), locked_until = null,
         attempts = case when status = 'failed' then 0 else attempts end, updated_at = now()
   where order_id = p_order_id and status in ('pending', 'failed');
  get diagnostics v_n = row_count;
  -- only the exact text online_job_finish writes; any other problem stays for staff
  update public.orders set problem = null, updated_at = now()
   where id = p_order_id and problem like 'Job % failed: %';
  if v_n > 0 then
    perform public._online_event(p_order_id, 'jobs_retry', null, null, null, jsonb_build_object('jobs', v_n));
  end if;
  return v_n;
end;
$$;

create or replace function public.online_set_checkout_live(p_live boolean, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.storefront_settings;
  v_old boolean;
begin
  if p_live is null then raise exception 'checkout_live must be true or false'; end if;
  if not exists (select 1 from public.profiles p
                  where p.id = p_actor and p.role = 'superadmin' and p.is_active) then
    raise exception 'only a superadmin can change checkout_live';
  end if;
  select * into s from public.storefront_settings where id = 1 for update;
  if not found then raise exception 'storefront_settings row missing'; end if;
  v_old := s.checkout_live;
  update public.storefront_settings set checkout_live = p_live, updated_at = now()
   where id = 1 returning * into s;
  insert into public.storefront_settings_log (checkout_live, actor) values (p_live, p_actor);
  return jsonb_build_object('checkout_live', s.checkout_live, 'changed', v_old is distinct from p_live,
                            'updated_at', s.updated_at);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_job_retry(uuid)',
    'public.online_set_checkout_live(boolean, uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
