#!/usr/bin/env bash
# Two-session concurrency test for the online order functions (plan review focus #4, R1).
# Needs the throwaway DB from scripts/test-db.sh with all online-order migrations applied (through _holds):
#   scripts/test-db.sh up
#   scripts/test-db.sh sql <the migrations listed in schema/test_online_orders_holds.sql>
#   scripts/test-db.sh sql schema/migration_bill_save.sql
#   scripts/test-db.sh sql <the bill migrations listed in schema/test_bill_excess_credit.sql, from bill_stock_reduced>
#   schema/test_harness/concurrency_test.sh
# Session A confirms an order that holds the last unit and keeps its transaction open;
# session B confirms a second order for the same unit (one from before stock holds, so it
# holds nothing) and must block, then race. Session C runs an in-store stock_adjust on
# another variant while A holds it. A later section runs it the other way round: the
# non-holder pays first and still can't take the held unit.
set -euo pipefail
DIR="${TEST_DB_DIR:-${TMPDIR:-/tmp}/bc-test-db}"
PORT="${TEST_DB_PORT:-54329}"
PG_BIN="${PG_BIN:-$(cd /opt/homebrew/opt/postgresql@18 && pwd -P)/bin}"
PSQL=("$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -qtA)
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# Cleanup removes the finalized bills these cases create. Live bills refuse that (only drafts can
# be deleted, schema/migration_bill_status_states.sql), so the cleanup turns that one trigger off
# for its own statements, when it exists.
BILLS_DELETE_ANY="do \$\$ begin if exists (select 1 from pg_trigger where tgname = 'trg_bills_status_insert_delete') then alter table public.bills disable trigger trg_bills_status_insert_delete; end if; end \$\$;"
BILLS_DELETE_DRAFTS="do \$\$ begin if exists (select 1 from pg_trigger where tgname = 'trg_bills_status_insert_delete') then alter table public.bills enable trigger trg_bills_status_insert_delete; end if; end \$\$;"

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
-- B (n=2) first: a pending order from before stock holds existed, so its holds are dropped.
-- A (n=1) then holds the last unit for its shopper.
insert into mk select n, (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Test', 'phone', '+91980000010' || n),
      'address', jsonb_build_object('pincode', '201001'),
      'subtotal', 1500, 'shipping', 99, 'gateway_amount', 1599),
    jsonb_build_array(
      jsonb_build_object('variant_id', '$V1', 'qty', 1, 'unit_price', 1000),
      jsonb_build_object('variant_id', '$V2', 'qty', 1, 'unit_price', 500)), null)).order_ref
  from (values (2)) x(n);
delete from public.stock_holds where order_id = (select o.id from public.orders o join mk on mk.ref = o.order_ref where mk.n = 2);
insert into mk select n, (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Test', 'phone', '+91980000010' || n),
      'address', jsonb_build_object('pincode', '201001'),
      'subtotal', 1500, 'shipping', 99, 'gateway_amount', 1599,
      'holder_key', 'g:' || gen_random_uuid()),
    jsonb_build_array(
      jsonb_build_object('variant_id', '$V1', 'qty', 1, 'unit_price', 1000),
      jsonb_build_object('variant_id', '$V2', 'qty', 1, 'unit_price', 500)), null)).order_ref
  from (values (1)) x(n);
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
         where o.order_ref = '$REF_A') || ' '
    || (select count(*) from public.stock_holds h join public.orders o on o.id = h.order_id
         where o.contact_name = 'Concurrency Test');
update public.storefront_settings set checkout_live = false where id = 1;
delete from public.orders where contact_name = 'Concurrency Test';
delete from public.productsizecolors where variantid in ('$V1', '$V2');
delete from public.products where productid in ('CONC1', 'CONC2');
SQL

read -r S1 S2 RACE_B REFUNDS_A HOLDS_LEFT < "$OUT/check"
echo "A: $(cat "$OUT/a" | tr '\n' ' ')"
echo "B: $(cat "$OUT/b")"
echo "C: $(cat "$OUT/c")"
echo "stock V1=$S1 V2=$S2 raceRefundB=$RACE_B refundsA=$REFUNDS_A holdsLeft=$HOLDS_LEFT waitedB=${WAITED}s"
fail=0
[ "$S1" = "0.000" ] || { echo "FAIL: last unit stock should be 0"; fail=1; }
[ "$S2" = "5.000" ] || { echo "FAIL: V2 should be 10 - 1 - 1 - 3 = 5"; fail=1; }
[ "$RACE_B" = "1" ] || { echo "FAIL: B should have one stock_race refund"; fail=1; }
[ "$REFUNDS_A" = "0" ] || { echo "FAIL: A should have no refund"; fail=1; }
grep -q '"race_units": \[{"units": 1' "$OUT/b" || { echo "FAIL: B result should report 1 race unit"; fail=1; }
[ "$WAITED" -ge 1 ] || { echo "FAIL: B did not wait for A's lock"; fail=1; }
[ "$HOLDS_LEFT" = "0" ] || { echo "FAIL: confirmed orders must leave no stock holds"; fail=1; }

# ---- stock holds: the non-holder pays first and blocks; the holder still gets the unit ----
V5=55555555-5555-4555-8555-555555555555
cleanup_hold() {
  "${PSQL[@]}" > /dev/null <<SQL
update public.storefront_settings set checkout_live = false where id = 1;
delete from public.orders where contact_name = 'Concurrency Hold';
delete from public.productsizecolors where variantid = '$V5';
delete from public.products where productid = 'CONC5';
SQL
}
cleanup_hold
"${PSQL[@]}" > "$OUT/hold_refs" <<SQL
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONC5', 'Conc five', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONC5', 'M', 'Red', 1, '$V5');
update public.storefront_settings set checkout_live = true where id = 1;
create temp table hk (n int, ref text);
-- n=1 non-holder (pre-holds order, holds dropped), n=2 holder
insert into hk select 1, (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Hold', 'phone', '+919800000201'),
      'address', jsonb_build_object('pincode', '201001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
    jsonb_build_array(jsonb_build_object('variant_id', '$V5', 'qty', 1, 'unit_price', 1000)), null)).order_ref;
delete from public.stock_holds where order_id = (select o.id from public.orders o join hk on hk.ref = o.order_ref);
insert into hk select 2, (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Hold', 'phone', '+919800000202'),
      'address', jsonb_build_object('pincode', '201001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099,
      'holder_key', 'g:' || gen_random_uuid()),
    jsonb_build_array(jsonb_build_object('variant_id', '$V5', 'qty', 1, 'unit_price', 1000)), null)).order_ref;
