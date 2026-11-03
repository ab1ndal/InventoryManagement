-- Staff are added by email before they have an account. An invite becomes access the first time
-- someone signs in with that exact email, once Supabase has confirmed they own it. Signups stay open
-- for shop customers, so the confirmation check is what stops a stranger claiming an invited address.
create table public.admin_invites (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null check (role in ('admin', 'superadmin')),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.admin_invites enable row level security;
revoke all on public.admin_invites from anon, authenticated;
grant select, insert, delete on public.admin_invites to authenticated;

-- Superadmin only, matching who can change roles in the Admin page: an invite can grant superadmin.
create policy admin_invites_superadmin_all on public.admin_invites
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'superadmin' and p.is_active is not false
  ))
  with check (exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'superadmin' and p.is_active is not false
  ));

-- Deleting the invite as it is used means a later deactivation sticks: signing in again cannot undo it.
create function public.claim_admin_invite()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role text;
begin
  select lower(u.email) into v_email
    from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then
    return;
  end if;

  delete from public.admin_invites where email = v_email returning role into v_role;
  if v_role is null then
    return;
  end if;

  insert into public.profiles (id, email, role, is_active)
  values (auth.uid(), v_email, v_role, true)
  on conflict (id) do update set role = excluded.role, is_active = true;
end;
$$;

revoke all on function public.claim_admin_invite() from public, anon;
grant execute on function public.claim_admin_invite() to authenticated;
