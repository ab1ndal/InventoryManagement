# Online orders: un-stick and rebook (design, 2026-10-26)

Status: draft for owner approval. Ships **before** online checkout goes live.
Builds on `docs/superpowers/specs/2026-10-23-online-orders-design.md` (statuses, Process, checkpoints).

## Why

A courier problem is the shop's problem: the customer still gets the product at no extra cost. If the
product is no longer available, the customer is refunded. Today two cases have no way out in the admin:

1. **Stuck in `processing`.** Process failed part way (e.g. AWB not assigned, courier not serviceable).
   **Retry** resumes from the last checkpoint and fixes temporary errors, but when Retry can't succeed
   the order can't be cancelled (`online_order_claim` refuses `cancel` while `op_action = 'process'`)
   and can't go back to the shelf check (`process_plan` is locked). Found while listing tests
   (`tasks/todo.md` follow-up "ship builder gap 1").
2. **Courier cancelled or lost a shipment** already packed or on its way. Today the tracking webhook
   only sets the problem "Courier cancelled shipment — rebook or cancel"; there is no Rebook.

## Owner decisions (2026-10-26)

- Courier failure = shop failure: re-send at no extra cost; refund only if the item can't be sent.
- Include **Rebook** for packed/shipped orders the courier cancelled or lost.
- If an AWB was already assigned, **cancel it through the Shiprocket API**; if that fails, put a
  "cancel AWB … in Shiprocket dashboard" problem on the order.
- **Any admin** can use both actions (same as Process and Cancel today).

## Goals

- **G1 Send back to To-check:** an order in `processing` whose Process failed returns to `paid` (the
  To-check list). Staff redo the shelf check and press Process again, or Cancel as for any paid order.
- **G2 Rebook:** an order in `packed`, `shipped` or `out_for_delivery` goes back to To-check for a
  new shipment. Staff say whether the parcel is **still at the shop** or **lost**.
- Money and stock stay exact: no unit refunded twice, no unit taken from stock twice, one Bill of
  Supply per order.

## Non-goals

- Lost-parcel insurance or claims with the courier (stay manual in the Shiprocket dashboard).
- Changing the courier, address or items of the order.
- Anything after `delivered` (that is the returns feature,
  `2026-10-26-online-returns-design.md`).
- A customer-facing change. The customer only sees status emails that already exist.

## Anti-goals (would be a failure even if it works)

- A unit refunded at the first shelf check gets refunded again at the second.
- A second Bill of Supply for the same order.
- The old AWB's tracking updates moving the order after Rebook.
- A Shiprocket order left active after we abandoned it, with no problem note telling staff.

## Behaviour

### Item bookkeeping rule (applies to G1, G2 and Cancel)

`order_items.stock_taken` keeps meaning **units the shop currently holds for this order** (taken from
stock and not yet handed to a courier). Cancel (`online_order_cancel`, which puts back
`coalesce(available_qty, stock_taken)`) and `prepare_process` (`v_left = stock_taken - available_qty`)
then stay correct with no change to their maths and no change to the table check constraints
(`stock_taken between 0 and qty`, `available_qty between 0 and stock_taken`,
`schema/migration_online_orders.sql:287-288`). Both new actions therefore end by setting, per item:

- `stock_taken :=` units held now (see each action), `available_qty := null`, `shipped_qty := 0`.
- Units refunded earlier stay counted in `refunded_qty`; they are never in `stock_taken` again, so
  they are never offered at the shelf check, never put back by Cancel and never refunded twice.

### Shiprocket ids and cancelling

- **Cancelling the old shipment:** if an AWB exists, cancel it with Shiprocket's cancel-shipment-by-AWB
  call (`POST /orders/cancel/shipment/awbs`, new client method, e.g. `cancelAwbs`; **UNVERIFIED**, add to
  the Shiprocket API notes and fakes). Without an AWB, cancel the Shiprocket order with the existing
  `shiprocket.cancel`. On any failure set the problem
  `Cancel AWB <awb> / Shiprocket order <id> in Shiprocket dashboard` and continue. (`runCancel` keeps
  its current manual-AWB behaviour; switching it to the new call is a follow-up once the call is verified.)
- **New Shiprocket order id:** first attempt keeps the bare `order_ref` (no change for existing
  orders); later attempts use `<order_ref>-2`, `-3`, … from a new `orders.sr_attempt int not null default 1`
  incremented by send-back and rebook. `buildSrInput` uses the suffixed id for **both** create and
  `update/adhoc`.
- **Problem text:** a successful send-back or rebook clears `orders.problem` (e.g. the webhook's
  "Courier cancelled shipment — rebook or cancel"); a failed Shiprocket cancel overwrites it.

### G1 Send back to To-check (`processing` → `paid`)

Allowed when `status = 'processing'`, `op_action = 'process'` and the Process lease has expired
(`op_lease_until < now()`; `recordError` already expires it on failure). `process_error` alone is not
enough, because it stays set while a Retry with the same op key is running.

1. Cancel the old shipment as above.
2. In one DB transaction (new SECURITY DEFINER RPC, e.g. `online_order_send_back`):
   - clear `sr_order_id`, `sr_shipment_id`, `sr_updated_at`, `sr_sync_status`, `awb`, courier fields,
     `pickup_requested_at`, `manifest_url`, `label_url`, `process_plan`, `process_error`, `op_*`;
     `sr_attempt += 1`; clear `problem` unless step 1 just set it;
   - keep every refund already made at the first shelf check;
   - per item `stock_taken := coalesce(available_qty, stock_taken)` (units refunded as unavailable were
     never on the shelf), then `available_qty := null`, `shipped_qty := 0`;
   - status → `paid`, event `sent_back` with the old Shiprocket ids and AWB in its data.
