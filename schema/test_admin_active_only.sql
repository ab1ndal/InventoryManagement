-- Tests for schema/migration_admin_active_only.sql. Run after the migrations listed in
-- schema/test_online_orders_customer_tracking.sql, then that migration, then this file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_sub, true),
         set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

begin;
insert into public.profiles (id, email, role, is_active) values
  ('00000000-0000-4000-8000-00000000000a', 'pa@test.invalid', 'admin', true),
  ('00000000-0000-4000-8000-00000000000b', 'pb@test.invalid', 'superadmin', true),
  ('00000000-0000-4000-8000-00000000000d', 'pd@test.invalid', 'admin', false),
  ('00000000-0000-4000-8000-00000000000c', 'pc@test.invalid', 'user', true);

do $$
declare
  ok boolean;
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
  assert public.is_admin(), 'active admin';
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
  assert public.is_admin(), 'active superadmin';
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000000d');
  assert not public.is_admin(), 'deactivated admin';
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
  assert not public.is_admin(), 'customer, even if active';
  perform pg_temp.as_user('00000000-0000-4000-8000-00000000000e');
  assert not public.is_admin(), 'no profile';
  -- No inline role check is left on any order table policy.
  select not exists (
    select 1 from pg_policy pol
     where pol.polname like '%\_admin\_select' and pg_get_expr(pol.polqual, pol.polrelid) ~ 'role'
  ) into ok;
  assert ok, 'all admin select policies use is_admin()';
end $$;
rollback;
