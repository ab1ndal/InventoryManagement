#!/usr/bin/env bash
# Two-session concurrency test for the online order functions (plan review focus #4, R1).
# Needs the throwaway DB from scripts/test-db.sh with both migrations applied:
#   scripts/test-db.sh up
#   scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql schema/migration_online_orders.sql
#   schema/test_harness/concurrency_test.sh
# Session A confirms an order for the last unit and holds its transaction open;
# session B confirms a second order for the same unit and must block, then race.
# Session C runs an in-store stock_adjust on another variant while A holds it.
set -euo pipefail
DIR="${TEST_DB_DIR:-${TMPDIR:-/tmp}/bc-test-db}"
PORT="${TEST_DB_PORT:-54329}"
PG_BIN="${PG_BIN:-$(cd /opt/homebrew/opt/postgresql@18 && pwd -P)/bin}"
PSQL=("$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -qtA)
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

V1=11111111-1111-4111-8111-111111111111   # last unit
V2=22222222-2222-4222-8222-222222222222   # shared with in-store

"${PSQL[@]}" <<SQL
delete from public.orders where contact_name = 'Concurrency Test';
delete from public.productsizecolors where variantid in ('$V1', '$V2');
delete from public.products where productid in ('CONC1', 'CONC2');
insert into public.products (productid, name, purchaseprice, retailprice) values
  ('CONC1', 'Conc one', 500, 1000), ('CONC2', 'Conc two', 250, 500);
insert into public.productsizecolors (productid, size, color, stock, variantid) values
  ('CONC1', 'M', 'Red', 1, '$V1'), ('CONC2', 'M', 'Red', 10, '$V2');
update public.storefront_settings set checkout_live = true where id = 1;
create temp table mk (n int, ref text);
insert into mk select n, (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Test', 'phone', '+91980000010' || n),
      'address', jsonb_build_object('pincode', '201001'),
      'subtotal', 1500, 'shipping', 99, 'gateway_amount', 1599),
    jsonb_build_array(
      jsonb_build_object('variant_id', '$V1', 'qty', 1, 'unit_price', 1000),
      jsonb_build_object('variant_id', '$V2', 'qty', 1, 'unit_price', 500)), null)).order_ref
  from generate_series(1, 2) n;
\o $OUT/refs
select ref from mk order by n;
\o
SQL
REF_A="$(sed -n 1p "$OUT/refs")"
REF_B="$(sed -n 2p "$OUT/refs")"

# A: confirm and keep the transaction (and its row locks) open for 2 s
"${PSQL[@]}" -c "begin" \
  -c "select public.online_order_confirm_payment('$REF_A', 'cf_$REF_A', 1599, 'INR') ->> 'result'" \
  -c "select pg_sleep(2)" -c "commit" > "$OUT/a" &
PID_A=$!
sleep 0.5
# C: in-store sale on V2 while A holds the row: must wait, then apply on top
"${PSQL[@]}" -c "select public.stock_adjust('$V2', -3, 'instore sale', 'bill:conc')" > "$OUT/c" &
PID_C=$!
# B: same last unit: must wait for A, then find no stock
START=$(date +%s)
"${PSQL[@]}" -c "select public.online_order_confirm_payment('$REF_B', 'cf_$REF_B', 1599, 'INR')" > "$OUT/b"
WAITED=$(( $(date +%s) - START ))
wait "$PID_A" "$PID_C"

"${PSQL[@]}" > "$OUT/check" <<SQL
select (select stock from public.productsizecolors where variantid = '$V1') || ' '
    || (select stock from public.productsizecolors where variantid = '$V2') || ' '
    || (select count(*) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.order_ref = '$REF_B' and r.reason = 'stock_race' and r.status = 'awaiting_choice') || ' '
    || (select count(*) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.order_ref = '$REF_A');
update public.storefront_settings set checkout_live = false where id = 1;
delete from public.orders where contact_name = 'Concurrency Test';
delete from public.productsizecolors where variantid in ('$V1', '$V2');
delete from public.products where productid in ('CONC1', 'CONC2');
SQL

read -r S1 S2 RACE_B REFUNDS_A < "$OUT/check"
echo "A: $(cat "$OUT/a" | tr '\n' ' ')"
echo "B: $(cat "$OUT/b")"
echo "C: $(cat "$OUT/c")"
echo "stock V1=$S1 V2=$S2 raceRefundB=$RACE_B refundsA=$REFUNDS_A waitedB=${WAITED}s"
fail=0
[ "$S1" = "0.000" ] || { echo "FAIL: last unit stock should be 0"; fail=1; }
[ "$S2" = "5.000" ] || { echo "FAIL: V2 should be 10 - 1 - 1 - 3 = 5"; fail=1; }
[ "$RACE_B" = "1" ] || { echo "FAIL: B should have one stock_race refund"; fail=1; }
[ "$REFUNDS_A" = "0" ] || { echo "FAIL: A should have no refund"; fail=1; }
grep -q '"race_units": \[{"units": 1' "$OUT/b" || { echo "FAIL: B result should report 1 race unit"; fail=1; }
[ "$WAITED" -ge 1 ] || { echo "FAIL: B did not wait for A's lock"; fail=1; }
[ "$fail" = 0 ] && echo "concurrency: all checks passed"
exit "$fail"
