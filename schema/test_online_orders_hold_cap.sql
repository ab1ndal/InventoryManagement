-- Tests for schema/migration_online_orders_hold_cap.sql (30-min hold session, 10-min cooldown,
-- same-quantity re-sends keep the expiry). Each test is `begin; do $$ ... $$; rollback;`.
-- Time is simulated by moving a row's hold_started_at / expires_at; now() is fixed per transaction.
-- Run locally: the migrations listed in schema/test_online_orders_holds.sql, then
--   scripts/test-db.sh sql schema/migration_online_orders_hold_cap.sql \
--     schema/test_online_orders_holds.sql schema/test_online_orders_hold_cap.sql
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function pg_temp.mk_variant(p_stock numeric)
returns uuid language plpgsql as $$
declare
  v uuid := gen_random_uuid();
  pid text := 'T' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  insert into public.products (productid, name, purchaseprice, retailprice) values (pid, 'Test cap', 250, 500);
  insert into public.productsizecolors (productid, size, color, stock, variantid) values (pid, 'M', 'Red', p_stock, v);
  return v;
end $$;

create function pg_temp.key(p text) returns text language sql as $$
  select p || ':' || gen_random_uuid()::text
$$;

create function pg_temp.hold(p_holder text, p_v uuid, p_qty int) returns jsonb language sql as $$
  select public.stock_hold_set(p_holder, jsonb_build_array(jsonb_build_object('variant_id', p_v, 'qty', p_qty)), null, false)
$$;

create function pg_temp.item(p_res jsonb) returns jsonb language sql as $$
  select p_res -> 'items' -> 0
$$;

create function pg_temp.row_of(p_holder text, p_v uuid) returns public.stock_holds language sql as $$
  select * from public.stock_holds where holder_key = p_holder and variant_id = p_v and order_id is null
$$;

-- Moves the holder's cart hold back in time: session started p_age ago, expiring at now() + p_left.
create function pg_temp.age(p_holder text, p_v uuid, p_age interval, p_left interval) returns void language sql as $$
  update public.stock_holds set hold_started_at = now() - p_age, expires_at = now() + p_left
   where holder_key = p_holder and variant_id = p_v and order_id is null
$$;

-- ---------- same quantity again (reload / cart open) keeps the expiry; a change extends it ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(5);
  g text := pg_temp.key('g');
  res jsonb;
begin
  res := pg_temp.hold(g, v, 1);
  assert (res ->> 'expires_at')::timestamptz = now() + interval '15 minutes', 'new hold: 15 min';
  assert (pg_temp.row_of(g, v)).hold_started_at = now(), 'session starts now';

  perform pg_temp.age(g, v, interval '10 minutes', interval '5 minutes');
  res := pg_temp.hold(g, v, 1);
  assert (pg_temp.item(res) ->> 'held')::int = 1, 'still held';
  assert (res ->> 'expires_at')::timestamptz = now() + interval '5 minutes', 'same qty: clock unchanged';

  res := pg_temp.hold(g, v, 2);
  assert (res ->> 'expires_at')::timestamptz = now() + interval '15 minutes', 'qty change: renewed to 15 min';
  assert (pg_temp.row_of(g, v)).hold_started_at = now() - interval '10 minutes', 'session start kept';
end $$;
rollback;

-- ---------- renewals never pass 30 min from the session start ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(5);
  g text := pg_temp.key('g');
  res jsonb;
begin
  perform pg_temp.hold(g, v, 1);
  perform pg_temp.age(g, v, interval '25 minutes', interval '2 minutes');
  res := pg_temp.hold(g, v, 2);
  assert (pg_temp.item(res) ->> 'held')::int = 2, 'held';
  assert (res ->> 'expires_at')::timestamptz = now() + interval '5 minutes', 'capped at start + 30 min';

  -- lapsed inside the session: re-taken, still capped by the same start
  perform pg_temp.age(g, v, interval '20 minutes', interval '-1 minute');
  res := pg_temp.hold(g, v, 2);
  assert (pg_temp.item(res) ->> 'held')::int = 2, 're-taken within the session';
  assert (res ->> 'expires_at')::timestamptz = now() + interval '10 minutes', 're-taken hold capped at start + 30 min';
end $$;
rollback;