select ref from hk order by n;
SQL
REF_N="$(sed -n 1p "$OUT/hold_refs")"
REF_H="$(sed -n 2p "$OUT/hold_refs")"
"${PSQL[@]}" -c "begin" \
  -c "select public.online_order_confirm_payment('$REF_N', 'cf_$REF_N', 1099, 'INR') ->> 'status'" \
  -c "select pg_sleep(2)" -c "commit" > "$OUT/hold_n" &
PID_N=$!
sleep 0.5
START=$(date +%s)
"${PSQL[@]}" -c "select public.online_order_confirm_payment('$REF_H', 'cf_$REF_H', 1099, 'INR') ->> 'status'" > "$OUT/hold_h"
HOLD_WAITED=$(( $(date +%s) - START ))
wait "$PID_N"
HOLD_CHECK="$("${PSQL[@]}" -c "select (select stock from public.productsizecolors where variantid = '$V5') || ' '
  || (select count(*) from public.order_refunds r join public.orders o on o.id = r.order_id
       where o.order_ref = '$REF_N' and r.reason = 'stock_race') || ' '
  || (select count(*) from public.order_refunds r join public.orders o on o.id = r.order_id where o.order_ref = '$REF_H')")"
cleanup_hold
read -r S5 RACE_N REFUNDS_H <<< "$HOLD_CHECK"
echo "hold: N=$(tr '\n' ' ' < "$OUT/hold_n") H=$(cat "$OUT/hold_h") stock V5=$S5 raceN=$RACE_N refundsH=$REFUNDS_H waitedH=${HOLD_WAITED}s"
[ "$S5" = "0.000" ] || { echo "FAIL: held unit should be sold exactly once"; fail=1; }
grep -q '^cancelled$' "$OUT/hold_n" || { echo "FAIL: non-holder paying first must not take the held unit"; fail=1; }
[ "$(cat "$OUT/hold_h")" = "paid" ] || { echo "FAIL: holder should be paid"; fail=1; }
[ "$RACE_N" = "1" ] || { echo "FAIL: non-holder should get one stock_race refund"; fail=1; }
[ "$REFUNDS_H" = "0" ] || { echo "FAIL: holder should have no refund"; fail=1; }
[ "$HOLD_WAITED" -ge 1 ] || { echo "FAIL: holder did not wait for the non-holder's lock"; fail=1; }

# ---- cart holds: two shoppers hold the last unit at once → exactly one gets it ----
V6=66666666-6666-4666-8666-666666666666
"${PSQL[@]}" > /dev/null <<SQL
delete from public.productsizecolors where variantid = '$V6';
delete from public.products where productid = 'CONC6';
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONC6', 'Conc six', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONC6', 'M', 'Red', 1, '$V6');
SQL
HOLD_SQL="select public.stock_hold_set('g:' || gen_random_uuid(), '[{\"variant_id\": \"$V6\", \"qty\": 1}]', null, false) -> 'items' -> 0 ->> 'held'"
"${PSQL[@]}" -c "begin" -c "$HOLD_SQL" -c "select pg_sleep(1.5)" -c "commit" > "$OUT/cart_x" &
PID_CX=$!
sleep 0.5
"${PSQL[@]}" -c "$HOLD_SQL" > "$OUT/cart_y"
wait "$PID_CX"
CART_HOLDS="$("${PSQL[@]}" -c "select coalesce(sum(qty), 0) from public.stock_holds where variant_id = '$V6'")"
"${PSQL[@]}" > /dev/null <<SQL
delete from public.code_attempts where scope = 'hold' and key in (select holder_key from public.stock_holds where variant_id = '$V6');
delete from public.productsizecolors where variantid = '$V6';
delete from public.products where productid = 'CONC6';
SQL
echo "cart hold race: X=$(tr '\n' ' ' < "$OUT/cart_x") Y=$(cat "$OUT/cart_y") held=$CART_HOLDS"
[ "$CART_HOLDS" = "1" ] || { echo "FAIL: the last unit must be held once"; fail=1; }
grep -q '^1$' "$OUT/cart_x" && [ "$(cat "$OUT/cart_y")" = "0" ] || { echo "FAIL: first holder 1, second 0"; fail=1; }

# ---- _online_bill_offset: two sessions, same refund -> exactly items + 1 shipping rows ----
V3=33333333-3333-4333-8333-333333333333
"${PSQL[@]}" > "$OUT/offset_refund" <<SQL
delete from public.exchanges where order_refund_id in (select r.id from public.order_refunds r join public.orders o on o.id = r.order_id where o.contact_name = 'Concurrency Offset');
create temp table offset_bills as select bill_id from public.orders where contact_name = 'Concurrency Offset' and bill_id is not null;
delete from public.orders where contact_name = 'Concurrency Offset';
$BILLS_DELETE_ANY
delete from public.bills where billid in (select bill_id from offset_bills);
$BILLS_DELETE_DRAFTS
delete from public.productsizecolors where variantid = '$V3';
delete from public.products where productid = 'CONC3';
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONC3', 'Conc three', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONC3', 'M', 'Red', 5, '$V3');
update public.storefront_settings set checkout_live = true where id = 1;
do \$\$
declare
  r record; v_ref text; v_order uuid; v_item uuid; v_refund uuid;
begin
  v_ref := (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Offset', 'phone', '+919800000099'),
      'address', jsonb_build_object('pincode', '201001'), 'subtotal', 2000, 'shipping', 99, 'gateway_amount', 2099),
    jsonb_build_array(jsonb_build_object('variant_id', '$V3', 'qty', 2, 'unit_price', 1000)), null)).order_ref;
  select id into v_order from public.orders where order_ref = v_ref;
  perform public.online_order_confirm_payment(v_ref, 'cf_' || v_ref, 2099, 'INR');
  select id into v_item from public.order_items where order_id = v_order;
  perform public.online_order_set_availability(v_order, v_item, 2, null);
  perform public.online_order_claim(v_order, 'process', null, 'op-conc');
  perform public.online_order_prepare_process(v_order, null);
  perform public.online_order_checkpoint(v_order, 'awb', '{"awb":"AWBCONC","courier_id":7,"courier_name":"T"}', 'op-conc');
  perform public.online_order_checkpoint(v_order, 'label', '{"label_url":"https://x/l.pdf"}', 'op-conc');
  perform public.online_order_mark_packed(v_order, '{}'::jsonb, null, 'op-conc');
  insert into public.order_refunds (order_id, reason, units, total_amount, shipping_amount)
  values (v_order, 'cancel', 1, 1099, 99) returning id into v_refund;
  insert into public.order_refund_items (refund_id, item_id, units, gateway_amount) values (v_refund, v_item, 1, 1000);
  insert into public.order_refund_legs (refund_id, source, amount) values (v_refund, 'shipping_gateway', 99);
