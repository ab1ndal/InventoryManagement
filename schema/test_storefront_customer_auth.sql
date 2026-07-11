-- Structural assertions for the storefront customer-auth migration. Identity
-- behaviour (verified email, guarded phone) needs a real authenticated JWT and
-- is exercised at the app level / manually; here we assert shape + grants.
do $$
begin
  assert (select count(*) from information_schema.columns
          where table_name='customers' and column_name='auth_user_id') = 1,
         'customers.auth_user_id missing';
  assert (select count(*) from pg_proc where proname='resolve_my_customer') = 1,
         'resolve_my_customer missing';
  assert (select count(*) from pg_proc where proname='update_my_customer') = 1,
         'update_my_customer missing';
  assert (select prosecdef from pg_proc where proname='resolve_my_customer') = true,
         'resolve_my_customer must be SECURITY DEFINER';
  assert (select prosecdef from pg_proc where proname='update_my_customer') = true,
         'update_my_customer must be SECURITY DEFINER';
  assert (select has_function_privilege('authenticated','resolve_my_customer()','execute')),
         'authenticated must execute resolve_my_customer';
  assert not (select has_function_privilege('anon','resolve_my_customer()','execute')),
         'anon must NOT execute resolve_my_customer';
end $$;
select 'customer-auth assertions passed' as result;
