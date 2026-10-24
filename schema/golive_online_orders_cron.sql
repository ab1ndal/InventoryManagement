-- Online orders: scheduled calls to Edge Functions (plan R2, R5, Task 5, Task 10).
--   every 2 min   POST run-jobs                 drain order_jobs (emails, Shiprocket, refund mails)
--   every 10 min  POST run-jobs {"mode":"expire"} R5: settle pending orders older than 45 min
--   hourly        POST refund-sweeper           48 h default refunds + Cashfree refund polling
--
-- Secrets: read at run time from Supabase Vault (decision: Vault, not a settings
-- table, because Vault keeps them encrypted at rest and out of every table that
-- an admin RLS policy or a backup export can read; the cron command text stored
-- in cron.job holds only the secret NAMES). Before (or after) applying, the
-- controller creates them once in the SQL editor:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'online_orders_project_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'online_orders_cron_secret');
-- Rotate with vault.update_secret(<id>, '<new>'); nothing here needs re-applying.
-- If a secret is missing the job's HTTP call fails (null URL) and is visible in
-- cron.job_run_details; no data changes.
--
-- Requires pg_cron and pg_net (enable both under Database > Extensions). When
-- either is missing this file only raises a NOTICE and schedules nothing, so it
-- is safe on databases without them (e.g. the local test harness).
-- Idempotent: each job is unscheduled by name if present, then scheduled again.
-- No BEGIN/COMMIT (exec_sql runs the file in one transaction).

do $outer$
declare
  v_job text;
  v_headers constant text := $h$jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'online_orders_cron_secret'))$h$;
  v_base constant text := $u$(select decrypted_secret from vault.decrypted_secrets where name = 'online_orders_project_url')$u$;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'online orders cron: pg_cron and/or pg_net not installed; nothing scheduled';
    return;
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'online orders cron: Supabase Vault not available; nothing scheduled';
    return;
  end if;

  foreach v_job in array array['online-orders-run-jobs', 'online-orders-expire', 'online-orders-refund-sweeper'] loop
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = v_job;
  end loop;

  perform cron.schedule('online-orders-run-jobs', '*/2 * * * *', format(
    $c$select net.http_post(url := %s || '/functions/v1/run-jobs', headers := %s,
         body := '{}'::jsonb, timeout_milliseconds := 60000)$c$, v_base, v_headers));

  perform cron.schedule('online-orders-expire', '*/10 * * * *', format(
    $c$select net.http_post(url := %s || '/functions/v1/run-jobs', headers := %s,
         body := '{"mode":"expire"}'::jsonb, timeout_milliseconds := 60000)$c$, v_base, v_headers));

  perform cron.schedule('online-orders-refund-sweeper', '7 * * * *', format(
    $c$select net.http_post(url := %s || '/functions/v1/refund-sweeper', headers := %s,
         body := '{}'::jsonb, timeout_milliseconds := 60000)$c$, v_base, v_headers));
end
$outer$;