end \$\$;
select id from public.order_refunds r where r.order_id = (select id from public.orders where contact_name = 'Concurrency Offset');
SQL
REFUND_ID="$(tr -d '[:space:]' < "$OUT/offset_refund")"
"${PSQL[@]}" -c "begin" -c "select public._online_bill_offset('$REFUND_ID', 'cancel', true)" \
  -c "select pg_sleep(1.5)" -c "commit" > /dev/null &
PID_X=$!
sleep 0.5
"${PSQL[@]}" -c "select public._online_bill_offset('$REFUND_ID', 'cancel', true)" > /dev/null
wait "$PID_X"
OFFSET_ROWS="$("${PSQL[@]}" -c "select count(*) from public.exchanges where order_refund_id = '$REFUND_ID'")"
"${PSQL[@]}" > /dev/null <<SQL
update public.storefront_settings set checkout_live = false where id = 1;
delete from public.exchanges where order_refund_id in (select r.id from public.order_refunds r join public.orders o on o.id = r.order_id where o.contact_name = 'Concurrency Offset');
create temp table offset_bills as select bill_id from public.orders where contact_name = 'Concurrency Offset' and bill_id is not null;
delete from public.orders where contact_name = 'Concurrency Offset';
$BILLS_DELETE_ANY
delete from public.bills where billid in (select bill_id from offset_bills);
$BILLS_DELETE_DRAFTS
delete from public.productsizecolors where variantid = '$V3';
delete from public.products where productid = 'CONC3';
SQL
echo "offset rows=$OFFSET_ROWS"
[ "$OFFSET_ROWS" = "2" ] || { echo "FAIL: two sessions should leave exactly items+1 = 2 offset rows"; fail=1; }

# ---- online_return_open: two sessions, same last returnable unit -> exactly one return ----
V4=44444444-4444-4444-8444-444444444444
cleanup_return() {
  "${PSQL[@]}" > /dev/null <<SQL
update public.storefront_settings set checkout_live = false where id = 1;
create temp table ret_bills as select bill_id from public.orders where contact_name = 'Concurrency Return' and bill_id is not null;
delete from public.orders where contact_name = 'Concurrency Return';
$BILLS_DELETE_ANY
delete from public.bills where billid in (select bill_id from ret_bills);
$BILLS_DELETE_DRAFTS
delete from public.productsizecolors where variantid = '$V4';
delete from public.products where productid = 'CONC4';
SQL
}
cleanup_return
"${PSQL[@]}" > "$OUT/return_ids" <<SQL
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONC4', 'Conc four', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONC4', 'M', 'Red', 5, '$V4');
update public.storefront_settings set checkout_live = true where id = 1;
create temp table ret_ids (order_id uuid, item_id uuid);
do \$\$
declare
  v_ref text; v_order uuid; v_item uuid;
begin
  v_ref := (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Return', 'phone', '+919800000098'),
      'address', jsonb_build_object('pincode', '201001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
    jsonb_build_array(jsonb_build_object('variant_id', '$V4', 'qty', 1, 'unit_price', 1000)), null)).order_ref;
  select id into v_order from public.orders where order_ref = v_ref;
  perform public.online_order_confirm_payment(v_ref, 'cf_' || v_ref, 1099, 'INR');
  select id into v_item from public.order_items where order_id = v_order;
  perform public.online_order_set_availability(v_order, v_item, 1, null);
  perform public.online_order_claim(v_order, 'process', null, 'op-ret');
  perform public.online_order_prepare_process(v_order, null);
  perform public.online_order_checkpoint(v_order, 'awb', '{"awb":"AWBRET","courier_id":7,"courier_name":"T"}', 'op-ret');
  perform public.online_order_checkpoint(v_order, 'label', '{"label_url":"https://x/l.pdf"}', 'op-ret');
  perform public.online_order_mark_packed(v_order, '{}'::jsonb, null, 'op-ret');
  perform public.online_order_apply_tracking('AWBRET', 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_apply_tracking('AWBRET', 'delivered', '{"shipment_status_id":7}');
  insert into ret_ids values (v_order, v_item);
end \$\$;
select order_id || ' ' || item_id from ret_ids;
SQL
read -r RET_ORDER RET_ITEM < "$OUT/return_ids"
OPEN_SQL="select public.online_return_open('$RET_ORDER', null, false, 'change_of_mind', now(), jsonb_build_array(jsonb_build_object('item_id', '$RET_ITEM', 'units', 1)), 'conc', null, null)"
"${PSQL[@]}" -c "begin" -c "$OPEN_SQL" -c "select pg_sleep(1.5)" -c "commit" > "$OUT/ret_a" 2> "$OUT/ret_a_err" &
PID_RA=$!
sleep 0.5
set +e
START=$(date +%s)
"${PSQL[@]}" -c "$OPEN_SQL" > "$OUT/ret_b" 2> "$OUT/ret_b_err"
RET_B_RC=$?
RET_WAITED=$(( $(date +%s) - START ))
set -e
wait "$PID_RA" || true
RET_ROWS="$("${PSQL[@]}" -c "select count(*) from public.order_returns where order_id = '$RET_ORDER'")"
cleanup_return
echo "return open: rows=$RET_ROWS B_rc=$RET_B_RC waitedB=${RET_WAITED}s B_err=$(tr '\n' ' ' < "$OUT/ret_b_err")"
[ "$RET_ROWS" = "1" ] || { echo "FAIL: exactly one return should exist for the last returnable unit"; fail=1; }
[ "$RET_B_RC" != "0" ] || { echo "FAIL: second open should be refused"; fail=1; }
grep -q 'returnable' "$OUT/ret_b_err" || { echo "FAIL: B should fail on returnable units"; fail=1; }
[ "$RET_WAITED" -ge 1 ] || { echo "FAIL: B did not wait for A's order lock"; fail=1; }

# ---- online_return_receive vs exchange_record: same last unit -> exactly one succeeds ----
V5=55555555-5555-4555-8555-555555555555
ADMIN5=55555555-0000-4000-8000-000000000005
cleanup_exch() {
  "${PSQL[@]}" > /dev/null <<SQL
update public.storefront_settings set checkout_live = false where id = 1;
create temp table ex_bills as select bill_id from public.orders where contact_name = 'Concurrency Exchange' and bill_id is not null;
delete from public.exchanges where original_bill_item_id in (select bill_item_id from public.bill_items where billid in (select bill_id from ex_bills));
delete from public.orders where contact_name = 'Concurrency Exchange';
$BILLS_DELETE_ANY
delete from public.bills where billid in (select bill_id from ex_bills);
$BILLS_DELETE_DRAFTS
delete from public.productsizecolors where variantid = '$V5';
delete from public.products where productid = 'CONC5';
delete from public.profiles where id = '$ADMIN5';
delete from auth.users where id = '$ADMIN5';
SQL
}
cleanup_exch
"${PSQL[@]}" > "$OUT/exch_ids" <<SQL
insert into auth.users (id) values ('$ADMIN5');
insert into public.profiles (id, email, role, is_active) values ('$ADMIN5', 'conc5@t.in', 'admin', true);
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONC5', 'Conc five', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONC5', 'M', 'Red', 5, '$V5');
update public.storefront_settings set checkout_live = true where id = 1;
create temp table ex_ids (ret_id uuid, item_id uuid, bill_id int, bill_item_id int);
do \$\$
declare
  v_ref text; v_order uuid; v_item uuid;
