-- Tests for schema/migration_admin_invites.sql. Run locally:
--   scripts/test-db.sh up
--   scripts/test-db.sh sql schema/migration_admin_active_only.sql schema/migration_admin_invites.sql \
--     schema/test_admin_invites.sql
--   scripts/test-db.sh down
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_sub, true),
         set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

begin;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'boss@test.invalid', now()),
  ('00000000-0000-4000-8000-0000000000a2', 'plain-admin@test.invalid', now()),
  ('00000000-0000-4000-8000-0000000000a3', 'off-boss@test.invalid', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'New.Staff@test.invalid', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'squatter@test.invalid', null),
  ('00000000-0000-4000-8000-0000000000b3', 'customer@test.invalid', now()),
  ('00000000-0000-4000-8000-0000000000b4', 'stranger@test.invalid', now());
insert into public.profiles (id, email, role, is_active) values
  ('00000000-0000-4000-8000-0000000000a1', 'boss@test.invalid', 'superadmin', true),
  ('00000000-0000-4000-8000-0000000000a2', 'plain-admin@test.invalid', 'admin', true),
  ('00000000-0000-4000-8000-0000000000a3', 'off-boss@test.invalid', 'superadmin', false),
  ('00000000-0000-4000-8000-0000000000b2', 'squatter@test.invalid', 'user', false),
  ('00000000-0000-4000-8000-0000000000b3', 'customer@test.invalid', 'user', false),
  ('00000000-0000-4000-8000-0000000000b4', 'stranger@test.invalid', 'user', false);

-- Live grants these; the local harness does not.
grant select, update on public.profiles to authenticated;

set local role authenticated;

do $$
declare
  n int;
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
  insert into public.admin_invites (email, role) values
    ('new.staff@test.invalid', 'admin'),
    ('squatter@test.invalid', 'admin'),
    ('customer@test.invalid', 'superadmin');
  select count(*) into n from public.admin_invites;
  assert n = 3, 'superadmin sees invites';
  assert (select invited_by from public.admin_invites where email = 'squatter@test.invalid')
    = '00000000-0000-4000-8000-0000000000a1', 'records who invited';

  begin
    insert into public.admin_invites (email, role) values ('Mixed@test.invalid', 'admin');
    assert false, 'mixed-case email must be rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.admin_invites (email, role) values ('x@test.invalid', 'user');
    assert false, 'only admin roles can be invited';
  exception when check_violation then null;
  end;

  -- Admin, deactivated superadmin and customer can neither see nor add.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
  select count(*) into n from public.admin_invites;
  assert n = 0, 'plain admin sees no invites';
  begin
    insert into public.admin_invites (email, role) values ('self-promote@test.invalid', 'superadmin');
    assert false, 'plain admin cannot invite';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
  select count(*) into n from public.admin_invites;
  assert n = 0, 'deactivated superadmin sees no invites';
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000b4');
  begin
    insert into public.admin_invites (email, role) values ('stranger@test.invalid', 'superadmin');
    assert false, 'customer cannot invite themselves';
  exception when insufficient_privilege then null;
  end;

  -- Exact email only: an uninvited confirmed account gets nothing.
  perform public.claim_admin_invite();
  assert not public.is_admin(), 'uninvited account stays out';

  -- Unconfirmed account holding an invited address gets nothing, and the invite survives.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
  perform public.claim_admin_invite();
  assert not public.is_admin(), 'unconfirmed email cannot claim';

  -- First sign-in, no profile row yet, mixed-case email from the provider.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
  perform public.claim_admin_invite();
  assert public.is_admin(), 'invited person gets in';
  assert (select role from public.profiles where id = auth.uid()) = 'admin', 'gets invited role';

  -- Existing shop customer, invited as superadmin.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
  perform public.claim_admin_invite();
  assert public.is_admin(), 'existing customer upgraded and activated';
  assert (select role from public.profiles where id = auth.uid()) = 'superadmin', 'gets invited role';

  -- The invite is single use: deactivating later sticks across sign-ins.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
  update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000b1';
  select count(*) into n from public.admin_invites;
  assert n = 1, 'used invites are gone, unconfirmed one remains';
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
  perform public.claim_admin_invite();
  assert not public.is_admin(), 'deactivated stays deactivated';
end $$;
rollback;

-- Logged-out callers cannot claim or read.
do $$
begin
  assert not has_function_privilege('anon', 'public.claim_admin_invite()', 'execute'), 'anon cannot claim';
  assert not has_table_privilege('anon', 'public.admin_invites', 'select'), 'anon cannot read';
  assert not has_table_privilege('authenticated', 'public.admin_invites', 'update'), 'no updates';
end $$;
