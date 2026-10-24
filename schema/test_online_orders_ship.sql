-- Tests for schema/migration_online_orders_ship.sql. Each test is rollback-wrapped.
-- Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql \
--     schema/migration_online_orders.sql schema/migration_online_orders_ship.sql \
--     schema/test_online_orders_ship.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.mk_order() returns uuid language sql as $$
  insert into public.orders (status, contact_name, contact_phone, address, subtotal, gateway_amount)
  values ('paid', 'Test', '+919999999999', '{"pincode":"201001"}', 100, 100)
  returning id
$$;

-- online_job_retry: failed + pending reset, running/done untouched, job-failure problem cleared
begin;
do $$
declare
  o uuid := pg_temp.mk_order();
  n int;
begin
  insert into public.order_jobs (order_id, kind, status, attempts, last_error, run_after)
  values (o, 'shiprocket_create', 'failed', 10, 'boom', now() + interval '1 hour'),
         (o, 'email_confirmed', 'pending', 3, 'smtp', now() + interval '30 minutes'),
         (o, 'email_shop', 'done', 1, null, now() - interval '1 hour'),
         (o, 'refund_notify', 'running', 1, null, now());
  update public.orders set problem = 'Job shiprocket_create failed: boom' where id = o;

  n := public.online_job_retry(o);
  assert n = 2, 'two jobs reset, got ' || n;
  assert (select status = 'pending' and attempts = 0 and run_after <= now()
            from public.order_jobs where order_id = o and kind = 'shiprocket_create'), 'failed job reset';
  assert (select status = 'pending' and attempts = 3 and run_after <= now()
            from public.order_jobs where order_id = o and kind = 'email_confirmed'), 'pending job due now, attempts kept';
  assert (select status from public.order_jobs where order_id = o and kind = 'email_shop') = 'done', 'done untouched';
  assert (select status from public.order_jobs where order_id = o and kind = 'refund_notify') = 'running', 'running untouched';
  assert (select problem from public.orders where id = o) is null, 'job-failure problem cleared';
  assert exists (select 1 from public.order_events where order_id = o and kind = 'jobs_retry'), 'event logged';
end $$;
rollback;

-- online_job_retry keeps other problems; unknown order raises
begin;
do $$
declare
  o uuid := pg_temp.mk_order();
  ok boolean := false;
begin
  update public.orders set problem = 'Courier: Lost' where id = o;
  assert public.online_job_retry(o) = 0, 'nothing to reset';
  assert (select problem from public.orders where id = o) = 'Courier: Lost', 'courier problem kept';
  begin
    perform public.online_job_retry(gen_random_uuid());
  exception when others then ok := true;
  end;
  assert ok, 'unknown order raises';
end $$;
rollback;

-- online_set_checkout_live: superadmin only, logs every change
begin;
do $$
declare
  su uuid := gen_random_uuid();
  ad uuid := gen_random_uuid();
  off_su uuid := gen_random_uuid();
  r jsonb;
  ok boolean := false;
begin
  insert into public.profiles (id, email, role, is_active) values
    (su, 'su@t.in', 'superadmin', true), (ad, 'ad@t.in', 'admin', true), (off_su, 'off@t.in', 'superadmin', false);
  update public.storefront_settings set checkout_live = false where id = 1;

  r := public.online_set_checkout_live(true, su);
  assert (r ->> 'checkout_live')::boolean and (r ->> 'changed')::boolean, 'flipped on: ' || r::text;
  assert (select checkout_live from public.storefront_settings where id = 1), 'row updated';
  r := public.online_set_checkout_live(true, su);
  assert not (r ->> 'changed')::boolean, 'repeat reports unchanged';
  assert (select count(*) from public.storefront_settings_log where actor = su) = 2, 'both calls logged';

  begin
    perform public.online_set_checkout_live(false, ad);
  exception when others then ok := true;
  end;
  assert ok, 'admin cannot flip';
  ok := false;
  begin
    perform public.online_set_checkout_live(false, off_su);
  exception when others then ok := true;
  end;
  assert ok, 'deactivated superadmin cannot flip';
  assert (select checkout_live from public.storefront_settings where id = 1), 'still on';
end $$;
rollback;

-- grants: service_role only
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.online_job_retry(uuid)', 'execute'), 'anon retry';
  assert not has_function_privilege('authenticated', 'public.online_set_checkout_live(boolean, uuid)', 'execute'),
    'authenticated live';
  assert has_function_privilege('service_role', 'public.online_set_checkout_live(boolean, uuid)', 'execute'),
    'service live';
  assert not has_table_privilege('authenticated', 'public.storefront_settings_log', 'select'), 'log hidden';
end $$;
rollback;

select 'test_online_orders_ship: all passed' as result;