begin
  v_ref := (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency Exchange', 'phone', '+919800000097'),
      'address', jsonb_build_object('pincode', '201001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
    jsonb_build_array(jsonb_build_object('variant_id', '$V5', 'qty', 1, 'unit_price', 1000)), null)).order_ref;
  select id into v_order from public.orders where order_ref = v_ref;
  perform public.online_order_confirm_payment(v_ref, 'cf_' || v_ref, 1099, 'INR');
  select id into v_item from public.order_items where order_id = v_order;
  perform public.online_order_set_availability(v_order, v_item, 1, null);
  perform public.online_order_claim(v_order, 'process', null, 'op-exch');
  perform public.online_order_prepare_process(v_order, null);
  perform public.online_order_checkpoint(v_order, 'awb', '{"awb":"AWBEXCH","courier_id":7,"courier_name":"T"}', 'op-exch');
  perform public.online_order_checkpoint(v_order, 'label', '{"label_url":"https://x/l.pdf"}', 'op-exch');
  perform public.online_order_mark_packed(v_order, '{}'::jsonb, null, 'op-exch');
  perform public.online_order_apply_tracking('AWBEXCH', 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_apply_tracking('AWBEXCH', 'delivered', '{"shipment_status_id":7}');
  insert into ex_ids
  select public.online_return_open(v_order, null, false, 'change_of_mind', now(),
           jsonb_build_array(jsonb_build_object('item_id', v_item, 'units', 1)), 'conc', null, null),
         v_item, o.bill_id, i.bill_item_id
    from public.orders o join public.order_items i on i.order_id = o.id where o.id = v_order;
end \$\$;
select ret_id || ' ' || item_id || ' ' || bill_id || ' ' || bill_item_id from ex_ids;
SQL
read -r EX_RET EX_ITEM EX_BILL EX_BI < "$OUT/exch_ids"
# A: receive the online return (1 unit) and hold its locks
"${PSQL[@]}" -c "begin" \
  -c "select public.online_return_receive('$EX_RET', null, jsonb_build_array(jsonb_build_object('item_id', '$EX_ITEM', 'received_units', 1, 'restock_units', 1)), null) ->> 'status'" \
  -c "select pg_sleep(1.5)" -c "commit" > "$OUT/exch_a" 2> "$OUT/exch_a_err" &
PID_EA=$!
sleep 0.5
# B: in-store exchange of the same unit, as an admin: must wait for A, then be refused
set +e
START=$(date +%s)
"${PSQL[@]}" -c "select set_config('request.jwt.claims', '{\"sub\":\"$ADMIN5\",\"role\":\"authenticated\"}', false)" \
  -c "select public.exchange_record($EX_BILL, null, jsonb_build_array(jsonb_build_object('bill_item_id', $EX_BI, 'quantity', 1, 'credit_amount', 1000, 'reason', 'conc', 'product_name', 'Conc five', 'product_code', 'CONC5')))" \
  > "$OUT/exch_b" 2> "$OUT/exch_b_err"
EX_B_RC=$?
EX_WAITED=$(( $(date +%s) - START ))
set -e
wait "$PID_EA" || true
"${PSQL[@]}" > "$OUT/exch_check" <<SQL
select (select count(*) from public.exchanges where original_bill_item_id = $EX_BI and order_refund_id is null) || ' '
    || (select count(*) from public.exchanges where original_bill_item_id = $EX_BI and order_refund_id is not null) || ' '
    || (select stock from public.productsizecolors where variantid = '$V5');
SQL
read -r EX_INSTORE EX_ONLINE EX_STOCK < "$OUT/exch_check"
cleanup_exch
echo "receive vs exchange: A=$(tr '\n' ' ' < "$OUT/exch_a") B_rc=$EX_B_RC waitedB=${EX_WAITED}s instore=$EX_INSTORE online=$EX_ONLINE stock=$EX_STOCK B_err=$(tr '\n' ' ' < "$OUT/exch_b_err")"
grep -q 'refunded' "$OUT/exch_a" || { echo "FAIL: A should refund the return"; fail=1; }
[ "$EX_B_RC" != "0" ] || { echo "FAIL: exchange of the refunded unit should be refused"; fail=1; }
grep -q 'already returned' "$OUT/exch_b_err" || { echo "FAIL: B should fail on already returned"; fail=1; }
[ "$EX_INSTORE" = "0" ] && [ "$EX_ONLINE" = "1" ] || { echo "FAIL: exactly one return of the unit (online)"; fail=1; }
[ "$EX_STOCK" = "5.000" ] || { echo "FAIL: stock should be 5 - 1 sold + 1 restocked = 5"; fail=1; }
[ "$EX_WAITED" -ge 1 ] || { echo "FAIL: B did not wait for A's order lock"; fail=1; }

# ---- exchange_record vs online_return_open: free last unit, no return yet -> exactly one succeeds ----
V6=66666666-6666-4666-8666-666666666666
ADMIN6=66666666-0000-4000-8000-000000000006
cleanup_exch_open() {
  "${PSQL[@]}" > /dev/null <<SQL
update public.storefront_settings set checkout_live = false where id = 1;
create temp table eo_bills as select bill_id from public.orders where contact_name = 'Concurrency ExchOpen' and bill_id is not null;
delete from public.exchanges where original_bill_item_id in (select bill_item_id from public.bill_items where billid in (select bill_id from eo_bills));
delete from public.orders where contact_name = 'Concurrency ExchOpen';
$BILLS_DELETE_ANY
delete from public.bills where billid in (select bill_id from eo_bills);
$BILLS_DELETE_DRAFTS
delete from public.productsizecolors where variantid = '$V6';
delete from public.products where productid = 'CONC6';
delete from public.profiles where id = '$ADMIN6';
delete from auth.users where id = '$ADMIN6';
SQL
}
cleanup_exch_open
"${PSQL[@]}" > "$OUT/eo_ids" <<SQL
insert into auth.users (id) values ('$ADMIN6');
insert into public.profiles (id, email, role, is_active) values ('$ADMIN6', 'conc6@t.in', 'admin', true);
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONC6', 'Conc six', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONC6', 'M', 'Red', 5, '$V6');
update public.storefront_settings set checkout_live = true where id = 1;
create temp table eo_ids (order_id uuid, item_id uuid, bill_id int, bill_item_id int);
do \$\$
declare
  v_ref text; v_order uuid; v_item uuid;
