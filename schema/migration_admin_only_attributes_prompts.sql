-- Colours, sizes, fabrics, colour families: everyone can still read them, only
-- active admins can add or change them. AI prompts: active admins only.
-- The service role (mockup-generator's backend, when configured) bypasses RLS.
begin;

drop policy if exists "authenticated insert colors" on public.colors;
drop policy if exists "authenticated update colors" on public.colors;
create policy "admin insert colors" on public.colors
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin update colors" on public.colors
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "authenticated insert sizes" on public.sizes;
drop policy if exists "authenticated update sizes" on public.sizes;
create policy "admin insert sizes" on public.sizes
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin update sizes" on public.sizes
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "authenticated insert fabrics" on public.fabrics;
drop policy if exists "authenticated update fabrics" on public.fabrics;
create policy "admin insert fabrics" on public.fabrics
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin update fabrics" on public.fabrics
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "authenticated insert color_families" on public.color_families;
drop policy if exists "authenticated update color_families" on public.color_families;
create policy "admin insert color_families" on public.color_families
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin update color_families" on public.color_families
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "prompts_authenticated_all" on public.prompts;
create policy "prompts_admin_all" on public.prompts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

commit;
