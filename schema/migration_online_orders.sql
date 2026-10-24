-- Online orders: tables, settings, RLS and state/money functions.
-- Spec: docs/superpowers/specs/2026-10-23-online-orders-design.md
-- Plan: docs/superpowers/plans/2026-10-23-online-orders.md, Task 1 + revisions
--       R2 (order_jobs), R3 (claim/checkpoint), R4 (confirm contract), R5 (expiry by
--       caller), R8 (identity), R10 (access token), R12 (promo reservations),
--       R13 (refund legs), R14 (RTO via exchanges), R15 (raw courier status, problem).
-- Requires: schema/migration_atomic_shared_writes.sql (store_credit_ledger,
--           vouchers.held_order_id, _stock_apply, _store_credit_apply).
-- Idempotent: safe to apply twice. No BEGIN/COMMIT (exec_sql runs it in one txn).
--
-- Live columns used (fetched 2026-10-23, schema/test_harness/bootstrap.sql):
--   customers(customerid int, phone varchar(20) check '^\+\d{10,15}$', email, first_name
--     varchar(50) not null, last_name, customer_ulid varchar(26) not null unique,
--     store_credit double precision, is_guest bool, auth_user_id uuid unique)
--   vouchers(voucher_id text pk, customerid, issue_date date, expiry_date date not null,
--     value numeric(10,2), redeemed bool, redeemed_at timestamp, redeemed_billid int,
--     note, source check)
--   discounts(id, code unique, type, value, max_discount, once_per_customer, min_total,
--     start_date, end_date timestamp (date-only in practice), rules jsonb, active)
--   discount_usage(id identity, customerid not null, code, used_at, billid)
--   bills(billid int, customerid, orderdate, totalamount, paymentstatus, saleslocationid,
--     salesmethodid, notes, gst_total, discount_total, taxable_total, finalized,
--     applied_codes text[], payment_amount, final_amount, store_credit_used,
--     bill_number (trigger set_bill_number), document_type 'invoice'|'bos')
--   bill_items(bill_item_id, billid, quantity numeric(10,3), mrp, variantid, product_name,
--     product_code, category (= products.categoryid), discount_total, subtotal, gst_rate,
--     gst_amount, total, cost_price, stitch_type, unit_type)
--   salesmethods(salesmethodid serial, methodname varchar(50))
--   productsizecolors(variantid uuid, productid, size, color, stock numeric(10,3))
--   products(productid, name, categoryid, purchaseprice, retailprice, unit_type)
--   categories(categoryid, name); profiles(id, role)
--   exchanges(exchangeid, original_bill_item_id, quantity int, reason, customerid,
--     credit_amount numeric(10,2), voucher_id, new_billid, product_name, product_code)
--
-- ============================== CONTRACT ==============================
-- All functions: SECURITY DEFINER, search_path = public. Execute granted to
-- service_role only, except where marked [anon] / [authenticated].
-- Money in rupees numeric(12,2); splits are done in integer paise.
--
-- online_order_create(p_order jsonb, p_items jsonb, p_auth_user uuid)
--   returns table(order_id uuid, order_ref text, created boolean)
--   p_order keys: attempt_key uuid?, contact {name, phone, email?}, address jsonb
--     (must include pincode), promo_code?, voucher_code? (at most one code),
--     subtotal, promo_discount, shipping, voucher_applied, credit_applied,
--     gateway_amount, quoted_courier_id?, access_token_hash? (hex sha-256).
--   p_items: [{variant_id, qty, unit_price, promo_share, credit_part}] where
--     credit_part = the line's share of (voucher_applied + credit_applied).
--   Re-validates everything: checkout_live, retail prices, sums, promo maths
--   (flat/percentage/conditional like billUtils.valueOfDiscount), shipping rule,
--   voucher eligibility, credit balance. Identity: p_auth_user (verified JWT) with a
--   linked customers row → that customer, store credit and owned vouchers allowed;
--   otherwise guest: matched by phone or a new is_guest row, and NO store credit or
--   customer-owned vouchers (R8). Holds credit (ledger 'hold'), voucher
--   (held_order_id) and once-per-customer promo (promo_reservations).
--   Repeat attempt_key → returns the existing order with created = false.
-- online_order_confirm_payment(p_order_ref text, p_cf_payment_id text, p_amount numeric,
--     p_currency text) returns jsonb
--   p_cf_payment_id 'NO_GATEWAY' (or null) with p_amount 0 for fully covered orders.
--   Raises 'payment mismatch: ...' if currency <> INR or amount <> gateway_amount.
--   Result: {result:'confirmed', order_id, order_ref, status, race_units:[{item_id,units}],
--     refund_id, leftover_voucher:{code,value}|null}
--   | {result:'already', order_id, order_ref, status}
--   | {result:'refund_required', reason, amount, order_ref}  (late payment whose holds
--     can't be re-taken, or a second different payment on a paid order; once an
--     expired order has been judged refund_required, retries keep returning it)
--   Enqueues order_jobs shiprocket_create (unless every unit raced), email_confirmed,
--   email_shop, refund_notify:<refund id> in the same transaction.
-- online_order_fail(p_order_ref text, p_status text, p_reason text) returns void
--   p_status 'payment_failed'|'expired'; only from pending_payment; releases holds.
-- online_order_log_event(p_order_ref text, p_kind text, p_data jsonb) returns void
--   (R5: failed/dropped payment attempts are only logged.)
-- online_order_list_stale(p_min_age interval default '45 minutes')
--   returns table(order_id uuid, order_ref text, cf_order_id text, created_at timestamptz)
--   pending_payment orders older than p_min_age; the caller checks Cashfree and then
--   confirms or calls online_order_fail(..,'expired',..) (R5).
-- online_order_set_problem(p_order_ref text, p_problem text) returns void (null clears)
-- online_order_access_ok(p_order_ref text, p_token_hash text) returns boolean (R10)
-- online_order_set_availability(p_order_id uuid, p_item_id uuid, p_available_qty int,
--     p_actor uuid) returns void   -- only in 'paid'; 0..units that took stock
-- online_order_claim(p_order_id uuid, p_action text, p_actor uuid, p_op_key text)
--   returns jsonb  -- p_action 'process'|'cancel'; paid → processing|cancelling, 5 min
--   lease. {claimed bool, resumed bool, reason?, op_key, op_action, status, order:{...
--   checkpoint columns}}. Same op_key → resumed; other key while lease live → claimed
--   false (busy) with the holder's op_key; expired lease + same action → take over.
-- online_order_checkpoint(p_order_id uuid, p_step text, p_data jsonb) returns jsonb
--   steps: cf_order {cf_order_id} (pending_payment); sr_create {sr_order_id,
--   sr_shipment_id}; sr_create_failed {error}; sr_update {}; awb {awb, courier_id,
--   courier_name}; pickup {}; manifest {manifest_url}; label {label_url}; error {error}
--   (records process_error and releases the lease so Retry can resume).
--   Returns {step, skipped}: skipped = true when that checkpoint already exists.
-- online_order_prepare_process(p_order_id uuid, p_actor uuid) returns jsonb
--   requires 'processing'; idempotent (stored plan). {shippable_items:[{item_id,
--   variant_id, product_id, name, size, color, units, unit_price, paid_value}],
--   all_unavailable bool, refund_id uuid|null}. All unavailable → order cancelled,
--   refund includes shipping.
-- online_order_mark_packed(p_order_id uuid, p_shipment jsonb, p_actor uuid) returns int
--   (bill id). p_shipment may carry awb/courier_id/courier_name/label_url/manifest_url;
--   awb and label_url must be known. Sets packed and creates the Bill of Supply.
-- online_order_create_bos(p_order_id uuid) returns int  -- idempotent, no stock change
-- online_order_cancel(p_order_id uuid, p_actor uuid, p_reason text) returns uuid
--   from 'paid' or claimed 'cancelling'; returns stock for units not marked
--   unavailable; refund includes shipping. Repeat → existing refund id.
-- online_order_apply_tracking(p_awb text, p_status text, p_payload jsonb) returns jsonb
--   p_status = mapped status ('shipped'|'out_for_delivery'|'delivered'|'rto'|
--   'problem'|'cancelled'|null); p_payload {shipment_status_id, shipment_status, ...}.
--   Forward only; raw status stored every time; problem/cancelled set orders.problem.
--   Enqueues email_shipped / email_delivered. {matched, changed, status}.
-- online_order_rto_received(p_order_id uuid, p_actor uuid) returns uuid
--   'rto' → 'rto_received'; exchanges row per shipped, unrefunded bill line; stock back;
--   refund of item value (no shipping). Repeat → existing refund id.
-- online_refund_choose(p_token text, p_choice text) returns jsonb  [anon, authenticated]
--   p_choice 'store_credit'|'original'. {refund_id, order_ref, choice, status,
--   vouchers:[{code,value,expiry}], credit_added, gateway_legs:[{leg_id, amount}]}.
-- online_refund_default_expired() returns setof uuid  -- 48 h → 'original'
-- online_refund_set_status(p_leg_id uuid, p_status text, p_cf_refund_id text,
--     p_note text) returns void  -- p_leg_id = order_refund_legs.id = Cashfree refund_id
-- online_jobs_claim(p_limit int default 10, p_lease interval default '2 minutes')
--   returns setof order_jobs   (for update skip locked)
-- online_job_finish(p_job_id uuid, p_ok boolean, p_error text) returns void
--   backoff 2^attempts min (cap 60); 10 failed attempts → failed + orders.problem.
-- online_code_check(p_code text, p_phone text, p_auth_user uuid, p_ip_hash text)
--   returns jsonb {status:'ok'|'invalid'|'rate_limited', kind:'voucher'|'promo',
--   code, value, type, max_discount, min_total, rules}
-- online_order_lookup(p_order_ref text, p_phone text) returns jsonb  [anon, authenticated]
--   null for not found / wrong phone / rate limited (10 failures per hour per ref and
--   per x-forwarded-for). It writes code_attempts, so call it with POST (supabase.rpc).
-- my_online_orders() returns setof jsonb  [authenticated]
--
-- Credit/gateway split rule (spec §7, deterministic): non-gateway money
-- (voucher + store credit) covers goods before shipping; per line the edge
-- function allocates it in proportion to paid value (credit_part). Per unit,
-- a line's credit_part and gateway_part are split in paise over qty units with
-- the remainder on the first units; a refund of units [r, r+k) gets
-- cum(r+k) - cum(r), so all refunds of a line sum exactly to what it paid.
-- Refund legs are additionally capped per order and source by a trigger.
-- =====================================================================

-- ---------- existing tables (additive) ----------
alter table public.discounts add column if not exists storefront_redeemable boolean not null default false;

alter table public.vouchers drop constraint if exists vouchers_source_check;
alter table public.vouchers add constraint vouchers_source_check
  check (source = any (array['exchange'::text, 'manual'::text, 'promo'::text, 'online_refund'::text]));