begin
  v_ref := (public.online_order_create(
    jsonb_build_object('contact', jsonb_build_object('name', 'Concurrency ExchOpen', 'phone', '+919800000096'),
      'address', jsonb_build_object('pincode', '201001'), 'subtotal', 1000, 'shipping', 99, 'gateway_amount', 1099),
    jsonb_build_array(jsonb_build_object('variant_id', '$V6', 'qty', 1, 'unit_price', 1000)), null)).order_ref;
  select id into v_order from public.orders where order_ref = v_ref;
  perform public.online_order_confirm_payment(v_ref, 'cf_' || v_ref, 1099, 'INR');
  select id into v_item from public.order_items where order_id = v_order;
  perform public.online_order_set_availability(v_order, v_item, 1, null);
  perform public.online_order_claim(v_order, 'process', null, 'op-eo');
  perform public.online_order_prepare_process(v_order, null);
  perform public.online_order_checkpoint(v_order, 'awb', '{"awb":"AWBEO","courier_id":7,"courier_name":"T"}', 'op-eo');
  perform public.online_order_checkpoint(v_order, 'label', '{"label_url":"https://x/l.pdf"}', 'op-eo');
  perform public.online_order_mark_packed(v_order, '{}'::jsonb, null, 'op-eo');
  perform public.online_order_apply_tracking('AWBEO', 'shipped', '{"shipment_status_id":6}');
  perform public.online_order_apply_tracking('AWBEO', 'delivered', '{"shipment_status_id":7}');
  insert into eo_ids select v_order, v_item, o.bill_id, i.bill_item_id
    from public.orders o join public.order_items i on i.order_id = o.id where o.id = v_order;
end \$\$;
select order_id || ' ' || item_id || ' ' || bill_id || ' ' || bill_item_id from eo_ids;
SQL
read -r EO_ORDER EO_ITEM EO_BILL EO_BI < "$OUT/eo_ids"
# A: in-store exchange of the only unit, as an admin, holding its locks
"${PSQL[@]}" -c "begin" \
  -c "select set_config('request.jwt.claims', '{\"sub\":\"$ADMIN6\",\"role\":\"authenticated\"}', true)" \
  -c "select array_length(public.exchange_record($EO_BILL, null, jsonb_build_array(jsonb_build_object('bill_item_id', $EO_BI, 'quantity', 1, 'credit_amount', 1000, 'reason', 'conc', 'product_name', 'Conc six', 'product_code', 'CONC6'))), 1)" \
  -c "select pg_sleep(1.5)" -c "commit" > "$OUT/eo_a" 2> "$OUT/eo_a_err" &
PID_EO=$!
sleep 0.5
# B: online return of the same unit: must wait for A's order lock, then find nothing returnable
set +e
START=$(date +%s)
"${PSQL[@]}" -c "select public.online_return_open('$EO_ORDER', null, false, 'change_of_mind', now(), jsonb_build_array(jsonb_build_object('item_id', '$EO_ITEM', 'units', 1)), 'conc', null, null)" \
  > "$OUT/eo_b" 2> "$OUT/eo_b_err"
EO_B_RC=$?
EO_WAITED=$(( $(date +%s) - START ))
set -e
wait "$PID_EO" || true
"${PSQL[@]}" > "$OUT/eo_check" <<SQL
select (select count(*) from public.exchanges where original_bill_item_id = $EO_BI) || ' '
    || (select count(*) from public.order_returns where order_id = '$EO_ORDER') || ' '
    || (select stock from public.productsizecolors where variantid = '$V6');
SQL
read -r EO_EX EO_RET EO_STOCK < "$OUT/eo_check"
cleanup_exch_open
echo "exchange vs return open: A=$(tr '\n' ' ' < "$OUT/eo_a") A_err=$(tr '\n' ' ' < "$OUT/eo_a_err") B_rc=$EO_B_RC waitedB=${EO_WAITED}s exchanges=$EO_EX returns=$EO_RET stock=$EO_STOCK B_err=$(tr '\n' ' ' < "$OUT/eo_b_err")"
grep -qx '1' "$OUT/eo_a" || { echo "FAIL: A's exchange should record one row"; fail=1; }
[ "$EO_B_RC" != "0" ] || { echo "FAIL: return open after the exchange should be refused"; fail=1; }
grep -q 'returnable' "$OUT/eo_b_err" || { echo "FAIL: B should fail on returnable units"; fail=1; }
[ "$EO_EX" = "1" ] && [ "$EO_RET" = "0" ] || { echo "FAIL: exactly one of exchange/return should exist"; fail=1; }
[ "$EO_STOCK" = "5.000" ] || { echo "FAIL: stock should be 5 - 1 sold + 1 exchanged back = 5"; fail=1; }
[ "$EO_WAITED" -ge 1 ] || { echo "FAIL: B did not wait for A's order lock"; fail=1; }

