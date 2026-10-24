-- Online orders, refunds slice: read/list functions for the refund-choice and
-- refund-sweeper Edge Functions and the refund_notify job, plus the
-- "refund completed" email job.
-- Plan: docs/superpowers/plans/2026-10-23-online-orders.md Task 10 (+ R13).
-- Contract: docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md
--   (refund-choice preview shape).
-- Requires: schema/migration_online_orders.sql.
-- Idempotent: safe to apply twice. No BEGIN/COMMIT (exec_sql runs it in one txn).
--
-- ============================== CONTRACT ==============================
-- online_refund_preview(p_token text) returns jsonb  [anon, authenticated]
--   null for an unknown token. Otherwise exactly
--   {orderRef, status, amount, creditPart, gatewayPart,
--    items:[{name, size, color, units}], expiresAt, isGuest}
--   creditPart = credit + shipping_credit legs, gatewayPart = gateway +
--   shipping_gateway legs. Expiry is judged by the caller (expiresAt).
-- online_refund_rate_limited(p_ip_hash text) returns boolean
--   true after 10 failed token attempts in the last hour from this IP hash.
-- online_refund_record_failure(p_ip_hash text) returns void
--   null hash = nothing recorded (same rule as online_order_lookup).
-- online_refund_open_legs(p_refund_id uuid)
--   returns table(leg_id uuid, order_ref text, amount numeric)
--   gateway legs of one refund chosen for the original method and not yet
--   sent to Cashfree (status processing, cf_refund_id null).
-- online_refund_legs_due(p_submit_grace interval default '10 minutes',
--     p_poll_age interval default '1 hour')
--   returns table(leg_id uuid, refund_id uuid, order_ref text, amount numeric,
--     cf_refund_id text, action text)
--   action 'submit': processing original legs never sent to Cashfree whose last
--   change is older than p_submit_grace (the grace keeps the sweeper off legs a
--   refund-choice request is submitting right now). action 'poll': sent legs
--   still processing, last change older than p_poll_age.
-- online_refund_notice(p_refund_id uuid) returns jsonb  -- for emails
--   null for an unknown id. {refundId, orderRef, status, choice, token,
--   tokenExpiresAt, amount, creditPart, gatewayPart, email, name, isGuest,
--   items:[{name, size, color, units, categoryId}],
--   legs:[{source, amount, status, destination, voucher:{code,value,expiry}|null}]}
-- Trigger order_refunds_completed_notify: when a refund that had a choice
--   (store credit or original, i.e. it had a gateway part) becomes completed,
--   enqueues order_jobs (kind 'refund_notify', ref_id '<refund id>:completed').
--   Credit-only refunds never have a choice; their first refund_notify job
--   already tells the shopper the money is back.
-- All functions except online_refund_preview: service_role only.
-- =====================================================================

-- Refund-link guesses are rate limited in the same table as code/lookup attempts.
alter table public.code_attempts drop constraint if exists code_attempts_scope_check;
alter table public.code_attempts add constraint code_attempts_scope_check
  check (scope in ('code', 'lookup', 'refund'));

create or replace function public.online_refund_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.order_refunds;
  o public.orders;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;
  select * into r from public.order_refunds where token = p_token;
  if not found then
    return null;
  end if;
  select * into o from public.orders where id = r.order_id;
  return jsonb_build_object(
    'orderRef', o.order_ref,
    'status', r.status,
    'amount', r.total_amount,
    'creditPart', (select coalesce(sum(l.amount), 0) from public.order_refund_legs l
                    where l.refund_id = r.id and l.source in ('credit', 'shipping_credit')),
    'gatewayPart', (select coalesce(sum(l.amount), 0) from public.order_refund_legs l
                     where l.refund_id = r.id and l.source in ('gateway', 'shipping_gateway')),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'size', i.size,
                                                           'color', i.color, 'units', ri.units)
                                        order by i.line_no)
                         from public.order_refund_items ri join public.order_items i on i.id = ri.item_id
                        where ri.refund_id = r.id), '[]'::jsonb),
    'expiresAt', r.token_expires_at,
    -- Same rule as _online_leg_complete_credit: only verified customers get balance.
    'isGuest', not (o.identity_verified and o.customerid is not null));
end;
$$;

