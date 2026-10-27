#!/usr/bin/env bash
# Two-session concurrency test for the online order functions (plan review focus #4, R1).
# Needs the throwaway DB from scripts/test-db.sh with all online-order migrations applied (through _rebook):
#   scripts/test-db.sh up
#   scripts/test-db.sh sql <the migrations listed in schema/test_online_orders_rebook.sql>
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

# ---- _online_bill_offset: two sessions, same refund -> exactly items + 1 shipping rows ----
V3=33333333-3333-4333-8333-333333333333
"${PSQL[@]}" > "$OUT/offset_refund" <<SQL
delete from public.exchanges where order_refund_id in (select r.id from public.order_refunds r join public.orders o on o.id = r.order_id where o.contact_name = 'Concurrency Offset');
create temp table offset_bills as select bill_id from public.orders where contact_name = 'Concurrency Offset' and bill_id is not null;
delete from public.orders where contact_name = 'Concurrency Offset';
delete from public.bills where billid in (select bill_id from offset_bills);
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
delete from public.bills where billid in (select bill_id from offset_bills);
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
delete from public.bills where billid in (select bill_id from ret_bills);
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
delete from public.bills where billid in (select bill_id from ex_bills);
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
delete from public.bills where billid in (select bill_id from eo_bills);
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

[ "$fail" = 0 ] && echo "concurrency: all checks passed"
exit "$fail"