# ---- bill_save: a failure at the last step undoes everything (matrix row 5) ----
# Local only: it adds a trigger to a live-shared table inside the transaction.
BS_V=77777777-7777-4777-8777-777777777777
BS_NOTE='Concurrency BillSave'
bs_payload() { # variant
  echo "{\"bill\":{\"notes\":\"$BS_NOTE\",\"paymentstatus\":\"finalized\",\"finalized\":true},\"items\":[{\"quantity\":1,\"mrp\":1,\"subtotal\":1,\"gst_amount\":0,\"total\":1,\"variantid\":\"$1\"}]}"
}
bs_key() { printf 'cccc0000-0000-4000-8000-%012d' "$1"; }
cleanup_bill_save() {
  "${PSQL[@]}" > /dev/null <<SQL
delete from public.bill_stock_moves where idempotency_key::text like 'cccc0000-%';
delete from public.bill_save_log where idempotency_key::text like 'cccc0000-%';
$BILLS_DELETE_ANY
delete from public.bills where notes = '$BS_NOTE';
$BILLS_DELETE_DRAFTS
delete from public.productsizecolors where variantid = '$BS_V';
delete from public.products where productid = 'CONCBS';
SQL
}
cleanup_bill_save
"${PSQL[@]}" > "$OUT/bs_row5" <<SQL
begin;
create function pg_temp.boom() returns trigger language plpgsql as \$f\$
begin raise exception 'injected failure'; end \$f\$;
insert into public.customers (customerid, customer_ulid, first_name, store_credit)
  values (-9101, 'CONCBILLSAVE00000000000001', 'Fixture', 500);
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONCBS', 'Conc bill', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONCBS', 'M', 'Red', 5, '$BS_V');
insert into public.vouchers (voucher_id, customerid, expiry_date, value) values ('CONCBS-V', -9101, current_date + 30, 100);
create temp table bs_before as select
  (select count(*) from public.bills where notes = '$BS_NOTE') as bills,
  (select stock from public.productsizecolors where variantid = '$BS_V') as stock,
  (select store_credit from public.customers where customerid = -9101) as credit,
  (select redeemed from public.vouchers where voucher_id = 'CONCBS-V') as redeemed,
  (select jsonb_object_agg(financial_year || document_type, last_value) from public.bill_sequences) as counters,
  (select count(*) from public.bill_save_log) as log;
create trigger bs_boom before insert on public.store_credit_ledger for each row execute function pg_temp.boom();
do \$\$
declare
  pl jsonb := jsonb_set('$(bs_payload "$BS_V")'::jsonb, '{bill}',
    '$(bs_payload "$BS_V")'::jsonb -> 'bill' || '{"customerid": -9101, "store_credit_used": 100}')
    || '{"voucher_id": "CONCBS-V"}';
  got text;
  r jsonb;
begin
  begin
    perform public.bill_save('$(bs_key 5)', 'finalize_create', pl);
    got := 'saved';
  exception when others then
    got := sqlerrm;
  end;
  if got <> 'injected failure' then raise exception 'row5: expected the injected failure, got %', got; end if;
  if not exists (select 1 from bs_before b where
       b.bills = (select count(*) from public.bills where notes = '$BS_NOTE')
       and b.stock = (select stock from public.productsizecolors where variantid = '$BS_V')
       and b.credit = (select store_credit from public.customers where customerid = -9101)
       and b.redeemed = (select redeemed from public.vouchers where voucher_id = 'CONCBS-V')
       and b.counters = (select jsonb_object_agg(financial_year || document_type, last_value) from public.bill_sequences)
       and b.log = (select count(*) from public.bill_save_log)) then
    raise exception 'row5: the failed save left something behind';
  end if;
  drop trigger bs_boom on public.store_credit_ledger;
  r := public.bill_save('$(bs_key 5)', 'finalize_create', pl);
  if (r ->> 'replayed')::boolean then raise exception 'row5: the retry should do the work'; end if;
  if (select count(*) from public.bills where notes = '$BS_NOTE') <> 1 then raise exception 'row5: one bill expected'; end if;
  if (select stock from public.productsizecolors where variantid = '$BS_V') <> 4 then raise exception 'row5: one stock move expected'; end if;
  if (select store_credit from public.customers where customerid = -9101) <> 400 then raise exception 'row5: one credit move expected'; end if;
  if (select count(*) from public.store_credit_ledger where customerid = -9101) <> 1 then raise exception 'row5: one ledger row expected'; end if;
end \$\$;
select 'row5 ok';
rollback;
SQL
grep -qx 'row5 ok' "$OUT/bs_row5" || { echo "FAIL: bill_save row 5"; fail=1; }
echo "bill_save row 5: $(tr '\n' ' ' < "$OUT/bs_row5")"

# ---- bill_save: same key from two sessions. The second waits, then replays. One bill. ----
bs_fixture() { # stock
  cleanup_bill_save
  "${PSQL[@]}" > /dev/null <<SQL
insert into public.products (productid, name, purchaseprice, retailprice) values ('CONCBS', 'Conc bill', 500, 1000);
insert into public.productsizecolors (productid, size, color, stock, variantid) values ('CONCBS', 'M', 'Red', $1, '$BS_V');
SQL
}
bs_call() { # key
  echo "select public.bill_save('$(bs_key "$1")', 'finalize_create', '$(bs_payload "$BS_V")')"
}
bs_fixture 5
"${PSQL[@]}" -c "begin" -c "$(bs_call 1)" -c "select pg_sleep(2)" -c "commit" > "$OUT/bs_a" &
PID_BS=$!
sleep 0.5
START=$(date +%s)
"${PSQL[@]}" -c "$(bs_call 1)" > "$OUT/bs_b"
BS_WAITED=$(( $(date +%s) - START ))
wait "$PID_BS"
BS_CHECK="$("${PSQL[@]}" -c "select (select count(*) from public.bills where notes = '$BS_NOTE') || ' ' || (select stock from public.productsizecolors where variantid = '$BS_V')")"
read -r BS_BILLS BS_STOCK <<< "$BS_CHECK"
echo "bill_save same key: bills=$BS_BILLS stock=$BS_STOCK waitedB=${BS_WAITED}s"
[ "$BS_BILLS" = "1" ] || { echo "FAIL: same key must make one bill"; fail=1; }
[ "$BS_STOCK" = "4.000" ] || { echo "FAIL: same key must move stock once"; fail=1; }
grep -q '"replayed": false' "$OUT/bs_a" || { echo "FAIL: first session should do the work"; fail=1; }
grep -q '"replayed": true' "$OUT/bs_b" || { echo "FAIL: second session should replay"; fail=1; }
[ "$BS_WAITED" -ge 1 ] || { echo "FAIL: second session did not wait"; fail=1; }