-- ---------- settings ----------
create table if not exists public.storefront_settings (
  id int primary key check (id = 1),
  checkout_live boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.storefront_settings (id, checkout_live) values (1, false)
  on conflict (id) do nothing;
alter table public.storefront_settings enable row level security;
revoke all on table public.storefront_settings from public, anon, authenticated;
grant select on table public.storefront_settings to anon, authenticated;
grant all on table public.storefront_settings to service_role;
drop policy if exists storefront_settings_public_read on public.storefront_settings;
create policy storefront_settings_public_read on public.storefront_settings
  for select to anon, authenticated using (true);

insert into public.salesmethods (methodname)
  select 'Online'
  where not exists (select 1 from public.salesmethods where lower(methodname) = 'online');

-- ---------- orders ----------
create sequence if not exists public.online_order_ref_seq;

create table if not exists public.orders (
  id uuid not null default gen_random_uuid(),
  order_ref text not null default ('WEB-' || lpad(nextval('public.online_order_ref_seq')::text, 6, '0')),
  attempt_key uuid,
  status text not null default 'pending_payment',
  customerid integer references public.customers(customerid),
  auth_user_id uuid,
  identity_verified boolean not null default false,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  address jsonb not null,
  subtotal numeric(12,2) not null,
  promo_discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  shipping_credit_part numeric(12,2) not null default 0,
  shipping_gateway_part numeric(12,2) not null default 0,
  voucher_applied numeric(12,2) not null default 0,
  credit_applied numeric(12,2) not null default 0,
  gateway_amount numeric(12,2) not null,
  promo_code text,
  promo_usage_id bigint,
  voucher_code text,
  leftover_voucher_id text,
  quoted_courier_id integer,
  access_token_hash text,
  cf_order_id text,
  cf_payment_id text,
  paid_at timestamptz,
  sr_order_id text,
  sr_shipment_id text,
  sr_sync_status text,
  sr_last_error text,
  sr_updated_at timestamptz,
  awb text,
  courier_id integer,
  courier_name text,
  pickup_requested_at timestamptz,
  manifest_url text,
  label_url text,
  bill_id integer references public.bills(billid),
  tracking_status_id integer,
  tracking_label text,
  tracking_updated_at timestamptz,
  problem text,
  op_key text,
  op_action text,
  op_actor uuid,
  op_lease_until timestamptz,
  process_error text,
  process_plan jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint online_orders_pkey primary key (id),
  constraint online_orders_ref_key unique (order_ref),
  constraint online_orders_attempt_key unique (attempt_key),
  constraint online_orders_cf_payment_key unique (cf_payment_id),
  constraint online_orders_awb_key unique (awb),
  constraint online_orders_status_check check (status in (
    'pending_payment', 'paid', 'processing', 'cancelling', 'packed', 'shipped',
    'out_for_delivery', 'delivered', 'payment_failed', 'expired', 'cancelled',
    'rto', 'rto_received')),
  constraint online_orders_op_action_check check (op_action is null or op_action in ('process', 'cancel')),
  constraint online_orders_sr_sync_check check (sr_sync_status is null or sr_sync_status in ('ok', 'failed')),
  constraint online_orders_money_check check (
    subtotal >= 0 and promo_discount >= 0 and promo_discount <= subtotal and shipping >= 0
    and voucher_applied >= 0 and credit_applied >= 0 and gateway_amount >= 0
    and shipping_credit_part >= 0 and shipping_gateway_part >= 0
    and shipping = shipping_credit_part + shipping_gateway_part
    and gateway_amount = subtotal - promo_discount + shipping - voucher_applied - credit_applied)
);
create index if not exists orders_status_idx on public.orders (status, created_at);
create index if not exists orders_customer_idx on public.orders (customerid);
create index if not exists orders_auth_user_idx on public.orders (auth_user_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vouchers_held_order_id_fkey') then
    alter table public.vouchers add constraint vouchers_held_order_id_fkey
      foreign key (held_order_id) references public.orders(id) on delete set null;
  end if;
end $$;

create table if not exists public.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  line_no integer not null,
  variantid uuid not null references public.productsizecolors(variantid),
  productid text not null,
  product_name text not null,
  size text,
  color text,
  category_id text,
  category_name text,
  unit_price numeric(12,2) not null,
  qty integer not null,
  promo_share numeric(12,2) not null default 0,
  paid_value numeric(12,2) not null,
  credit_part numeric(12,2) not null default 0,
  gateway_part numeric(12,2) not null default 0,
  stock_taken integer not null default 0,
  available_qty integer,
  refunded_qty integer not null default 0,
  shipped_qty integer not null default 0,
  rto_qty integer not null default 0,
  status text not null default 'ordered',
  refund_id uuid,
  bill_item_id integer references public.bill_items(bill_item_id) on delete set null,
  constraint online_order_items_pkey primary key (id),
  constraint online_order_items_line_key unique (order_id, line_no),
  constraint online_order_items_status_check check (status in (
    'ordered', 'available', 'partially_available', 'unavailable', 'shipped', 'refunded')),
  constraint online_order_items_qty_check check (
    qty > 0 and stock_taken between 0 and qty
    and (available_qty is null or available_qty between 0 and stock_taken)
    and refunded_qty between 0 and qty and shipped_qty between 0 and qty
    and rto_qty between 0 and shipped_qty),
  constraint online_order_items_money_check check (
    unit_price >= 0 and promo_share >= 0 and credit_part >= 0 and gateway_part >= 0
    and paid_value = unit_price * qty - promo_share
    and paid_value = credit_part + gateway_part)
);
create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null,
  from_status text,
  to_status text,
  actor uuid,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, id);

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (reason in ('stock_race', 'unavailable', 'cancel', 'rto')),
  status text not null default 'awaiting_choice'
    check (status in ('awaiting_choice', 'processing', 'completed', 'failed')),
  choice text check (choice is null or choice in ('store_credit', 'original')),
  token text unique,
  token_expires_at timestamptz,
  credit_amount numeric(12,2) not null default 0,
  gateway_amount numeric(12,2) not null default 0,
  shipping_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  units integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  chosen_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on public.order_refunds (order_id);
create unique index if not exists order_refunds_one_cancel_rto
  on public.order_refunds (order_id, reason) where reason in ('cancel', 'rto');

