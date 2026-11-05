-- Behaviour test for migration_admin_only_attributes_prompts.sql. Run inside a transaction that is rolled back:
--   begin; <this file>; rollback;
-- Prints pass or fail flags only.
create temp table t_results (check_name text, ok boolean) on commit drop;
grant all on t_results to authenticated, anon;

create function pg_temp.t_write_blocked(p_sql text) returns boolean language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n = 0;
exception when insufficient_privilege then
  return true;
end $$;

create function pg_temp.t_write_works(p_sql text) returns boolean language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n > 0;
exception when others then
  return false;
end $$;

create function pg_temp.t_run_all(p_who text, p_check text) returns void language plpgsql as $$
declare
  stmt text;
  fn text := case p_check when 'blocked' then 'pg_temp.t_write_blocked' else 'pg_temp.t_write_works' end;
  ok boolean;
begin
  foreach stmt in array array[
    'insert into public.colors (code) values (''zz-test-c-' || p_who || ''')',
    'update public.colors set hex = hex where code = (select min(code) from public.colors)',
    'insert into public.sizes (code, label, size_type, sort_order) values (''zz-test-s-' || p_who || ''', ''z'', (select min(size_type) from public.sizes), 9999)',
    'update public.sizes set label = label where code = (select min(code) from public.sizes)',
    'insert into public.fabrics (code, sort_order) values (''zz-test-f-' || p_who || ''', 9999)',
    'update public.fabrics set sort_order = sort_order where code = (select min(code) from public.fabrics)',
    'insert into public.color_families (family) values (''zz-test-cf-' || p_who || ''')',
    'update public.color_families set hex = hex where family = (select min(family) from public.color_families)',
    'update public.prompts set label = label',
    'delete from public.prompts where false or prompt_id = (select min(prompt_id) from public.prompts)'
  ] loop
    execute format('select %s(%L)', fn, stmt) into ok;
    insert into t_results values (p_who || ' ' || p_check || ': ' || left(stmt, 34), ok);
  end loop;
end $$;

-- Reads stay open for everyone on attributes.
select set_config('request.jwt.claims', '', true);
set local role anon;
insert into t_results select 'anon reads colors', exists (select 1 from public.colors);
insert into t_results select 'anon reads sizes', exists (select 1 from public.sizes);
reset role;

-- A signed-in customer: no profile row.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c002","role":"authenticated"}', true);
set local role authenticated;
insert into t_results select 'customer reads colors', exists (select 1 from public.colors);
insert into t_results select 'customer reads fabrics', exists (select 1 from public.fabrics);
insert into t_results select 'customer cannot read prompts', not exists (select 1 from public.prompts);
select pg_temp.t_run_all('customer', 'blocked');
reset role;

-- A deactivated account with a profile row.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where is_active is false limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into t_results select 'inactive cannot read prompts', not exists (select 1 from public.prompts);
select pg_temp.t_run_all('inactive', 'blocked');
reset role;

-- An active admin.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where role = 'admin' and is_active limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into t_results select 'admin reads prompts', exists (select 1 from public.prompts);
select pg_temp.t_run_all('admin', 'works');
reset role;

-- An active superadmin.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where role = 'superadmin' and is_active limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into t_results select 'superadmin reads prompts', exists (select 1 from public.prompts);
reset role;

select count(*) filter (where ok) as passed,
       count(*) filter (where not ok or ok is null) as failed,
       coalesce(jsonb_agg(check_name) filter (where not ok or ok is null), '[]') as failures
  from t_results;