# ---- bill_save: same key, and the first session rolls back. The second does the work. ----
bs_fixture 5
"${PSQL[@]}" -c "begin" -c "$(bs_call 2)" -c "select pg_sleep(1.5)" -c "rollback" > /dev/null &
PID_BS=$!
sleep 0.5
"${PSQL[@]}" -c "$(bs_call 2)" > "$OUT/bs_b"
wait "$PID_BS"
BS_CHECK="$("${PSQL[@]}" -c "select (select count(*) from public.bills where notes = '$BS_NOTE') || ' ' || (select stock from public.productsizecolors where variantid = '$BS_V')")"
read -r BS_BILLS BS_STOCK <<< "$BS_CHECK"
echo "bill_save same key after rollback: bills=$BS_BILLS stock=$BS_STOCK"
[ "$BS_BILLS" = "1" ] && [ "$BS_STOCK" = "4.000" ] || { echo "FAIL: after a rollback the waiting session must save once"; fail=1; }
grep -q '"replayed": false' "$OUT/bs_b" || { echo "FAIL: after a rollback the waiting session should do the work"; fail=1; }

# ---- bill_save: two bills on the last unit. Both succeed, stock is -1, flagged. ----
bs_fixture 1
"${PSQL[@]}" -c "begin" -c "$(bs_call 3)" -c "select pg_sleep(1.5)" -c "commit" > "$OUT/bs_a" &
PID_BS=$!
sleep 0.5
"${PSQL[@]}" -c "$(bs_call 4)" > "$OUT/bs_b"
wait "$PID_BS"
BS_CHECK="$("${PSQL[@]}" -c "select (select count(*) from public.bills where notes = '$BS_NOTE') || ' ' || (select stock from public.productsizecolors where variantid = '$BS_V') || ' ' || (select count(*) from public.bill_stock_moves where variantid = '$BS_V')")"
read -r BS_BILLS BS_STOCK BS_MOVES <<< "$BS_CHECK"
echo "bill_save last unit: bills=$BS_BILLS stock=$BS_STOCK moves=$BS_MOVES"
[ "$BS_BILLS" = "2" ] || { echo "FAIL: both bills on the last unit must save"; fail=1; }
[ "$BS_STOCK" = "-1.000" ] || { echo "FAIL: stock should reach -1"; fail=1; }
[ "$BS_MOVES" = "2" ] || { echo "FAIL: two stock moves expected"; fail=1; }
grep -q '"negative_stock": \[\]' "$OUT/bs_a" || { echo "FAIL: first bill should flag nothing"; fail=1; }
grep -q "\"negative_stock\": \[{\"stock\": -1.000, \"variantid\": \"$BS_V\"}\]" "$OUT/bs_b" || { echo "FAIL: second bill should flag the variant"; fail=1; }

# ---- bill_save holds the variant and waits for the bill counter, while another session holds the
# counter and then adds a bill line for that variant, as online_order_create_bos does. The line's
# foreign key lock must not conflict with the variant lock, or the two deadlock. ----
bs_fixture 5
set +e
"${PSQL[@]}" -c "begin" \
  -c "create temp table bs_counter on commit drop as with b as (insert into public.bills (notes, paymentstatus, finalized) values ('$BS_NOTE', 'finalized', true) returning billid) select billid from b" \
  -c "select pg_sleep(1.5)" \
  -c "insert into public.bill_items (billid, quantity, mrp, variantid, subtotal, gst_amount, total) select billid, 1, 1, '$BS_V', 1, 0, 1 from bs_counter" \
  -c "commit" > /dev/null 2> "$OUT/bs_a_err" &
PID_BS=$!
sleep 0.5
"${PSQL[@]}" -c "$(bs_call 6)" > "$OUT/bs_b" 2> "$OUT/bs_b_err"
BS_B_RC=$?
wait "$PID_BS"
BS_A_RC=$?
set -e
BS_CHECK="$("${PSQL[@]}" -c "select (select count(*) from public.bills where notes = '$BS_NOTE') || ' ' || (select count(distinct bill_number) from public.bills where notes = '$BS_NOTE')")"
read -r BS_BILLS BS_NUMBERS <<< "$BS_CHECK"
echo "bill_save vs counter holder: A_rc=$BS_A_RC B_rc=$BS_B_RC bills=$BS_BILLS numbers=$BS_NUMBERS"
[ "$BS_A_RC" = "0" ] && [ "$BS_B_RC" = "0" ] || { echo "FAIL: no deadlock expected: $(cat "$OUT/bs_a_err" "$OUT/bs_b_err")"; fail=1; }
[ "$BS_BILLS" = "2" ] && [ "$BS_NUMBERS" = "2" ] || { echo "FAIL: two bills with distinct numbers expected"; fail=1; }
cleanup_bill_save

# ---- voucher_redeem while bill_cancel holds the same bill: the redeem waits, then sees the bill
# cancelled and is refused, so the voucher is never spent on a cancelled bill. Needs
# schema/migration_bill_cancel.sql and schema/migration_voucher_states.sql. ----
if [ "$("${PSQL[@]}" -c "select to_regprocedure('public.voucher_release(text,int)') is not null")" = "t" ]; then
  VC_CANCEL="select public.bill_cancel('cccc0000-0000-4000-8000-0000000000c1', -9201, 'return_payment',
    '{\"expect\": {\"finalized\": true, \"paymentstatus\": \"finalized\"}, \"restore_older_stock\": true}')"
  vc_cleanup() {
    "${PSQL[@]}" > /dev/null <<SQL
delete from public.vouchers where voucher_id = 'CONCVC-V';
delete from public.bill_save_log where idempotency_key = 'cccc0000-0000-4000-8000-0000000000c1';
$BILLS_DELETE_ANY
delete from public.bills where billid = -9201;
$BILLS_DELETE_DRAFTS
delete from public.customers where customerid = -9201;
SQL
  }
  vc_cleanup
  "${PSQL[@]}" > /dev/null <<SQL