3. A new Shiprocket order is created on the next Process (`ensureSrOrder` runs inline when
   `sr_order_id` is null).

### G2 Rebook (`packed` / `shipped` / `out_for_delivery` → `paid`)

Staff pick **Parcel still at shop** or **Parcel lost**.

1. Cancel the old shipment as above. For a parcel already moving the API may refuse; then flag the
   problem and continue.
2. DB transaction (new RPC, e.g. `online_order_rebook(order, actor, parcel_lost boolean, note)`):
   - same clearing as G1 (incl. `sr_attempt += 1`, problem rule), status → `paid`, event `rebooked`
     with old ids, AWB and `parcel_lost`;
   - keep `bill_id` (the Bill of Supply already issued stays the only bill);
   - **still at shop:** per item `stock_taken := shipped_qty` (the packed units are on hand), no stock
     change;
   - **lost:** the shipped units are gone. New column `order_items.lost_qty int not null default 0`
     `+= shipped_qty` (record of the write-off; stock was already reduced at payment). Replacement
     units are taken **now**, per item `n := least(shipped_qty, floor(stock))`, `_stock_apply(variant, -n)`,
     variants locked in a fixed order as in `online_order_confirm_payment`; `stock_taken := n`. Units
     that can't be replaced (`shipped_qty - n`) are refunded at once (see "Refunds after a bill exists");
   - then `available_qty := null`, `shipped_qty := 0` per item.
3. The old AWB stops matching: tracking updates look orders up by `awb`, which is now cleared. Keep
   the old AWB only in the event data. The unique constraint on `awb` stays valid.

### Shelf check after send-back or rebook

- No change to `set_availability` or `prepare_process` maths: thanks to the bookkeeping rule,
  `available_qty <= stock_taken` and `v_left = stock_taken - available_qty` refund only units newly
  found missing among those held.
- `online_order_create_bos` already returns early when `bill_id` is set
  (`schema/migration_online_orders.sql:1593`), so a re-pack keeps the one bill. The bill keeps its
  original quantities; any unit not re-sent is offset by `exchanges` rows (next section).

### Refunds after a bill exists (rebook orders only; G1 orders have no bill yet)

Applies to units refunded by the lost-parcel step, by the second shelf check, and by **Cancel** on a
rebooked order:

- Each refunded unit gets an `exchanges` row offsetting its bill line, as `online_order_rto_received`
  does (`new_billid = bill_id`, reason e.g. `Rebook: not re-sent` / `Cancel after rebook`). This logic
  is factored into one helper used by RTO, rebook, second shelf check and cancel.
- **Shipping:** if after the rebook nothing at all is sent (all units refunded), shipping is refunded
  too, as for a normal cancel (the customer got nothing), and the bill's Shipping line
  (`schema/migration_online_orders.sql:1625-1634`) is offset by an `exchanges` row as well. If at least
  one unit is re-sent, shipping stays charged and the shop pays the new courier.
- `online_order_cancel` gains this bill-aware branch when `bill_id` is set; for orders without a bill
  it is unchanged.

### Admin UI (`/admin/online-orders`)

- Order in `processing` with an error: buttons **Retry** (exists), **Send back to To-check** (new).
- Order in `packed` / `shipped` / `out_for_delivery`: **Rebook…** opens a dialog: parcel still at shop /
  lost, required note.
- Confirmation text says what will happen to the AWB and that refunds already made stand.
- Both go through `admin-order-action` (new actions `send_back`, `rebook`) with the admin JWT, like
  Process and Cancel.

### Emails

No new email. If the re-check refunds units, the existing refund email goes out. The second
shipment sends the existing "shipped" email with the new AWB.

## Edge cases

- Send back pressed twice / by two admins: second call sees `paid` and returns the current order.
- Rebook while a late tracking update for the old AWB arrives: no order matches the old AWB → ignored.
- Rebook of an order that was partly refunded at the first shelf check: those units stay refunded.
- Shiprocket cancel succeeds but the DB transaction fails: the order still holds the old ids;
  pressing again calls cancel again (Shiprocket cancel of a cancelled order must be treated as success
  or flagged, builder to confirm against the real API).
- A delivered order can't be rebooked (returns feature instead).

## Tests

- DB tests in `schema/test_online_orders_ship.sql` style on the local harness (`scripts/test-db.sh`):
  send-back clears state and keeps refunds; second shelf check refunds only new units; **Cancel after
  send-back puts back only held units**; lost-parcel rebook takes replacement stock and refunds what it
  can't replace; **Cancel after rebook (still at shop / lost) gives exact stock and offsets the bill incl.
  shipping**; one bill per order; old AWB ignored; second Shiprocket attempt uses `<ref>-2`.
- Deno tests for the `admin-order-action` actions with the existing fakes.
- Live, with Shiprocket set up: Process → fail on purpose → Send back → Process; pack → Rebook (still
  at shop).

## Left to the builder

- Exact RPC names and the event payloads.
- Whether `sr_attempt` lives on `orders` or is derived from events.
- UI layout of the dialog.

## Calls made by Claude (owner to check)

- Rebook with nothing re-sendable refunds shipping too (customer got nothing), like a cancel.
- Lost-parcel replacement stock is taken at Rebook time, not at the shelf check.
- Send back needs the Process lease expired, not just an error shown.
- First Shiprocket attempt keeps the bare order number; later ones get `-2`, `-3`.

## Open (owner)

- None.