create table if not exists public.order_refund_items (
  refund_id uuid not null references public.order_refunds(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  units integer not null check (units > 0),
  credit_amount numeric(12,2) not null default 0,
  gateway_amount numeric(12,2) not null default 0,
  exchange_id integer references public.exchanges(exchangeid) on delete set null,
  primary key (refund_id, item_id)
);

create table if not exists public.order_refund_legs (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.order_refunds(id) on delete cascade,
  source text not null check (source in ('credit', 'gateway', 'shipping_gateway', 'shipping_credit')),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  destination text check (destination is null or destination in ('store_credit', 'voucher', 'original')),
  cf_refund_id text,
  voucher_id text references public.vouchers(voucher_id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint order_refund_legs_source_key unique (refund_id, source)
);

create table if not exists public.order_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null,
  ref_id text not null default '',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_jobs_kind_key unique (order_id, kind, ref_id)
);
create index if not exists order_jobs_due_idx on public.order_jobs (status, run_after);

create table if not exists public.promo_reservations (
  id bigint generated always as identity primary key,
  code text not null,
  identity_key text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null default 'held' check (status in ('held', 'used', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists promo_reservations_active_key
  on public.promo_reservations (code, identity_key) where status in ('held', 'used');

create table if not exists public.code_attempts (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('code', 'lookup')),
  key text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists code_attempts_key_idx on public.code_attempts (scope, key, created_at);

create table if not exists public.integration_tokens (
  provider text primary key,
  token text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- RLS + grants ----------
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_items', 'order_events', 'order_refunds',
      'order_refund_items', 'order_refund_legs', 'order_jobs', 'promo_reservations',
      'code_attempts', 'integration_tokens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
  -- Admin read access (Online Orders screen). Writes only via functions / service role.
  foreach t in array array['orders', 'order_items', 'order_events', 'order_refunds',
      'order_refund_items', 'order_refund_legs', 'order_jobs'] loop
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (exists (select 1 from public.profiles p
                     where p.id = auth.uid() and p.role in ('admin', 'superadmin')))$p$,
      t || '_admin_select', t);
  end loop;
end $$;
revoke all on sequence public.online_order_ref_seq from public, anon, authenticated;
grant usage on sequence public.online_order_ref_seq to service_role;

-- ---------- internal helpers (no grants) ----------
create or replace function public._normalize_phone(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 10 then return '+91' || d; end if;
  if length(d) = 12 and left(d, 2) = '91' then return '+' || d; end if;
  if left(btrim(coalesce(p, '')), 1) = '+' and length(d) between 10 and 15 then return '+' || d; end if;
  return null;
end;
$$;

-- Integer-paise cumulative split of p_total over p_qty units, remainder on the
-- first units: amount carried by units [0, p_n).
create or replace function public._cum_alloc(p_total numeric, p_qty int, p_n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select (((p_n::bigint) * (round(p_total * 100)::bigint / p_qty)
          + least(p_n::bigint, round(p_total * 100)::bigint % p_qty)) / 100.0)::numeric(12,2)
$$;

create or replace function public._gen_voucher_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  -- 32 symbols, no 0/O/1/I: uniform because 256 % 32 = 0.
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text := '';
begin
  for i in 1..16 loop
    v := v || substr(alphabet, (get_byte(uuid_send(gen_random_uuid()), 0) % 32) + 1, 1);
  end loop;
  return v;
end;
$$;

create or replace function public._issue_voucher(p_customer int, p_value numeric, p_expiry date, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := public._gen_voucher_code();
    insert into public.vouchers (voucher_id, customerid, issue_date, expiry_date, value, redeemed, note, source)
    values (v_code, p_customer, current_date, p_expiry, round(p_value, 2), false, p_note, 'online_refund')
    on conflict (voucher_id) do nothing;
    exit when found;
  end loop;
  return v_code;
end;
$$;

-- Same maths as src/admin/components/billing/billUtils.js valueOfDiscount for the
-- types supported online, capped at the subtotal.
create or replace function public._promo_value(d public.discounts, p_subtotal numeric)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v numeric := 0;
  v_min numeric;
begin
  if coalesce(d.min_total, 0) > 0 and p_subtotal < d.min_total then
    return 0;
  end if;
  if d.type = 'flat' then
    v := coalesce(d.value, 0);
  elsif d.type = 'percentage' then
    v := round(p_subtotal * coalesce(d.value, 0) / 100, 2);
  elsif d.type = 'conditional' then
    v_min := coalesce(nullif((d.rules ->> 'min_total')::numeric, 0), nullif(d.min_total, 0), 0);
    if p_subtotal < v_min then return 0; end if;
    v := coalesce(nullif((d.rules ->> 'value')::numeric, 0), d.value, 0);
  else
    return null;  -- not supported online
  end if;
  if d.max_discount is not null then
    v := least(v, d.max_discount);
  end if;
  return round(greatest(least(v, p_subtotal), 0), 2);
end;
$$;

create or replace function public._promo_usable_online(d public.discounts)
returns boolean
language sql
stable
set search_path = public
as $$
  select d.storefront_redeemable and coalesce(d.active, false)
     and d.type in ('flat', 'percentage', 'conditional')
     and (d.start_date is null or d.start_date::date <= (now() at time zone 'Asia/Kolkata')::date)
     and (d.end_date is null or d.end_date::date >= (now() at time zone 'Asia/Kolkata')::date)
$$;

create or replace function public._online_event(
  p_order uuid, p_kind text, p_from text, p_to text, p_actor uuid, p_data jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_events (order_id, kind, from_status, to_status, actor, data)
  values (p_order, p_kind, p_from, p_to, p_actor, p_data);
$$;

create or replace function public._enqueue_job(p_order uuid, p_kind text, p_ref text default '')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_jobs (order_id, kind, ref_id) values (p_order, p_kind, coalesce(p_ref, ''))
  on conflict (order_id, kind, ref_id) do nothing;
$$;

create or replace function public._item_status(it public.order_items)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when it.refunded_qty >= it.qty then 'refunded'
    when it.shipped_qty > 0 then 'shipped'
    when it.available_qty is null then 'ordered'
    when it.available_qty = 0 then 'unavailable'
    when it.available_qty < it.qty then 'partially_available'
    else 'available' end
$$;

-- Releases the credit / voucher / promo holds of a pending order.
create or replace function public._online_release_holds(o public.orders)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if o.credit_applied > 0 and o.customerid is not null then
    perform public._store_credit_apply(o.customerid, o.credit_applied, 'release', o.id::text, 'online', 'order');
  end if;
  update public.vouchers set held_order_id = null
   where held_order_id = o.id and coalesce(redeemed, false) = false;
  update public.promo_reservations set status = 'released', updated_at = now()
   where order_id = o.id and status = 'held';
end;
$$;

-- Leg cap: per order and source, legs never exceed what that source paid.
create or replace function public._online_leg_cap_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid;
  v_cap numeric;
  v_sum numeric;
begin
  select r.order_id into v_order from public.order_refunds r where r.id = new.refund_id;
  select case new.source
           when 'credit' then (select coalesce(sum(i.credit_part), 0) from public.order_items i where i.order_id = v_order)
           when 'gateway' then (select coalesce(sum(i.gateway_part), 0) from public.order_items i where i.order_id = v_order)
           when 'shipping_credit' then o.shipping_credit_part
           when 'shipping_gateway' then o.shipping_gateway_part end
    into v_cap from public.orders o where o.id = v_order;
  select coalesce(sum(l.amount), 0) into v_sum
    from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
   where r.order_id = v_order and l.source = new.source and l.id <> new.id;
  if v_sum + new.amount > v_cap then
    raise exception 'refund legs exceed paid amount (order %, source %, cap %, would be %)',
      v_order, new.source, v_cap, v_sum + new.amount using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists order_refund_legs_cap on public.order_refund_legs;
create trigger order_refund_legs_cap before insert or update of amount, source on public.order_refund_legs
  for each row execute function public._online_leg_cap_check();

create or replace function public._online_refund_recompute(p_refund uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.order_refunds;
  v_new text;
  v_total int;
  v_done int;
  v_failed int;
  v_open_gateway int;
begin
  select * into r from public.order_refunds where id = p_refund for update;
  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status = 'failed'),
         count(*) filter (where source in ('gateway', 'shipping_gateway') and status = 'pending')
    into v_total, v_done, v_failed, v_open_gateway
    from public.order_refund_legs where refund_id = p_refund;
  if v_total = v_done then
    v_new := 'completed';
  elsif v_failed > 0 then
    v_new := 'failed';
  elsif r.choice is null and v_open_gateway > 0 then
    v_new := 'awaiting_choice';
  else
    v_new := 'processing';
  end if;
  update public.order_refunds
     set status = v_new, updated_at = now(),
         completed_at = case when v_new = 'completed' then coalesce(completed_at, now()) else null end
   where id = p_refund;
  return v_new;
end;
$$;

-- Completes one leg as credit: store credit for verified customers, otherwise a
-- new online voucher (1 year). Idempotent per leg (ledger unique + leg row lock).
create or replace function public._online_leg_complete_credit(p_leg uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.order_refund_legs;
  o public.orders;
  v_code text;
begin
  select * into l from public.order_refund_legs where id = p_leg for update;
  select o2.* into o from public.orders o2 join public.order_refunds r on r.order_id = o2.id where r.id = l.refund_id;
  if l.status = 'completed' then
    return jsonb_build_object('leg_id', l.id, 'destination', l.destination, 'voucher_id', l.voucher_id, 'amount', l.amount);
  end if;
  if o.identity_verified and o.customerid is not null then
    perform public._store_credit_apply(o.customerid, l.amount, 'refund_credit', l.id::text, 'online', 'refund_leg');
    update public.order_refund_legs
       set status = 'completed', destination = 'store_credit', completed_at = now(), updated_at = now()
     where id = l.id;
    return jsonb_build_object('leg_id', l.id, 'destination', 'store_credit', 'voucher_id', null, 'amount', l.amount);
  end if;
  v_code := public._issue_voucher(o.customerid, l.amount, (current_date + interval '1 year')::date,
                                  'Online refund ' || o.order_ref);
  update public.order_refund_legs
     set status = 'completed', destination = 'voucher', voucher_id = v_code, completed_at = now(), updated_at = now()
   where id = l.id;
  -- RTO return records point at the voucher that settled them (first one wins).
  update public.exchanges e set voucher_id = v_code
    from public.order_refund_items ri
   where ri.refund_id = l.refund_id and ri.exchange_id = e.exchangeid and e.voucher_id is null;
  return jsonb_build_object('leg_id', l.id, 'destination', 'voucher', 'voucher_id', v_code, 'amount', l.amount);
end;
$$;

-- Creates a refund for p_units ([{item_id, units}]) of an order (caller holds the
-- order row lock), plus shipping when p_include_shipping. Credit legs complete at
-- once; gateway legs wait for the shopper's choice. Returns null when nothing to refund.
create or replace function public._online_refund_create(
  p_order_id uuid, p_reason text, p_units jsonb, p_include_shipping boolean, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  u record;
  v_id uuid := gen_random_uuid();
  v_k int;
  v_c numeric(12,2);
  v_g numeric(12,2);
  v_credit numeric(12,2) := 0;
  v_gateway numeric(12,2) := 0;
  v_ship_c numeric(12,2) := 0;
  v_ship_g numeric(12,2) := 0;
  v_units int := 0;
  v_leg record;
  v_has_gateway boolean;
begin
  select * into o from public.orders where id = p_order_id;

  if p_include_shipping and o.shipping > 0 and not exists (
       select 1 from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
        where r.order_id = o.id and l.source in ('shipping_credit', 'shipping_gateway')) then
    v_ship_c := o.shipping_credit_part;
    v_ship_g := o.shipping_gateway_part;
  end if;

  if not exists (select 1 from jsonb_to_recordset(coalesce(p_units, '[]'::jsonb)) as x(item_id uuid, units int)
                  where x.units > 0)
     and v_ship_c + v_ship_g = 0 then
    return null;
  end if;

  insert into public.order_refunds (id, order_id, reason, created_by)
  values (v_id, o.id, p_reason, p_actor);

  for u in select x.item_id, x.units from jsonb_to_recordset(coalesce(p_units, '[]'::jsonb)) as x(item_id uuid, units int)
            where x.units > 0 loop
    select * into it from public.order_items where id = u.item_id and order_id = o.id for update;
    if not found then
      raise exception 'refund: item % not in order %', u.item_id, o.order_ref;
    end if;
    v_k := u.units;
    if it.refunded_qty + v_k > it.qty then
      raise exception 'refund: item % would refund % of % units', it.id, it.refunded_qty + v_k, it.qty;
    end if;
    v_c := public._cum_alloc(it.credit_part, it.qty, it.refunded_qty + v_k) - public._cum_alloc(it.credit_part, it.qty, it.refunded_qty);
    v_g := public._cum_alloc(it.gateway_part, it.qty, it.refunded_qty + v_k) - public._cum_alloc(it.gateway_part, it.qty, it.refunded_qty);
    insert into public.order_refund_items (refund_id, item_id, units, credit_amount, gateway_amount)
    values (v_id, it.id, v_k, v_c, v_g);
    update public.order_items set refunded_qty = refunded_qty + v_k, refund_id = v_id where id = it.id
      returning * into it;
    update public.order_items set status = public._item_status(it) where id = it.id;
    v_credit := v_credit + v_c;
    v_gateway := v_gateway + v_g;
    v_units := v_units + v_k;
  end loop;

  if v_credit > 0 then
    insert into public.order_refund_legs (refund_id, source, amount) values (v_id, 'credit', v_credit);
  end if;
  if v_gateway > 0 then
    insert into public.order_refund_legs (refund_id, source, amount) values (v_id, 'gateway', v_gateway);
  end if;
  if v_ship_c > 0 then
    insert into public.order_refund_legs (refund_id, source, amount) values (v_id, 'shipping_credit', v_ship_c);
  end if;
  if v_ship_g > 0 then
    insert into public.order_refund_legs (refund_id, source, amount) values (v_id, 'shipping_gateway', v_ship_g);
  end if;

  v_has_gateway := v_gateway + v_ship_g > 0;
  update public.order_refunds
     set credit_amount = v_credit, gateway_amount = v_gateway, shipping_amount = v_ship_c + v_ship_g,
         total_amount = v_credit + v_gateway + v_ship_c + v_ship_g, units = v_units,
         token = case when v_has_gateway then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') end,
         token_expires_at = case when v_has_gateway then now() + interval '48 hours' end
   where id = v_id;

  for v_leg in select id from public.order_refund_legs where refund_id = v_id and source in ('credit', 'shipping_credit') loop
    perform public._online_leg_complete_credit(v_leg.id);
  end loop;
  perform public._online_refund_recompute(v_id);

  perform public._enqueue_job(o.id, 'refund_notify', v_id::text);
  perform public._online_event(o.id, 'refund_created', null, null, p_actor,
    jsonb_build_object('refund_id', v_id, 'reason', p_reason, 'units', v_units,
      'credit', v_credit, 'gateway', v_gateway, 'shipping', v_ship_c + v_ship_g));
  return v_id;
end;
$$;

create or replace function public._order_public_json(o public.orders)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_ref', o.order_ref, 'status', o.status, 'created_at', o.created_at, 'paid_at', o.paid_at,
    'subtotal', o.subtotal, 'promo_discount', o.promo_discount, 'shipping', o.shipping,
    'voucher_applied', o.voucher_applied, 'credit_applied', o.credit_applied,
    'gateway_amount', o.gateway_amount, 'courier_name', o.courier_name, 'awb', o.awb,
    'tracking_label', o.tracking_label,
    'tracking_url', case when o.awb is not null then 'https://shiprocket.co/tracking/' || o.awb end,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.product_name, 'size', i.size, 'color', i.color, 'qty', i.qty,
        'unit_price', i.unit_price, 'status', i.status, 'refunded_qty', i.refunded_qty)
        order by i.line_no) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._normalize_phone(text)', 'public._cum_alloc(numeric, int, int)',
    'public._gen_voucher_code()', 'public._issue_voucher(int, numeric, date, text)',
    'public._promo_value(public.discounts, numeric)', 'public._promo_usable_online(public.discounts)',
    'public._online_event(uuid, text, text, text, uuid, jsonb)', 'public._enqueue_job(uuid, text, text)',
    'public._item_status(public.order_items)', 'public._online_release_holds(public.orders)',
    'public._online_leg_cap_check()', 'public._online_refund_recompute(uuid)',
    'public._online_leg_complete_credit(uuid)',
    'public._online_refund_create(uuid, text, jsonb, boolean, uuid)',
    'public._order_public_json(public.orders)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- =====================================================================
-- Public functions
-- =====================================================================

create or replace function public.online_order_create(p_order jsonb, p_items jsonb, p_auth_user uuid)
returns table (order_id uuid, order_ref text, created boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_existing public.orders;
  v_order public.orders;
  v_attempt uuid := nullif(p_order ->> 'attempt_key', '')::uuid;
  v_phone text := public._normalize_phone(p_order #>> '{contact,phone}');
  v_name text := btrim(coalesce(p_order #>> '{contact,name}', ''));
  v_email text := nullif(btrim(coalesce(p_order #>> '{contact,email}', '')), '');
  v_address jsonb := p_order -> 'address';
  v_promo_code text := nullif(btrim(coalesce(p_order ->> 'promo_code', '')), '');
  v_voucher_code text := nullif(btrim(coalesce(p_order ->> 'voucher_code', '')), '');
  v_subtotal numeric(12,2) := (p_order ->> 'subtotal')::numeric;
  v_promo numeric(12,2) := coalesce((p_order ->> 'promo_discount')::numeric, 0);
  v_shipping numeric(12,2) := coalesce((p_order ->> 'shipping')::numeric, 0);
  v_voucher_applied numeric(12,2) := coalesce((p_order ->> 'voucher_applied')::numeric, 0);
  v_credit numeric(12,2) := coalesce((p_order ->> 'credit_applied')::numeric, 0);
  v_gateway numeric(12,2) := (p_order ->> 'gateway_amount')::numeric;
  v_cust int;
  v_verified boolean := false;
  v_balance numeric;
  v_disc public.discounts;
  v_voucher public.vouchers;
  v_due numeric(12,2);
  v_goods numeric(12,2);
  v_nongw numeric(12,2);
  v_sum_sub numeric(12,2) := 0;
  v_sum_promo numeric(12,2) := 0;
  v_sum_credit numeric(12,2) := 0;
  v_line record;
  v_var record;
  v_lines jsonb := '[]'::jsonb;
  v_pin text := regexp_replace(coalesce(v_address ->> 'pincode', ''), '\D', '', 'g');
begin
  if not coalesce((select s.checkout_live from public.storefront_settings s where s.id = 1), false) then
    raise exception 'checkout is not live' using errcode = '42501';
  end if;

  if v_attempt is not null then
    select * into v_existing from public.orders o where o.attempt_key = v_attempt;
    if found then
      return query select v_existing.id, v_existing.order_ref, false;
      return;
    end if;
  end if;

  -- contact / address
  if v_phone is null then raise exception 'invalid phone'; end if;
  if v_name = '' then raise exception 'name is required'; end if;
  if v_address is null or jsonb_typeof(v_address) <> 'object' then raise exception 'address is required'; end if;
  if v_pin !~ '^2[0-8][0-9]{4}$' then raise exception 'delivery is within Uttar Pradesh only (pincode %)', v_pin; end if;
  if v_promo_code is not null and v_voucher_code is not null then raise exception 'only one code per order'; end if;
  if v_subtotal is null or v_gateway is null then raise exception 'subtotal and gateway_amount are required'; end if;

  -- identity (R8): only a verified auth user unlocks credit / owned vouchers
  if p_auth_user is not null then
    select c.customerid into v_cust from public.customers c where c.auth_user_id = p_auth_user;
    v_verified := found;
  end if;
  if not v_verified then
    select c.customerid into v_cust from public.customers c where c.phone = v_phone order by c.customerid limit 1;
    if not found then
      insert into public.customers (first_name, last_name, phone, email, customer_ulid, is_guest)
      values (left(split_part(v_name, ' ', 1), 50),
              nullif(left(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 1)), 50), ''),
              v_phone, left(v_email, 100), left(replace(gen_random_uuid()::text, '-', ''), 26), true)
      returning customerid into v_cust;
    end if;
  end if;

  -- lines: price from the database, shares from the quote
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order has no items';
  end if;
  for v_line in
    select x.ord::int as line_no, (x.e ->> 'variant_id')::uuid as variant_id, (x.e ->> 'qty')::int as qty,
           (x.e ->> 'unit_price')::numeric as unit_price,
           coalesce((x.e ->> 'promo_share')::numeric, 0) as promo_share,
           coalesce((x.e ->> 'credit_part')::numeric, 0) as credit_part
      from jsonb_array_elements(p_items) with ordinality as x(e, ord)
  loop
    if v_line.qty is null or v_line.qty <= 0 then raise exception 'line %: bad qty', v_line.line_no; end if;
    select psc.productid, psc.size, psc.color, p.name, p.retailprice, p.categoryid, c.name as category_name
      into v_var
      from public.productsizecolors psc
      join public.products p on p.productid = psc.productid
      left join public.categories c on c.categoryid = p.categoryid
     where psc.variantid = v_line.variant_id;
    if not found then raise exception 'line %: variant % not found', v_line.line_no, v_line.variant_id; end if;
    if v_line.unit_price is distinct from v_var.retailprice then
      raise exception 'line %: price changed (% vs %)', v_line.line_no, v_line.unit_price, v_var.retailprice;
    end if;
    if v_line.promo_share < 0 or v_line.promo_share > v_line.unit_price * v_line.qty then
      raise exception 'line %: bad promo share', v_line.line_no;
    end if;
    if v_line.credit_part < 0 or v_line.credit_part > v_line.unit_price * v_line.qty - v_line.promo_share then
      raise exception 'line %: bad credit part', v_line.line_no;
    end if;
    v_sum_sub := v_sum_sub + v_line.unit_price * v_line.qty;
    v_sum_promo := v_sum_promo + v_line.promo_share;
    v_sum_credit := v_sum_credit + v_line.credit_part;
    v_lines := v_lines || jsonb_build_object('line_no', v_line.line_no, 'variant_id', v_line.variant_id,
      'productid', v_var.productid, 'name', v_var.name, 'size', v_var.size, 'color', v_var.color,
      'category_id', v_var.categoryid, 'category_name', v_var.category_name,
      'unit_price', v_line.unit_price, 'qty', v_line.qty, 'promo_share', v_line.promo_share,
      'credit_part', v_line.credit_part);
  end loop;

  if v_sum_sub <> v_subtotal then raise exception 'subtotal mismatch (% vs %)', v_subtotal, v_sum_sub; end if;
  if v_sum_promo <> v_promo then raise exception 'promo shares do not sum to promo_discount'; end if;

  -- promo
  if v_promo_code is not null then
    select * into v_disc from public.discounts d where d.code = v_promo_code;
    if not found or not public._promo_usable_online(v_disc) then raise exception 'code not valid'; end if;
    if public._promo_value(v_disc, v_subtotal) <> v_promo then
      raise exception 'promo discount mismatch (% vs %)', v_promo, public._promo_value(v_disc, v_subtotal);
    end if;
    if coalesce(v_disc.once_per_customer, false) and exists (
         select 1 from public.discount_usage du where du.code = v_disc.code and du.customerid = v_cust) then
      raise exception 'code not valid';
    end if;
  elsif v_promo <> 0 then
    raise exception 'promo discount without a code';
  end if;

  -- shipping rule (spec §7): free at >= 5000, else courier rate rounded to 10, or flat 99
  v_goods := v_subtotal - v_promo;
  if v_goods >= 5000 then
    if v_shipping <> 0 then raise exception 'shipping must be free at or above 5000'; end if;
  elsif v_shipping <= 0 or (v_shipping <> 99 and mod(v_shipping, 10) <> 0) then
    raise exception 'bad shipping amount %', v_shipping;
  end if;
  v_due := v_goods + v_shipping;

  -- voucher
  if v_voucher_code is not null then
    select * into v_voucher from public.vouchers vc where vc.voucher_id = v_voucher_code for update;
    if not found or coalesce(v_voucher.redeemed, false) or v_voucher.held_order_id is not null
       or v_voucher.expiry_date < current_date
       or not (v_voucher.source = 'online_refund' or (v_verified and v_voucher.customerid = v_cust)) then
      raise exception 'code not valid';
    end if;
    if v_voucher_applied <> least(v_voucher.value, v_due) then
      raise exception 'voucher amount mismatch (% vs %)', v_voucher_applied, least(v_voucher.value, v_due);
    end if;
  elsif v_voucher_applied <> 0 then
    raise exception 'voucher amount without a code';
  end if;

  -- store credit
  if v_credit < 0 then raise exception 'bad credit amount'; end if;
  if v_credit > 0 then
    if not v_verified then raise exception 'store credit needs a signed-in customer'; end if;
    select round(coalesce(c.store_credit, 0)::numeric, 2) into v_balance from public.customers c where c.customerid = v_cust;
    if v_credit > v_balance then raise exception 'store credit balance is lower than requested'; end if;
    if v_credit > v_due - v_voucher_applied then raise exception 'credit exceeds amount due'; end if;
  end if;

  if v_gateway <> v_due - v_voucher_applied - v_credit then
    raise exception 'gateway amount mismatch (% vs %)', v_gateway, v_due - v_voucher_applied - v_credit;
  end if;
  if v_gateway > 0 and v_gateway < 1 and v_voucher_applied + v_credit > 0 then
    raise exception 'gateway amount must be 0 or at least 1.00';
  end if;
  v_nongw := v_voucher_applied + v_credit;
  if v_sum_credit <> least(v_nongw, v_goods) then
    raise exception 'credit parts must sum to % (got %)', least(v_nongw, v_goods), v_sum_credit;
  end if;

  insert into public.orders (attempt_key, customerid, auth_user_id, identity_verified, contact_name,
      contact_phone, contact_email, address, subtotal, promo_discount, shipping, shipping_credit_part,
      shipping_gateway_part, voucher_applied, credit_applied, gateway_amount, promo_code, voucher_code,
      quoted_courier_id, access_token_hash)
  values (v_attempt, v_cust, case when v_verified then p_auth_user end, v_verified, v_name,
      v_phone, v_email, v_address, v_subtotal, v_promo, v_shipping, v_nongw - v_sum_credit,
      v_shipping - (v_nongw - v_sum_credit), v_voucher_applied, v_credit, v_gateway, v_promo_code,
      v_voucher_code, nullif(p_order ->> 'quoted_courier_id', '')::int,
      nullif(lower(p_order ->> 'access_token_hash'), ''))
  returning * into v_order;

  insert into public.order_items (order_id, line_no, variantid, productid, product_name, size, color,
      category_id, category_name, unit_price, qty, promo_share, paid_value, credit_part, gateway_part)
  select v_order.id, (l ->> 'line_no')::int, (l ->> 'variant_id')::uuid, l ->> 'productid', l ->> 'name',
         l ->> 'size', l ->> 'color', l ->> 'category_id', l ->> 'category_name',
         (l ->> 'unit_price')::numeric, (l ->> 'qty')::int, (l ->> 'promo_share')::numeric,
         (l ->> 'unit_price')::numeric * (l ->> 'qty')::int - (l ->> 'promo_share')::numeric,
         (l ->> 'credit_part')::numeric,
         (l ->> 'unit_price')::numeric * (l ->> 'qty')::int - (l ->> 'promo_share')::numeric - (l ->> 'credit_part')::numeric
    from jsonb_array_elements(v_lines) l;

  -- holds
  if v_credit > 0 then
    perform public._store_credit_apply(v_cust, -v_credit, 'hold', v_order.id::text, 'online', 'order');
  end if;
  if v_voucher_code is not null then
    update public.vouchers set held_order_id = v_order.id where voucher_id = v_voucher_code;
  end if;
  if v_promo_code is not null and coalesce(v_disc.once_per_customer, false) then
    begin
      insert into public.promo_reservations (code, identity_key, order_id) values (v_promo_code, 'p:' || v_phone, v_order.id);
      if v_verified then
        insert into public.promo_reservations (code, identity_key, order_id) values (v_promo_code, 'c:' || v_cust, v_order.id);
      end if;
    exception when unique_violation then
      raise exception 'code not valid' using errcode = 'P0001';
    end;
  end if;

  perform public._online_event(v_order.id, 'created', null, 'pending_payment', p_auth_user,
    jsonb_build_object('gateway_amount', v_gateway, 'credit', v_credit, 'voucher', v_voucher_applied,
                       'promo_code', v_promo_code, 'verified', v_verified));
  return query select v_order.id, v_order.order_ref, true;
end;
$$;

create or replace function public.online_order_confirm_payment(
  p_order_ref text, p_cf_payment_id text, p_amount numeric, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_no_gateway boolean := p_cf_payment_id is null or p_cf_payment_id = 'NO_GATEWAY';
  v_pay_id text := case when p_cf_payment_id is null or p_cf_payment_id = 'NO_GATEWAY' then null else p_cf_payment_id end;
  v_from text;
  v_stock numeric;
  v_take int;
  v_race jsonb := '[]'::jsonb;
  v_total_taken int := 0;
  v_refund uuid;
  v_voucher public.vouchers;
  v_left numeric(12,2);
  v_left_code text;
  v_usage bigint;
  v_cancel boolean;
begin
  select * into o from public.orders where order_ref = p_order_ref for update;
  if not found then
    raise exception 'order % not found', p_order_ref;
  end if;

  if o.status not in ('pending_payment', 'expired', 'payment_failed') then
    if (v_no_gateway and o.gateway_amount = 0) or o.cf_payment_id is not distinct from v_pay_id then
      return jsonb_build_object('result', 'already', 'order_id', o.id, 'order_ref', o.order_ref, 'status', o.status);
    end if;
    perform public._online_event(o.id, 'duplicate_payment', o.status, o.status, null,
      jsonb_build_object('cf_payment_id', p_cf_payment_id, 'amount', p_amount));
    return jsonb_build_object('result', 'refund_required', 'reason', 'duplicate_payment',
      'amount', p_amount, 'order_ref', o.order_ref);
  end if;

  -- A late payment already judged unrecoverable stays refunded: a retried webhook
  -- must not confirm it later (the edge function has refunded it by then).
  if o.status in ('expired', 'payment_failed') and o.cf_payment_id is not null then
    return jsonb_build_object('result', 'refund_required',
      'reason', case when o.cf_payment_id = v_pay_id then 'holds_unavailable' else 'duplicate_payment' end,
      'amount', coalesce(p_amount, 0), 'order_ref', o.order_ref);
  end if;

  -- R4: the money must match exactly
  if v_no_gateway then
    if o.gateway_amount <> 0 or coalesce(p_amount, 0) <> 0 then
      raise exception 'payment mismatch: order % needs a gateway payment of %', o.order_ref, o.gateway_amount;
    end if;
  else
    if upper(coalesce(p_currency, '')) <> 'INR' then
      raise exception 'payment mismatch: currency % for order %', p_currency, o.order_ref;
    end if;
    if p_amount is null or round(p_amount, 2) <> o.gateway_amount then
      raise exception 'payment mismatch: amount % for order % (expected %)', p_amount, o.order_ref, o.gateway_amount;
    end if;
    if exists (select 1 from public.orders x where x.cf_payment_id = v_pay_id and x.id <> o.id) then
      raise exception 'payment mismatch: cf_payment_id % already used by another order', v_pay_id;
    end if;
  end if;

  v_from := o.status;
  if o.status in ('expired', 'payment_failed') then
    -- Late payment: holds were released. Re-take them all or refund the payment.
    begin
      if o.credit_applied > 0 then
        perform public._store_credit_apply(o.customerid, -o.credit_applied, 'hold_retake', o.id::text, 'online', 'order');
      end if;
      if o.voucher_code is not null then
        update public.vouchers set held_order_id = o.id
         where voucher_id = o.voucher_code and coalesce(redeemed, false) = false
           and (held_order_id is null or held_order_id = o.id) and expiry_date >= current_date;
        if not found then raise exception 'voucher no longer available'; end if;
      end if;
      if o.promo_code is not null then
        update public.promo_reservations set status = 'held', updated_at = now()
         where order_id = o.id and status = 'released';
        if exists (select 1 from public.discounts d join public.discount_usage du on du.code = d.code
                    where d.code = o.promo_code and d.once_per_customer and du.customerid = o.customerid) then
          raise exception 'promo already used';
        end if;
      end if;
    exception when unique_violation or check_violation or raise_exception then
      update public.orders set cf_payment_id = v_pay_id,
             problem = 'Paid after expiry; credit/voucher/promo no longer available; payment refund required',
             updated_at = now() where id = o.id;
      perform public._online_event(o.id, 'refund_required', o.status, o.status, null,
        jsonb_build_object('reason', 'holds_unavailable', 'detail', sqlerrm, 'amount', p_amount,
                           'cf_payment_id', p_cf_payment_id));
      return jsonb_build_object('result', 'refund_required', 'reason', 'holds_unavailable',
        'amount', coalesce(p_amount, 0), 'order_ref', o.order_ref);
    end;
  end if;

  update public.orders set status = 'paid', paid_at = now(), cf_payment_id = v_pay_id, problem = null,
         updated_at = now()
   where id = o.id returning * into o;

  -- credit hold becomes spent (audit row; the balance was debited at the hold)
  if o.credit_applied > 0 then
    insert into public.store_credit_ledger (customerid, delta, balance_after, source, reason, ref_type, ref_id)
    select o.customerid, 0, round(coalesce(c.store_credit, 0)::numeric, 2), 'online', 'spent', 'order', o.id::text
      from public.customers c where c.customerid = o.customerid
    on conflict do nothing;
  end if;

  -- voucher consumed; unused value reissued (same expiry)
  if o.voucher_code is not null then
    update public.vouchers set redeemed = true, redeemed_at = now()
     where voucher_id = o.voucher_code and held_order_id = o.id
    returning * into v_voucher;
    v_left := v_voucher.value - o.voucher_applied;
    if v_left > 0 then
      v_left_code := public._issue_voucher(o.customerid, v_left, v_voucher.expiry_date,
                                           'Balance of voucher ' || o.voucher_code || ' from ' || o.order_ref);
      update public.orders set leftover_voucher_id = v_left_code where id = o.id;
    end if;
  end if;

  -- promo usage
  if o.promo_code is not null and o.customerid is not null and o.promo_usage_id is null then
    insert into public.discount_usage (customerid, code) values (o.customerid, o.promo_code)
    returning id into v_usage;
    update public.orders set promo_usage_id = v_usage where id = o.id;
    update public.promo_reservations set status = 'used', updated_at = now() where order_id = o.id and status = 'held';
  end if;

  -- stock: first paid wins, per unit; variants locked in a fixed order (no deadlocks)
  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    select stock into v_stock from public.productsizecolors where variantid = it.variantid for update;
    v_take := least(it.qty, greatest(floor(coalesce(v_stock, 0)), 0)::int);
    if v_take > 0 then
      perform public._stock_apply(it.variantid, -v_take);
    end if;
    update public.order_items set stock_taken = v_take where id = it.id;
    v_total_taken := v_total_taken + v_take;
    if v_take < it.qty then
      v_race := v_race || jsonb_build_object('item_id', it.id, 'units', it.qty - v_take);
    end if;
  end loop;

  v_cancel := v_total_taken = 0;
  if jsonb_array_length(v_race) > 0 then
    v_refund := public._online_refund_create(o.id, 'stock_race', v_race, v_cancel, null);
  end if;
  if v_cancel then
    update public.orders set status = 'cancelled', updated_at = now() where id = o.id;
  end if;

  perform public._online_event(o.id, 'paid', v_from, 'paid', null,
    jsonb_build_object('cf_payment_id', p_cf_payment_id, 'amount', p_amount, 'race_units', v_race));
  if v_cancel then
    perform public._online_event(o.id, 'cancelled', 'paid', 'cancelled', null,
      jsonb_build_object('reason', 'no stock for any item', 'refund_id', v_refund));
  else
    perform public._enqueue_job(o.id, 'shiprocket_create');
  end if;
  perform public._enqueue_job(o.id, 'email_confirmed');
  perform public._enqueue_job(o.id, 'email_shop');

  return jsonb_build_object('result', 'confirmed', 'order_id', o.id, 'order_ref', o.order_ref,
    'status', case when v_cancel then 'cancelled' else 'paid' end, 'race_units', v_race, 'refund_id', v_refund,
    'leftover_voucher', case when v_left_code is not null
      then jsonb_build_object('code', v_left_code, 'value', v_left) end);
end;
$$;

create or replace function public.online_order_fail(p_order_ref text, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  if p_status not in ('payment_failed', 'expired') then
    raise exception 'online_order_fail: bad status %', p_status;
  end if;
  select * into o from public.orders where order_ref = p_order_ref for update;
  if not found then raise exception 'order % not found', p_order_ref; end if;
  if o.status <> 'pending_payment' then
    return;  -- paid (or already failed): nothing to do
  end if;
  perform public._online_release_holds(o);
  update public.orders set status = p_status, updated_at = now() where id = o.id;
  perform public._online_event(o.id, p_status, 'pending_payment', p_status, null, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.online_order_log_event(p_order_ref text, p_kind text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where order_ref = p_order_ref;
  if not found then raise exception 'order % not found', p_order_ref; end if;
  perform public._online_event(o.id, p_kind, o.status, o.status, null, p_data);
end;
$$;

create or replace function public.online_order_list_stale(p_min_age interval default interval '45 minutes')
returns table (order_id uuid, order_ref text, cf_order_id text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.order_ref, o.cf_order_id, o.created_at
    from public.orders o
   where o.status = 'pending_payment' and o.created_at < now() - p_min_age
   order by o.created_at
$$;

create or replace function public.online_order_set_problem(p_order_ref text, p_problem text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  update public.orders set problem = p_problem, updated_at = now() where order_ref = p_order_ref returning * into o;
  if not found then raise exception 'order % not found', p_order_ref; end if;
  perform public._online_event(o.id, 'problem', o.status, o.status, null, jsonb_build_object('problem', p_problem));
end;
$$;

create or replace function public.online_order_access_ok(p_order_ref text, p_token_hash text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select o.access_token_hash is not null and o.access_token_hash = lower(p_token_hash)
                     from public.orders o where o.order_ref = p_order_ref), false)
$$;

create or replace function public.online_order_set_availability(
  p_order_id uuid, p_item_id uuid, p_available_qty int, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status <> 'paid' then
    raise exception 'availability can only be set while the order is paid (now %)', o.status;
  end if;
  select * into it from public.order_items where id = p_item_id and order_id = p_order_id for update;
  if not found then raise exception 'item % not in order', p_item_id; end if;
  if p_available_qty is null or p_available_qty < 0 or p_available_qty > it.stock_taken then
    raise exception 'available qty must be between 0 and %', it.stock_taken;
  end if;
  update public.order_items set available_qty = p_available_qty where id = it.id returning * into it;
  update public.order_items set status = public._item_status(it) where id = it.id;
  perform public._online_event(o.id, 'availability', o.status, o.status, p_actor,
    jsonb_build_object('item_id', it.id, 'available_qty', p_available_qty, 'of', it.stock_taken));
end;
$$;

create or replace function public._order_ops_json(o public.orders)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('id', o.id, 'order_ref', o.order_ref, 'status', o.status,
    'quoted_courier_id', o.quoted_courier_id, 'sr_order_id', o.sr_order_id, 'sr_shipment_id', o.sr_shipment_id,
    'sr_updated_at', o.sr_updated_at, 'awb', o.awb, 'courier_id', o.courier_id, 'courier_name', o.courier_name,
    'pickup_requested_at', o.pickup_requested_at, 'manifest_url', o.manifest_url, 'label_url', o.label_url,
    'bill_id', o.bill_id, 'process_plan', o.process_plan, 'process_error', o.process_error)
$$;
revoke all on function public._order_ops_json(public.orders) from public, anon, authenticated;

create or replace function public.online_order_claim(
  p_order_id uuid, p_action text, p_actor uuid, p_op_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_target text;
  v_from text;
begin
  v_target := case p_action when 'process' then 'processing' when 'cancel' then 'cancelling' end;
  if v_target is null then raise exception 'online_order_claim: bad action %', p_action; end if;
  if p_op_key is null or p_op_key = '' then raise exception 'online_order_claim: op key required'; end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  v_from := o.status;

  if o.status in ('processing', 'cancelling') then
    if o.op_key = p_op_key then
      update public.orders set op_lease_until = now() + interval '5 minutes', updated_at = now()
       where id = o.id returning * into o;
      return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    if o.op_lease_until > now() or o.op_action <> p_action then
      return jsonb_build_object('claimed', false, 'resumed', false,
        'reason', case when o.op_action <> p_action then 'other_action' else 'busy' end,
        'op_key', o.op_key, 'op_action', o.op_action, 'lease_until', o.op_lease_until,
        'status', o.status, 'order', public._order_ops_json(o));
    end if;
    update public.orders set op_key = p_op_key, op_actor = p_actor,
           op_lease_until = now() + interval '5 minutes', updated_at = now()
     where id = o.id returning * into o;
    perform public._online_event(o.id, 'claim_takeover', v_from, o.status, p_actor,
      jsonb_build_object('action', p_action, 'op_key', p_op_key));
    return jsonb_build_object('claimed', true, 'resumed', true, 'op_key', o.op_key, 'op_action', o.op_action,
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  if o.status <> 'paid' then
    return jsonb_build_object('claimed', false, 'resumed', false, 'reason', 'status',
      'status', o.status, 'order', public._order_ops_json(o));
  end if;

  update public.orders set status = v_target, op_key = p_op_key, op_action = p_action, op_actor = p_actor,
         op_lease_until = now() + interval '5 minutes', process_error = null, updated_at = now()
   where id = o.id returning * into o;
  perform public._online_event(o.id, 'claimed', v_from, v_target, p_actor,
    jsonb_build_object('action', p_action, 'op_key', p_op_key));
  return jsonb_build_object('claimed', true, 'resumed', false, 'op_key', o.op_key, 'op_action', o.op_action,
    'status', o.status, 'order', public._order_ops_json(o));
end;
$$;

create or replace function public.online_order_checkpoint(p_order_id uuid, p_step text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_skip boolean := false;
  d jsonb := coalesce(p_data, '{}'::jsonb);
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;

  if p_step = 'cf_order' then
    if o.status <> 'pending_payment' then raise exception 'checkpoint cf_order: order is %', o.status; end if;
    v_skip := o.cf_order_id is not null;
    if not v_skip then
      update public.orders set cf_order_id = d ->> 'cf_order_id', updated_at = now() where id = o.id;
    end if;
  elsif p_step in ('sr_create', 'sr_create_failed') then
    if o.status not in ('paid', 'processing', 'cancelling') then
      raise exception 'checkpoint %: order is %', p_step, o.status;
    end if;
    v_skip := o.sr_order_id is not null;
    if not v_skip and p_step = 'sr_create' then
      update public.orders set sr_order_id = d ->> 'sr_order_id', sr_shipment_id = d ->> 'sr_shipment_id',
             sr_sync_status = 'ok', sr_last_error = null, updated_at = now() where id = o.id;
    elsif not v_skip then
      update public.orders set sr_sync_status = 'failed', sr_last_error = d ->> 'error', updated_at = now() where id = o.id;
    end if;
  elsif p_step = 'error' then
    if o.status not in ('paid', 'processing', 'cancelling') then
      raise exception 'checkpoint error: order is %', o.status;
    end if;
    update public.orders set process_error = d ->> 'error', op_lease_until = now(), updated_at = now() where id = o.id;
  elsif p_step in ('sr_update', 'awb', 'pickup', 'manifest', 'label') then
    if o.status <> 'processing' then raise exception 'checkpoint %: order is %', p_step, o.status; end if;
    if p_step = 'sr_update' then
      v_skip := o.sr_updated_at is not null;
      if not v_skip then update public.orders set sr_updated_at = now() where id = o.id; end if;
    elsif p_step = 'awb' then
      v_skip := o.awb is not null;
      if not v_skip then
        if coalesce(d ->> 'awb', '') = '' then raise exception 'checkpoint awb: awb required'; end if;
        update public.orders set awb = d ->> 'awb', courier_id = nullif(d ->> 'courier_id', '')::int,
               courier_name = d ->> 'courier_name' where id = o.id;
      end if;
    elsif p_step = 'pickup' then
      v_skip := o.pickup_requested_at is not null;
      if not v_skip then update public.orders set pickup_requested_at = now() where id = o.id; end if;
    elsif p_step = 'manifest' then
      v_skip := o.manifest_url is not null;
      if not v_skip then
        if coalesce(d ->> 'manifest_url', '') = '' then raise exception 'checkpoint manifest: manifest_url required'; end if;
        update public.orders set manifest_url = d ->> 'manifest_url' where id = o.id;
      end if;
    else
      v_skip := o.label_url is not null;
      if not v_skip then
        if coalesce(d ->> 'label_url', '') = '' then raise exception 'checkpoint label: label_url required'; end if;
        update public.orders set label_url = d ->> 'label_url' where id = o.id;
      end if;
    end if;
    update public.orders set updated_at = now() where id = o.id;
  else
    raise exception 'online_order_checkpoint: unknown step %', p_step;
  end if;

  if not v_skip then
    perform public._online_event(o.id, 'checkpoint', o.status, o.status, null,
      jsonb_build_object('step', p_step, 'data', d));
  end if;
  return jsonb_build_object('step', p_step, 'skipped', v_skip);
end;
$$;

create or replace function public.online_order_prepare_process(p_order_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_ship jsonb := '[]'::jsonb;
  v_avail int := 0;
  v_refund uuid;
  v_all boolean;
  v_plan jsonb;
  v_left int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.process_plan is not null then
    return o.process_plan;
  end if;
  if o.status <> 'processing' or o.op_action <> 'process' then
    raise exception 'prepare_process: order must be claimed for processing (now %)', o.status;
  end if;
  if exists (select 1 from public.order_items i where i.order_id = o.id and i.stock_taken > 0 and i.available_qty is null) then
    raise exception 'availability not set for every item';
  end if;

  for it in select * from public.order_items where order_id = o.id order by line_no loop
    v_left := it.stock_taken - coalesce(it.available_qty, 0);
    if v_left > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', v_left);
    end if;
    v_avail := v_avail + coalesce(it.available_qty, 0);
  end loop;
  v_all := v_avail = 0;

  v_refund := public._online_refund_create(o.id, 'unavailable', v_units, v_all, p_actor);

  for it in select * from public.order_items where order_id = o.id and coalesce(available_qty, 0) > 0 order by line_no loop
    v_ship := v_ship || jsonb_build_object('item_id', it.id, 'variant_id', it.variantid, 'product_id', it.productid,
      'name', it.product_name, 'size', it.size, 'color', it.color, 'units', it.available_qty,
      'unit_price', it.unit_price,
      'paid_value', it.paid_value - coalesce((select sum(ri.credit_amount + ri.gateway_amount)
                                                from public.order_refund_items ri where ri.item_id = it.id), 0));
  end loop;

  v_plan := jsonb_build_object('shippable_items', v_ship, 'all_unavailable', v_all, 'refund_id', v_refund);
  if v_all then
    update public.orders set status = 'cancelled', process_plan = v_plan, op_key = null, op_action = null,
           op_actor = null, op_lease_until = null, updated_at = now() where id = o.id;
    perform public._online_event(o.id, 'cancelled', 'processing', 'cancelled', p_actor,
      jsonb_build_object('reason', 'no item available', 'refund_id', v_refund));
  else
    update public.orders set process_plan = v_plan, updated_at = now() where id = o.id;
    perform public._online_event(o.id, 'process_prepared', o.status, o.status, p_actor, v_plan);
  end if;
  return v_plan;
end;
$$;

create or replace function public.online_order_create_bos(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_bill int;
  v_item int;
  v_method int;
  v_value numeric(12,2);
  v_line_credit numeric(12,2);
  v_credit numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_disc numeric(12,2) := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.bill_id is not null then return o.bill_id; end if;
  if not exists (select 1 from public.order_items i where i.order_id = o.id and i.shipped_qty > 0) then
    raise exception 'create_bos: order % has no shipped items', o.order_ref;
  end if;
  select salesmethodid into v_method from public.salesmethods where lower(methodname) = 'online'
   order by salesmethodid limit 1;

  insert into public.bills (customerid, document_type, finalized, paymentstatus, notes, salesmethodid,
                            applied_codes, gst_total)
  values (o.customerid, 'bos', true, 'finalized', 'Online order ' || o.order_ref, v_method,
          case when o.promo_code is not null then array[o.promo_code] else '{}'::text[] end, 0)
  returning billid into v_bill;

  for it in select * from public.order_items where order_id = o.id and shipped_qty > 0 order by line_no loop
    -- shipped units are the ones never refunded: what the line paid minus its refunds
    select it.paid_value - coalesce(sum(ri.credit_amount + ri.gateway_amount), 0),
           it.credit_part - coalesce(sum(ri.credit_amount), 0)
      into v_value, v_line_credit
      from public.order_refund_items ri where ri.item_id = it.id;
    insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code, category,
        alteration_charge, discount_total, subtotal, gst_rate, gst_amount, total, cost_price, stitch_type, unit_type)
    select v_bill, it.shipped_qty, it.unit_price, it.variantid, it.product_name,
           it.productid, it.category_id, 0, it.unit_price * it.shipped_qty - v_value, v_value, null, 0, v_value,
           p.purchaseprice, 'unstitched', coalesce(p.unit_type, 'piece')
      from public.products p where p.productid = it.productid
    returning bill_item_id into v_item;
    update public.order_items set bill_item_id = v_item where id = it.id;
    v_total := v_total + v_value;
    v_credit := v_credit + v_line_credit;
    v_disc := v_disc + (it.unit_price * it.shipped_qty - v_value);
  end loop;

  if o.shipping > 0 and not exists (
       select 1 from public.order_refund_legs l join public.order_refunds r on r.id = l.refund_id
        where r.order_id = o.id and l.source in ('shipping_credit', 'shipping_gateway')) then
    insert into public.bill_items (billid, quantity, mrp, variantid, product_name, product_code, category,
        alteration_charge, discount_total, subtotal, gst_rate, gst_amount, total, cost_price, stitch_type, unit_type)
    values (v_bill, 1, o.shipping, null, 'Shipping', null, null, 0, 0, o.shipping, null, 0, o.shipping, 0,
            'unstitched', 'piece');
    v_total := v_total + o.shipping;
    v_credit := v_credit + o.shipping_credit_part;
  end if;

  -- payment_amount = paid online; store_credit_used = paid by store credit / voucher
  update public.bills set totalamount = v_total, discount_total = v_disc, taxable_total = v_total,
         final_amount = v_total, payment_amount = v_total - v_credit, store_credit_used = v_credit
   where billid = v_bill;
  update public.orders set bill_id = v_bill, updated_at = now() where id = o.id;
  if o.voucher_code is not null then
    update public.vouchers set redeemed_billid = v_bill where voucher_id = o.voucher_code and held_order_id = o.id;
  end if;
  if o.promo_usage_id is not null then
    update public.discount_usage set billid = v_bill where id = o.promo_usage_id;
  end if;
  perform public._online_event(o.id, 'bill_created', o.status, o.status, null, jsonb_build_object('bill_id', v_bill));
  return v_bill;
end;
$$;

create or replace function public.online_order_mark_packed(p_order_id uuid, p_shipment jsonb, p_actor uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  d jsonb := coalesce(p_shipment, '{}'::jsonb);
  v_bill int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status in ('packed', 'shipped', 'out_for_delivery', 'delivered') and o.bill_id is not null then
    return o.bill_id;
  end if;
  if o.status <> 'processing' or o.op_action <> 'process' then
    raise exception 'mark_packed: order must be claimed for processing (now %)', o.status;
  end if;
  if o.process_plan is null or coalesce((o.process_plan ->> 'all_unavailable')::boolean, false) then
    raise exception 'mark_packed: run prepare_process first';
  end if;
  update public.orders set
    awb = coalesce(awb, nullif(d ->> 'awb', '')),
    courier_id = coalesce(courier_id, nullif(d ->> 'courier_id', '')::int),
    courier_name = coalesce(courier_name, nullif(d ->> 'courier_name', '')),
    label_url = coalesce(label_url, nullif(d ->> 'label_url', '')),
    manifest_url = coalesce(manifest_url, nullif(d ->> 'manifest_url', '')),
    sr_shipment_id = coalesce(sr_shipment_id, nullif(d ->> 'sr_shipment_id', ''))
   where id = o.id returning * into o;
  if o.awb is null or o.label_url is null then
    raise exception 'mark_packed: awb and label_url are required';
  end if;

  update public.order_items set shipped_qty = coalesce(available_qty, 0) where order_id = o.id;
  update public.order_items i set status = public._item_status(i) where i.order_id = o.id;
  v_bill := public.online_order_create_bos(o.id);
  update public.orders set status = 'packed', op_key = null, op_action = null, op_actor = null,
         op_lease_until = null, process_error = null, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'packed', 'processing', 'packed', p_actor,
    jsonb_build_object('awb', o.awb, 'bill_id', v_bill));
  return v_bill;
end;
$$;

create or replace function public.online_order_cancel(p_order_id uuid, p_actor uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  v_units jsonb := '[]'::jsonb;
  v_back int;
  v_refund uuid;
  v_from text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status = 'cancelled' then
    return (select r.id from public.order_refunds r where r.order_id = o.id and r.reason = 'cancel');
  end if;
  if not (o.status = 'paid' or (o.status = 'cancelling' and o.op_action = 'cancel')) then
    raise exception 'cancel is only allowed for paid orders (now %)', o.status;
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'cancel reason is required'; end if;
  v_from := o.status;

  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    if it.qty - it.refunded_qty > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', it.qty - it.refunded_qty);
    end if;
    -- units marked not available were never on the shelf: no stock back for them
    v_back := coalesce(it.available_qty, it.stock_taken);
    if v_back > 0 then
      perform public._stock_apply(it.variantid, v_back);
    end if;
  end loop;

  v_refund := public._online_refund_create(o.id, 'cancel', v_units, true, p_actor);
  update public.orders set status = 'cancelled', op_key = null, op_action = null, op_actor = null,
         op_lease_until = null, updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'cancelled', v_from, 'cancelled', p_actor,
    jsonb_build_object('reason', p_reason, 'refund_id', v_refund));
  return v_refund;
end;
$$;

create or replace function public.online_order_apply_tracking(p_awb text, p_status text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  d jsonb := coalesce(p_payload, '{}'::jsonb);
  v_rank_old int;
  v_rank_new int;
  v_label text := coalesce(d ->> 'shipment_status', d ->> 'current_status', d ->> 'status');
  v_sid int := case when (d ->> 'shipment_status_id') ~ '^\d+$' then (d ->> 'shipment_status_id')::int end;
  v_from text;
begin
  select * into o from public.orders where awb = p_awb for update;
  if not found then
    return jsonb_build_object('matched', false, 'changed', false);
  end if;
  v_from := o.status;
  -- R15: raw courier status kept on every update
  update public.orders set tracking_status_id = coalesce(v_sid, tracking_status_id),
         tracking_label = coalesce(v_label, tracking_label), tracking_updated_at = now(), updated_at = now()
   where id = o.id;

  if p_status = 'problem' then
    update public.orders set problem = 'Courier: ' || coalesce(v_label, 'status ' || v_sid::text, 'exception')
     where id = o.id;
    perform public._online_event(o.id, 'courier_problem', o.status, o.status, null, d);
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;
  if p_status = 'cancelled' then
    if o.status in ('packed', 'shipped', 'out_for_delivery') then
      update public.orders set problem = 'Courier cancelled shipment — rebook or cancel' where id = o.id;
      perform public._online_event(o.id, 'courier_cancelled', o.status, o.status, null, d);
    end if;
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;

  v_rank_old := case o.status when 'packed' then 1 when 'shipped' then 2 when 'out_for_delivery' then 3
                              when 'delivered' then 4 when 'rto' then 5 when 'rto_received' then 6 else 0 end;
  v_rank_new := case p_status when 'shipped' then 2 when 'out_for_delivery' then 3 when 'delivered' then 4
                              when 'rto' then 5 else null end;
  if v_rank_new is null or v_rank_old = 0 or v_rank_old >= 4 or v_rank_new <= v_rank_old then
    return jsonb_build_object('matched', true, 'changed', false, 'status', o.status);
  end if;

  update public.orders set status = p_status, updated_at = now() where id = o.id;
  perform public._online_event(o.id, p_status, v_from, p_status, null, d);
  if p_status in ('shipped', 'out_for_delivery', 'delivered') and v_rank_old < 2 then
    perform public._enqueue_job(o.id, 'email_shipped');
  end if;
  if p_status = 'delivered' then
    perform public._enqueue_job(o.id, 'email_delivered');
  end if;
  return jsonb_build_object('matched', true, 'changed', true, 'status', p_status);
end;
$$;

create or replace function public.online_order_rto_received(p_order_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it public.order_items;
  ri record;
  v_units jsonb := '[]'::jsonb;
  v_n int;
  v_refund uuid;
  v_ex int;
  v_voucher text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status = 'rto_received' then
    return (select r.id from public.order_refunds r where r.order_id = o.id and r.reason = 'rto');
  end if;
  if o.status <> 'rto' then raise exception 'parcel received back is only for RTO orders (now %)', o.status; end if;

  for it in select * from public.order_items where order_id = o.id order by variantid, line_no loop
    v_n := least(it.shipped_qty - it.rto_qty, it.qty - it.refunded_qty);
    if v_n > 0 then
      v_units := v_units || jsonb_build_object('item_id', it.id, 'units', v_n);
      perform public._stock_apply(it.variantid, v_n);
      update public.order_items set rto_qty = rto_qty + v_n where id = it.id;
    end if;
  end loop;

  v_refund := public._online_refund_create(o.id, 'rto', v_units, false, p_actor);

  if v_refund is not null then
    -- Return records offset the Bill of Supply. new_billid = the online bill itself, so
    -- in-store billing never offers this as unused exchange credit (it is settled by
    -- the online refund).
    select l.voucher_id into v_voucher from public.order_refund_legs l
     where l.refund_id = v_refund and l.voucher_id is not null order by l.created_at limit 1;
    for ri in select x.item_id, x.units, x.credit_amount + x.gateway_amount as value, i.bill_item_id,
                     i.product_name, i.productid
                from public.order_refund_items x join public.order_items i on i.id = x.item_id
               where x.refund_id = v_refund loop
      insert into public.exchanges (original_bill_item_id, quantity, reason, customerid, credit_amount,
                                    voucher_id, new_billid, product_name, product_code)
      values (ri.bill_item_id, ri.units, 'RTO', o.customerid, ri.value, v_voucher, o.bill_id,
              ri.product_name, ri.productid)
      returning exchangeid into v_ex;
      update public.order_refund_items set exchange_id = v_ex where refund_id = v_refund and item_id = ri.item_id;
    end loop;
  end if;

  update public.orders set status = 'rto_received', updated_at = now() where id = o.id;
  perform public._online_event(o.id, 'rto_received', 'rto', 'rto_received', p_actor,
    jsonb_build_object('refund_id', v_refund, 'units', v_units));
  return v_refund;
end;
$$;

create or replace function public.online_refund_choose(p_token text, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.order_refunds;
  o public.orders;
  l public.order_refund_legs;
  v_vouchers jsonb := '[]'::jsonb;
  v_credit numeric(12,2) := 0;
  v_legs jsonb := '[]'::jsonb;
  v_status text;
begin
  if p_choice is null or p_choice not in ('store_credit', 'original') then raise exception 'bad choice'; end if;
  select * into r from public.order_refunds where token = p_token and p_token is not null for update;
  if not found then raise exception 'refund link not valid'; end if;
  if r.choice is not null or r.status <> 'awaiting_choice' then
    raise exception 'refund choice already made';
  end if;
  if r.token_expires_at < now() then raise exception 'refund link expired'; end if;
  select * into o from public.orders where id = r.order_id;

  update public.order_refunds set choice = p_choice, chosen_at = now(), updated_at = now() where id = r.id;
  for l in select * from public.order_refund_legs where refund_id = r.id and source in ('gateway', 'shipping_gateway')
             and status = 'pending' loop
    if p_choice = 'store_credit' then
      perform public._online_leg_complete_credit(l.id);
    else
      update public.order_refund_legs set status = 'processing', destination = 'original', updated_at = now()
       where id = l.id;
      v_legs := v_legs || jsonb_build_object('leg_id', l.id, 'amount', l.amount);
    end if;
  end loop;
  v_status := public._online_refund_recompute(r.id);

  select coalesce(jsonb_agg(jsonb_build_object('code', v.voucher_id, 'value', v.value, 'expiry', v.expiry_date)), '[]'::jsonb)
    into v_vouchers
    from public.order_refund_legs x join public.vouchers v on v.voucher_id = x.voucher_id
   where x.refund_id = r.id;
  select coalesce(sum(x.amount), 0) into v_credit from public.order_refund_legs x
   where x.refund_id = r.id and x.destination = 'store_credit' and x.status = 'completed';

  perform public._online_event(o.id, 'refund_choice', o.status, o.status, null,
    jsonb_build_object('refund_id', r.id, 'choice', p_choice));
  return jsonb_build_object('refund_id', r.id, 'order_ref', o.order_ref, 'choice', p_choice, 'status', v_status,
    'vouchers', v_vouchers, 'credit_added', v_credit, 'gateway_legs', v_legs);
end;
$$;

create or replace function public.online_refund_default_expired()
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.order_refunds;
begin
  for r in select * from public.order_refunds
            where status = 'awaiting_choice' and choice is null and token_expires_at < now()
            order by created_at for update skip locked loop
    update public.order_refunds set choice = 'original', chosen_at = now(), updated_at = now() where id = r.id;
    update public.order_refund_legs set status = 'processing', destination = 'original', updated_at = now()
     where refund_id = r.id and source in ('gateway', 'shipping_gateway') and status = 'pending';
    perform public._online_refund_recompute(r.id);
    perform public._online_event(r.order_id, 'refund_choice', null, null, null,
      jsonb_build_object('refund_id', r.id, 'choice', 'original', 'by', 'default_48h'));
    return next r.id;
  end loop;
end;
$$;

create or replace function public.online_refund_set_status(
  p_leg_id uuid, p_status text, p_cf_refund_id text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.order_refund_legs;
  v_order uuid;
begin
  if p_status is null or p_status not in ('processing', 'completed', 'failed') then
    raise exception 'online_refund_set_status: bad status %', p_status;
  end if;
  select * into l from public.order_refund_legs where id = p_leg_id for update;
  if not found then raise exception 'refund leg % not found', p_leg_id; end if;
  if l.destination is distinct from 'original' then
    raise exception 'refund leg % is not a refund to the original method', p_leg_id;
  end if;
  if l.status = 'completed' then
    return;  -- terminal
  end if;
  update public.order_refund_legs
     set status = p_status, cf_refund_id = coalesce(p_cf_refund_id, cf_refund_id),
         note = coalesce(p_note, note), updated_at = now(),
         completed_at = case when p_status = 'completed' then now() end
   where id = l.id;
  perform public._online_refund_recompute(l.refund_id);
  select order_id into v_order from public.order_refunds where id = l.refund_id;
  perform public._online_event(v_order, 'refund_leg_' || p_status, null, null, null,
    jsonb_build_object('leg_id', l.id, 'cf_refund_id', p_cf_refund_id, 'note', p_note));
end;
$$;

create or replace function public.online_jobs_claim(p_limit int default 10, p_lease interval default interval '2 minutes')
returns setof public.order_jobs
language sql
security definer
set search_path = public
as $$
  update public.order_jobs j
     set status = 'running', attempts = j.attempts + 1, locked_until = now() + p_lease, updated_at = now()
   where j.id in (
     select x.id from public.order_jobs x
      where (x.status = 'pending' and x.run_after <= now())
         or (x.status = 'running' and x.locked_until < now())
      order by x.run_after
      limit p_limit
      for update skip locked)
  returning j.*
$$;

create or replace function public.online_job_finish(p_job_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.order_jobs;
begin
  select * into j from public.order_jobs where id = p_job_id for update;
  if not found then raise exception 'job % not found', p_job_id; end if;
  if p_ok then
    update public.order_jobs set status = 'done', last_error = null, locked_until = null, updated_at = now()
     where id = j.id;
  elsif j.attempts >= 10 then
    update public.order_jobs set status = 'failed', last_error = p_error, locked_until = null, updated_at = now()
     where id = j.id;
    update public.orders set problem = 'Job ' || j.kind || ' failed: ' || coalesce(p_error, 'unknown error'),
           updated_at = now()
     where id = j.order_id;
    perform public._online_event(j.order_id, 'job_failed', null, null, null,
      jsonb_build_object('job_id', j.id, 'kind', j.kind, 'error', p_error));
  else
    update public.order_jobs set status = 'pending', last_error = p_error, locked_until = null,
           run_after = now() + least(power(2, j.attempts), 60) * interval '1 minute', updated_at = now()
     where id = j.id;
  end if;
end;
$$;

create or replace function public.online_code_check(p_code text, p_phone text, p_auth_user uuid, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_phone text := public._normalize_phone(p_phone);
  v_cust int;
  v_keys text[];
  v_voucher public.vouchers;
  v_disc public.discounts;
begin
  if p_auth_user is not null then
    select c.customerid into v_cust from public.customers c where c.auth_user_id = p_auth_user;
  end if;
  v_keys := array_remove(array[
    case when coalesce(p_ip_hash, '') <> '' then 'ip:' || p_ip_hash end,
    case when v_phone is not null then 'p:' || v_phone end,
    case when v_cust is not null then 'c:' || v_cust end], null);

  if exists (select 1 from public.code_attempts a
              where a.scope = 'code' and a.key = any (v_keys) and not a.success
                and a.created_at > now() - interval '1 hour'
              group by a.key having count(*) >= 10) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  if v_code <> '' then
    select * into v_voucher from public.vouchers vc where vc.voucher_id = v_code;
    if found and coalesce(v_voucher.redeemed, false) = false and v_voucher.held_order_id is null
       and v_voucher.expiry_date >= current_date
       and (v_voucher.source = 'online_refund' or (v_cust is not null and v_voucher.customerid = v_cust)) then
      insert into public.code_attempts (scope, key, success) select 'code', k, true from unnest(v_keys) k;
      return jsonb_build_object('status', 'ok', 'kind', 'voucher', 'code', v_voucher.voucher_id,
        'value', v_voucher.value, 'expiry', v_voucher.expiry_date);
    end if;

    select * into v_disc from public.discounts d where d.code = v_code;
    if found and public._promo_usable_online(v_disc)
       and not (coalesce(v_disc.once_per_customer, false) and (
         exists (select 1 from public.discount_usage du join public.customers c on c.customerid = du.customerid
                  where du.code = v_disc.code
                    and (c.customerid = v_cust or (v_phone is not null and c.phone = v_phone)))
         or exists (select 1 from public.promo_reservations pr
                     where pr.code = v_disc.code and pr.status in ('held', 'used')
                       and pr.identity_key = any (v_keys)))) then
      insert into public.code_attempts (scope, key, success) select 'code', k, true from unnest(v_keys) k;
      return jsonb_build_object('status', 'ok', 'kind', 'promo', 'code', v_disc.code, 'type', v_disc.type,
        'value', v_disc.value, 'max_discount', v_disc.max_discount, 'min_total', v_disc.min_total,
        'rules', v_disc.rules);
    end if;
  end if;

  insert into public.code_attempts (scope, key, success) select 'code', k, false from unnest(v_keys) k;
  return jsonb_build_object('status', 'invalid');
end;
$$;

create or replace function public.online_order_lookup(p_order_ref text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_ref text := upper(btrim(coalesce(p_order_ref, '')));
  v_ip text := nullif(btrim(split_part(coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  v_keys text[];
begin
  v_keys := array_remove(array['ref:' || v_ref, case when v_ip is not null then 'ip:' || v_ip end], null);
  if exists (select 1 from public.code_attempts a
              where a.scope = 'lookup' and a.key = any (v_keys) and not a.success
                and a.created_at > now() - interval '1 hour'
              group by a.key having count(*) >= 10) then
    return null;
  end if;
  select * into o from public.orders x where x.order_ref = v_ref;
  if not found or o.contact_phone is distinct from public._normalize_phone(p_phone) then
    insert into public.code_attempts (scope, key, success) select 'lookup', k, false from unnest(v_keys) k;
    return null;
  end if;
  return public._order_public_json(o);
end;
$$;

create or replace function public.my_online_orders()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._order_public_json(o)
    from public.orders o
   where auth.uid() is not null and o.auth_user_id = auth.uid()
     and o.status not in ('pending_payment', 'payment_failed', 'expired')
   order by o.created_at desc
$$;

-- ---------- grants ----------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.online_order_create(jsonb, jsonb, uuid)',
    'public.online_order_confirm_payment(text, text, numeric, text)',
    'public.online_order_fail(text, text, text)',
    'public.online_order_log_event(text, text, jsonb)',
    'public.online_order_list_stale(interval)',
    'public.online_order_set_problem(text, text)',
    'public.online_order_access_ok(text, text)',
    'public.online_order_set_availability(uuid, uuid, int, uuid)',
    'public.online_order_claim(uuid, text, uuid, text)',
    'public.online_order_checkpoint(uuid, text, jsonb)',
    'public.online_order_prepare_process(uuid, uuid)',
    'public.online_order_create_bos(uuid)',
    'public.online_order_mark_packed(uuid, jsonb, uuid)',
    'public.online_order_cancel(uuid, uuid, text)',
    'public.online_order_apply_tracking(text, text, jsonb)',
    'public.online_order_rto_received(uuid, uuid)',
    'public.online_refund_choose(text, text)',
    'public.online_refund_default_expired()',
    'public.online_refund_set_status(uuid, text, text, text)',
    'public.online_jobs_claim(int, interval)',
    'public.online_job_finish(uuid, boolean, text)',
    'public.online_code_check(text, text, uuid, text)',
    'public.online_order_lookup(text, text)',
    'public.my_online_orders()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
grant execute on function public.online_refund_choose(text, text) to anon, authenticated;
grant execute on function public.online_order_lookup(text, text) to anon, authenticated;
grant execute on function public.my_online_orders() to authenticated;