insert into public.customers (customerid, customer_ulid, first_name) values (-9201, 'CONCVOUCHER000000000000001', 'Fixture');
insert into public.bills (billid, customerid, notes, paymentstatus, finalized) values (-9201, -9201, 'Concurrency voucher', 'finalized', true);
insert into public.vouchers (voucher_id, customerid, expiry_date, value) values ('CONCVC-V', -9201, current_date + 30, 100);
SQL
  set +e
  "${PSQL[@]}" -c "begin" -c "$VC_CANCEL" -c "select pg_sleep(1.5)" -c "commit" > /dev/null 2> "$OUT/vc_a_err" &
  PID_VC=$!
  sleep 0.5
  START=$(date +%s)
  "${PSQL[@]}" -c "select public.voucher_redeem('CONCVC-V', -9201)" > /dev/null 2> "$OUT/vc_b_err"
  VC_B_RC=$?
  VC_WAITED=$(( $(date +%s) - START ))
  wait "$PID_VC"
  VC_A_RC=$?
  set -e
  VC_STATE="$("${PSQL[@]}" -c "select (select public.voucher_state(v) from public.vouchers v where voucher_id = 'CONCVC-V') || ' ' || (select paymentstatus from public.bills where billid = -9201)")"
  echo "voucher_redeem vs bill_cancel: A_rc=$VC_A_RC B_rc=$VC_B_RC waitedB=${VC_WAITED}s state=$VC_STATE"
  [ "$VC_A_RC" = "0" ] || { echo "FAIL: bill_cancel should succeed: $(cat "$OUT/vc_a_err")"; fail=1; }
  [ "$VC_B_RC" != "0" ] && grep -q VOUCHER_BAD_TRANSITION "$OUT/vc_b_err" || { echo "FAIL: redeem on the cancelled bill must be refused"; fail=1; }
  [ "$VC_STATE" = "available cancelled" ] || { echo "FAIL: voucher must stay available, bill cancelled"; fail=1; }
  vc_cleanup
else
  echo "voucher_redeem vs bill_cancel: skipped (schema/migration_voucher_states.sql not applied)"
fi
# ---- bill_edit vs bill_add_payment on one part-paid bill (net 1000, 600 paid). A takes the last
# 400 and holds its transaction; B saves an edit down to 400 from a screen opened before, choosing
# store credit for 200. B must wait for A's bill lock, then see the payment and refuse: crediting
# 200 on top of the 1000 now held would hand back money that was never over. ----
cleanup_bill_edit() {
  "${PSQL[@]}" > /dev/null <<SQL
delete from public.store_credit_ledger where customerid = -9701;
SQL
  cleanup_bill_save
  "${PSQL[@]}" > /dev/null <<SQL
delete from public.customers where customerid = -9701;
delete from public.salesmethods where salesmethodid = -9701;
SQL
}
bs_fixture 5
"${PSQL[@]}" > /dev/null <<SQL
insert into public.customers (customerid, customer_ulid, first_name, store_credit) values (-9701, 'CONCEDITFIXTURE00000000001', 'Conc', 0);
insert into public.salesmethods (salesmethodid, methodname) values (-9701, 'Conc cash');
SQL
BE_BILL="$("${PSQL[@]}" -c "select public.bill_save('$(bs_key 7)', 'partial_create', '{\"bill\":{\"customerid\":-9701,\"notes\":\"$BS_NOTE\",\"paymentstatus\":\"partial\",\"finalized\":true,\"net_amount\":1000,\"payment_amount\":600,\"salesmethodid\":-9701},\"items\":[{\"quantity\":1,\"mrp\":1000,\"subtotal\":1000,\"gst_amount\":0,\"total\":1000,\"variantid\":\"$BS_V\"}],\"first_payment\":{\"amount\":600,\"salesmethodid\":-9701}}') ->> 'billid'")"
BE_PAYLOAD="{\"expect\":{\"paymentstatus\":\"partial\",\"payment_amount\":600},\"bill\":{\"customerid\":-9701,\"notes\":\"$BS_NOTE\",\"totalamount\":400,\"gst_total\":0,\"discount_total\":0,\"taxable_total\":400,\"net_amount\":400,\"applied_codes\":[],\"payment_amount\":600,\"final_amount\":null,\"saleslocationid\":null,\"salesmethodid\":-9701,\"paymentstatus\":\"finalized\",\"finalized\":true,\"store_credit_used\":0,\"orderdate\":\"2026-11-12T00:00:00+05:30\"},\"excess\":{\"mode\":\"store_credit\",\"amount\":200}}"
"${PSQL[@]}" -c "begin" -c "select public.bill_add_payment('$(bs_key 8)', $BE_BILL, 400, -9701, null)" -c "select pg_sleep(1.5)" -c "commit" > /dev/null &
PID_BE=$!
sleep 0.5
set +e
START=$(date +%s)
"${PSQL[@]}" -c "select public.bill_edit('$(bs_key 9)', $BE_BILL, '$BE_PAYLOAD')" > /dev/null 2> "$OUT/be_b_err"
BE_B_RC=$?
BE_WAITED=$(( $(date +%s) - START ))
set -e
wait "$PID_BE"
BE_CHECK="$("${PSQL[@]}" -c "select (select sum(amount) from public.bill_payments where billid = $BE_BILL) || ' ' || (select round(store_credit::numeric, 2) from public.customers where customerid = -9701) || ' ' || (select paymentstatus from public.bills where billid = $BE_BILL)")"
read -r BE_HELD BE_CREDIT BE_STATUS <<< "$BE_CHECK"
cleanup_bill_edit
echo "bill_edit vs payment: B_rc=$BE_B_RC waitedB=${BE_WAITED}s held=$BE_HELD credit=$BE_CREDIT status=$BE_STATUS B_err=$(tr '\n' ' ' < "$OUT/be_b_err")"
[ "$BE_B_RC" != "0" ] && grep -q 'BILL_STALE' "$OUT/be_b_err" || { echo "FAIL: the edit from before the payment should be refused as stale"; fail=1; }
[ "$BE_HELD" = "1000.00" ] && [ "$BE_CREDIT" = "0.00" ] && [ "$BE_STATUS" = "finalized" ] || { echo "FAIL: bill should hold 1000 with no credit given"; fail=1; }
[ "$BE_WAITED" -ge 1 ] || { echo "FAIL: the edit did not wait for the payment's bill lock"; fail=1; }

[ "$fail" = 0 ] && echo "concurrency: all checks passed"
exit "$fail"
