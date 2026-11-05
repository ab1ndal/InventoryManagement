-- Tracking sweeper: re-checks shipped courier orders whose tracking went quiet, in case a
-- courier-status webhook was lost.
--   every 3 h (minute 17)  POST tracking-sweeper
--
-- Same shape and secrets as golive_online_orders_cron.sql: the URL and the cron secret are
-- read at run time from Supabase Vault (online_orders_project_url, online_orders_cron_secret),
-- so no secret is in this file or in cron.job. Deploy the function first
-- (supabase functions deploy tracking-sweeper --use-api --import-map supabase/functions/deno.json).
-- When pg_cron, pg_net or Vault is missing this only raises a NOTICE and schedules nothing.
-- Safe to re-run: the job is unscheduled by name if present, then scheduled again.
-- No BEGIN/COMMIT (exec_sql runs the file in one transaction).

do $outer$
declare
  v_job constant text := 'online-orders-tracking-sweeper';
  v_headers constant text := $h$jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'online_orders_cron_secret'))$h$;
  v_base constant text := $u$(select decrypted_secret from vault.decrypted_secrets where name = 'online_orders_project_url')$u$;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'tracking sweeper cron: pg_cron and/or pg_net not installed; nothing scheduled';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'tracking sweeper cron: Supabase Vault not available; nothing scheduled';
    return;
  end if;

  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = v_job;

  perform cron.schedule(v_job, '17 */3 * * *', format(
    $c$select net.http_post(url := %s || '/functions/v1/tracking-sweeper', headers := %s,
         body := '{}'::jsonb, timeout_milliseconds := 60000)$c$, v_base, v_headers));
end
$outer$;
