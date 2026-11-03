-- A deactivated admin is not an admin (2026-11-03). The app and Edge Functions already refuse them,
-- but is_admin() and the order policies looked only at the role, so that account could still read
-- and change data straight through the API.
--
-- is_admin() now requires an active profile. The order tables' inline role checks move to it, so one
-- function holds the rule.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.profiles
     where profiles.id = auth.uid()
       and profiles.role in ('admin', 'superadmin')
       and profiles.is_active is not false
  );
$function$;

do $$
declare
  r record;
begin
  for r in
    select c.relname, pol.polname
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and pol.polname like '%\_admin\_select'
       and pg_get_expr(pol.polqual, pol.polrelid) ~ 'role'
  loop
    execute format('alter policy %I on public.%I using ((select public.is_admin()))', r.polname, r.relname);
  end loop;
end $$;