-- ---------- after 30 min: 10-min cooldown, others can take it; then a fresh session ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1);
  g text := pg_temp.key('g');
  g2 text := pg_temp.key('g');
  res jsonb;
begin
  perform pg_temp.hold(g, v, 1);
  perform pg_temp.age(g, v, interval '35 minutes', interval '-5 minutes');
  res := pg_temp.hold(g, v, 1);
  assert (pg_temp.item(res) ->> 'held')::int = 0 and pg_temp.item(res) ->> 'reason' = 'cooldown', 'cooldown';
  assert (pg_temp.item(res) ->> 'available')::int = 1, 'still buyable: nobody else holds it';
  assert res ->> 'expires_at' is null, 'no active hold';
  assert (pg_temp.row_of(g, v)).id is not null, 'row kept as the session marker';

  -- even at the session edge (exactly 30 min) the hold is over
  perform pg_temp.age(g, v, interval '30 minutes', interval '0 minutes');
  assert pg_temp.item(pg_temp.hold(g, v, 1)) ->> 'reason' = 'cooldown', 'cooldown from minute 30';

  res := pg_temp.hold(g2, v, 1);
  assert (pg_temp.item(res) ->> 'held')::int = 1, 'another shopper can hold it during the cooldown';
  delete from public.stock_holds where holder_key = g2;

  perform pg_temp.age(g, v, interval '41 minutes', interval '-11 minutes');
  res := pg_temp.hold(g, v, 1);
  assert (pg_temp.item(res) ->> 'held')::int = 1 and pg_temp.item(res) ->> 'reason' is null, 'fresh session after cooldown';
  assert (res ->> 'expires_at')::timestamptz = now() + interval '15 minutes', 'fresh 15 min';
  assert (pg_temp.row_of(g, v)).hold_started_at = now(), 'new session start';
end $$;
rollback;

-- ---------- releasing keeps the session: remove + re-add or replace can't reset the 30 min ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(1);
  w uuid := pg_temp.mk_variant(1);
  g text := pg_temp.key('g');
  g2 text := pg_temp.key('g');
  res jsonb;
begin
  perform pg_temp.hold(g, v, 1);
  perform pg_temp.age(g, v, interval '20 minutes', interval '5 minutes');
  res := pg_temp.hold(g, v, 0);
  assert (pg_temp.item(res) ->> 'held')::int = 0 and pg_temp.item(res) ->> 'reason' is null, 'released';
  assert (pg_temp.row_of(g, v)).expires_at <= now(), 'release ends the hold';
  assert (select available from public.variant_availability(array[v], g2)) = 1, 'released unit free for others';

  res := pg_temp.hold(g, v, 1);
  assert (res ->> 'expires_at')::timestamptz = now() + interval '10 minutes', 're-add resumes the session (start + 30 min)';

  -- replace drops w but keeps its row and start
  perform pg_temp.hold(g, w, 1);
  perform pg_temp.age(g, w, interval '28 minutes', interval '2 minutes');
  perform public.stock_hold_set(g, jsonb_build_array(jsonb_build_object('variant_id', v, 'qty', 1)), null, true);
  assert (pg_temp.row_of(g, w)).expires_at <= now(), 'replace released w';
  assert (pg_temp.row_of(g, w)).hold_started_at = now() - interval '28 minutes', 'w session kept';
  res := pg_temp.hold(g, w, 1);
  assert (res -> 'items' -> 0 ->> 'expires_at')::timestamptz = now() + interval '2 minutes', 'w re-add capped by old start';
end $$;
rollback;

-- ---------- sign-in adopt keeps the earlier session start ----------
begin;
do $$
declare
  v uuid := pg_temp.mk_variant(5);
  g text := pg_temp.key('g');
  u text := pg_temp.key('u');
begin
  perform pg_temp.hold(g, v, 1);
  perform pg_temp.age(g, v, interval '20 minutes', interval '5 minutes');
  perform pg_temp.hold(u, v, 1);
  perform public.stock_hold_adopt(g, u);
  assert (pg_temp.row_of(u, v)).hold_started_at = now() - interval '20 minutes', 'earlier start wins';
  assert (pg_temp.row_of(g, v)).id is null, 'guest row merged away';
end $$;
rollback;

select 'test_online_orders_hold_cap: all passed' as result;