create or replace function public.online_refund_rate_limited(p_ip_hash text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_ip_hash is not null and (
    select count(*) from public.code_attempts a
     where a.scope = 'refund' and a.key = 'ip:' || p_ip_hash and not a.success
       and a.created_at > now() - interval '1 hour') >= 10
$$;

create or replace function public.online_refund_record_failure(p_ip_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.code_attempts (scope, key, success)
  select 'refund', 'ip:' || p_ip_hash, false where p_ip_hash is not null;
$$;

create or replace function public.online_refund_open_legs(p_refund_id uuid)
returns table (leg_id uuid, order_ref text, amount numeric)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, o.order_ref, l.amount
    from public.order_refund_legs l
    join public.order_refunds r on r.id = l.refund_id
    join public.orders o on o.id = r.order_id
   where l.refund_id = p_refund_id and l.status = 'processing' and l.destination = 'original'
     and l.source in ('gateway', 'shipping_gateway') and l.cf_refund_id is null
   order by l.source
$$;

create or replace function public.online_refund_legs_due(
  p_submit_grace interval default interval '10 minutes',
  p_poll_age interval default interval '1 hour')
returns table (leg_id uuid, refund_id uuid, order_ref text, amount numeric, cf_refund_id text, action text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.refund_id, o.order_ref, l.amount, l.cf_refund_id,
         case when l.cf_refund_id is null then 'submit' else 'poll' end
    from public.order_refund_legs l
    join public.order_refunds r on r.id = l.refund_id
    join public.orders o on o.id = r.order_id
   where l.status = 'processing' and l.destination = 'original'
     and l.source in ('gateway', 'shipping_gateway')
     and ((l.cf_refund_id is null and l.updated_at < now() - p_submit_grace)
       or (l.cf_refund_id is not null and l.updated_at < now() - p_poll_age))
   order by l.updated_at
$$;

create or replace function public.online_refund_notice(p_refund_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.order_refunds;
  o public.orders;
begin
  select * into r from public.order_refunds where id = p_refund_id;
  if not found then
    return null;
  end if;
  select * into o from public.orders where id = r.order_id;
  return jsonb_build_object(
    'refundId', r.id,
    'orderRef', o.order_ref,
    'status', r.status,
    'choice', r.choice,
    'token', r.token,
    'tokenExpiresAt', r.token_expires_at,
    'amount', r.total_amount,
    'creditPart', (select coalesce(sum(l.amount), 0) from public.order_refund_legs l
                    where l.refund_id = r.id and l.source in ('credit', 'shipping_credit')),
    'gatewayPart', (select coalesce(sum(l.amount), 0) from public.order_refund_legs l
                     where l.refund_id = r.id and l.source in ('gateway', 'shipping_gateway')),
    'email', nullif(btrim(coalesce(o.contact_email, '')), ''),
    'name', o.contact_name,
    'isGuest', not (o.identity_verified and o.customerid is not null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'size', i.size,
                                                           'color', i.color, 'units', ri.units,
                                                           'categoryId', i.category_id)
                                        order by i.line_no)
                         from public.order_refund_items ri join public.order_items i on i.id = ri.item_id
                        where ri.refund_id = r.id), '[]'::jsonb),
    'legs', coalesce((select jsonb_agg(jsonb_build_object(
                         'source', l.source, 'amount', l.amount, 'status', l.status,
                         'destination', l.destination,
                         'voucher', case when v.voucher_id is null then null else
                           jsonb_build_object('code', v.voucher_id, 'value', v.value, 'expiry', v.expiry_date) end)
                       order by l.source)
                        from public.order_refund_legs l
                        left join public.vouchers v on v.voucher_id = l.voucher_id
                       where l.refund_id = r.id), '[]'::jsonb));
end;
$$;

create or replace function public._online_refund_completed_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.choice is not null then
    perform public._enqueue_job(new.order_id, 'refund_notify', new.id::text || ':completed');
  end if;
  return new;
end;
$$;
drop trigger if exists order_refunds_completed_notify on public.order_refunds;
create trigger order_refunds_completed_notify after update of status on public.order_refunds
  for each row execute function public._online_refund_completed_job();

-- ---------- grants ----------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_refund_preview(text)',
    'public.online_refund_rate_limited(text)',
    'public.online_refund_record_failure(text)',
    'public.online_refund_open_legs(uuid)',
    'public.online_refund_legs_due(interval, interval)',
    'public.online_refund_notice(uuid)',
    'public._online_refund_completed_job()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
grant execute on function public.online_refund_preview(text) to anon, authenticated;
