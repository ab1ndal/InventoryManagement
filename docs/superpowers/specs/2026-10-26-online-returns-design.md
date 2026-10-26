# Online orders: returns after delivery (design, 2026-10-26)

Status: draft for owner approval. Ships **soon after** online checkout goes live (the first return is
at least a week after the first dispatch). Until then returns are handled by hand (Cashfree dashboard
refund or a voucher).
Builds on `docs/superpowers/specs/2026-10-23-online-orders-design.md` (refunds, legs, choice link).

## Why

The Returns policy promises a refund for damaged or wrong items, and the owner now also wants
"didn't like it" returns. Today no code path creates a refund after delivery: refunds only come from
a stock race, the shelf check, a cancel or an RTO. The shop needs to handle these returns from the admin,
with money only going out once the item is physically back.

## Owner decisions (2026-10-26)

- **Version 1 is WhatsApp + admin.** The customer asks on WhatsApp with photos; staff open the return in
  the admin. A customer "Request return" page is a future phase (below).
- Two reasons:
  - **Damaged or wrong item**, photos sent within **48 hours** of delivery → refund the **whole amount**,
    shipping included (see "Shipping" below).
  - **Didn't like it**, within **7 days** of delivery → refund the **product cost only**.
- **Item first, refund second.** The refund starts only after the item is received at the shop and
  checked.
- Return pickup for damaged/wrong: **shop pays**; staff book the reverse pickup by hand in the
  Shiprocket dashboard. For "didn't like it" the **customer pays** and sends it back or brings it in.
- No replacement shipment. The customer reorders, or exchanges in the shop the same day using the
  **existing in-store exchange** on the online order's bill (out of this feature).
- Same refund choice as today: email link, store credit or original payment, default original after
  48 hours. Any part paid by voucher or credit comes back as credit at once.
- Staff decide **per item** whether a returned unit goes **back to stock**.
- Outside the window: the admin warns; only a **superadmin** can still open the return, with a reason.
- **Any admin** opens returns and releases refunds.
- Damage **photos are uploaded to the order** in the admin (kept for courier claims).
- The Returns policy page and Terms change to the new rules **in the same release** as this feature.

## Goals

- Staff can open a return for some or all delivered units, with a reason, note and photos.
- When the parcel arrives, one action receives it, restocks the ticked units and creates the refund.
- Refund amounts follow the rules above and reuse the existing refund machinery (legs, choice link,
  sweeper, emails).
- The same unit can't be returned twice, and can't be both exchanged in store and returned online.

## Non-goals

- Customer self-service (future phase).
- Booking reverse pickups through the Shiprocket API.
- Replacement shipments.
- Returns for in-store bills (in-store exchange stays as it is) and for custom/made-to-order pieces
  (not online orders).

## Anti-goals

- Money leaves before the item is back at the shop.
- A unit refunded twice, or refunded online after it was exchanged in store (or the reverse).
- Shipping refunded on a "didn't like it" return.
- The site promising 7-day returns before the admin can process them.

## Data

- `orders.delivered_at timestamptz`: set by `online_order_apply_tracking` when status becomes
  `delivered` (first time only). Backfill from `order_events` kind `delivered`. Windows count from here.
- New `order_returns`: `id`, `order_id`, `reason` (`damaged_wrong` | `change_of_mind`), `status`
  (`open` | `refunded` | `cancelled`), `note`, `return_awb` (optional, typed by staff),
  `override_reason` (set when opened outside the window), `opened_by`, `opened_at`, `received_by`,
  `received_at`, `refund_id` (→ `order_refunds`), timestamps.
- New `order_return_items`: `return_id`, `item_id`, `units` (opened), `received_units` (set on receive,
  `0..units`: pieces that arrived **and passed the check**), `restock_units` (`0..received_units`).
- `order_returns.contacted_at timestamptz not null`: when the customer first raised it (WhatsApp/email
  time, entered by staff, defaults to now). Windows are checked against this, not against the time staff
  open the return. `order_returns.status` also allows `rejected` (nothing passed the check).
- New `order_return_photos`: `return_id`, `path`, `uploaded_by`, `uploaded_at`. Files in a **private**
  Storage bucket (e.g. `order-returns`), path `<order_id>/<return_id>/<uuid>.<ext>`, admins only
  (RLS + signed URLs for viewing). Images only, size cap (builder: e.g. 10 MB, jpeg/png/webp/heic).
- `order_refunds.reason` check gains `return`.
- RLS: admins read/write through RPCs; no anon or customer access in version 1.

## Behaviour

### Open a return (staff, after the WhatsApp conversation)

- Allowed on orders with status `delivered` (and `delivered_at` set).
- Staff pick items and units, the reason, a note (required), photos (required for damaged/wrong, at
  least one), and optionally the return AWB.
- **Returnable units per item** = `shipped_qty − units in other open returns − units received in
  earlier returns − units already exchanged in store against this item's bill line` (the `exchanges`
  rows on `bill_item_id`, excluding rows this feature wrote for the online refund itself). (`rto_qty` is
  always 0 on a delivered order, so it is left out.)
- **Window:** damaged/wrong 48 h, change of mind 7 days, from `delivered_at` to `contacted_at`. Outside
  it, a normal admin is blocked with the reason shown; a superadmin can continue after typing an
  override reason.
- Opening a return changes no money and no stock. The order stays `delivered`; the admin shows
  "Return open" on it.

### Cancel a return

- Any admin, while `open` (customer changed their mind, parcel never sent). Reason note required.

### Receive and refund (one action)

When the parcel is at the shop and checked:

1. Staff enter, per item, how many pieces **arrived and passed the check** (`received_units`) and how
   many of those go **back to stock** (`restock_units`), plus a note when anything failed (e.g. worn,
   tags removed, missing piece). Failed pieces get **no refund**; staff arrange on WhatsApp to send them
   back to the customer at the customer's cost (owner decision 2026-10-26). If nothing passed, the
   return becomes `rejected` with no refund.
2. One DB transaction (new SECURITY DEFINER RPC, e.g. `online_return_receive`):
   - re-check returnable units under a lock on the order: if a unit was exchanged in store while the
     return was open, the call fails with a clear message and staff reduce the received count;
   - `_stock_apply(variant, +restock_units)` per item;
   - create the refund for `received_units` with
     `_online_refund_create(order, 'return', units, include_shipping, actor)`:
     item value per unit from the existing proportional split (`_cum_alloc` over `credit_part` /
     `gateway_part`), so promo shares and voucher/credit parts are handled the same way as cancel and RTO;
   - write `exchanges` rows offsetting the Bill of Supply, exactly as `online_order_rto_received`
     does (reason `Return: damaged/wrong` or `Return: change of mind`, `new_billid = bill_id`), so the
     in-store exchange screen sees these units as already settled;
   - return `status → refunded`, `refund_id` set, event `return_refunded`.
3. The existing refund flow takes over: voucher/credit part completes at once; the gateway part waits
   for the customer's choice by email (default original after 48 h); the sweeper submits to Cashfree.

### Shipping

- **Damaged/wrong:** shipping is refunded when, after this return, **every shipped unit of the order
  has been received back** (whole order back). If only some items come back, item value only.
  This is the "partial damaged return refunds the item only" reading; owner to confirm (Open, below).
- **Change of mind:** never.
- The reverse-pickup cost the shop pays is not recorded in the app (Shiprocket wallet).

### Admin UI (`/admin/online-orders`, order detail)

- **Returns** section on delivered orders: list of returns with status, reason, units, photos.
- **Open return…** dialog: items × units (max = returnable), reason, note, photos, return AWB,
  window badge ("Day 2 of 7"), superadmin override field when outside.
- **Receive & refund…** dialog on an open return: restock count per item, refund amount preview
  (credit part, gateway part, shipping yes/no), confirm.
- **Cancel return** on open returns.
- All actions through `admin-order-action` (new actions `return_open`, `return_cancel`,
  `return_receive`) with the admin JWT; photo upload through Storage signed upload URLs issued by the
  same function.

### Customer-facing in version 1

- No new page. The existing refund email and choice page (`RefundChoicePage`) work unchanged
  (reason text for `return` added to the email and page).
- **Policy text** must match the new rules everywhere it appears:
  - `src/storefront/pages/policies/policyContent.js:34` Returns ("We do not accept returns, except…");
  - `:55` Damaged or wrong item: currently promises "We will send a replacement" → refund after the
    item is back (no replacement shipment; reorder or in-store exchange);
  - `:68` Exchanges ("within 7 days of purchase, in-store only"): add that for online orders the 7 days
    count from delivery;
  - `:172` Terms ("After dispatch, items cannot be returned, except…");
  - `src/storefront/components/home/TrustBar.jsx:13` ("Exchange within 7 days at our store"): keep, or
    reword to "7-day returns" (builder's wording call).
  New rules: damaged/wrong within 48 h with photos (full refund, return pickup by the shop); change of
  mind within 7 days of delivery (product cost refunded, customer pays return shipping, item unused with
  tags, failed pieces sent back at the customer's cost); how to start (WhatsApp/email); refund after the
  item reaches the shop and passes the check; custom pieces excluded. Update
  `src/storefront/__tests__/policyPages.test.jsx`.

### Delivery date and status

- `delivered_at` takes the courier's delivery timestamp from the webhook payload when present, else the
  time the webhook arrived.
- **Mark delivered (manual):** any admin can mark a `shipped` / `out_for_delivery` order delivered with a
  date, for when the courier webhook is missed (sets `delivered_at`, sends the existing delivered email).
- After a return is refunded the order **stays `delivered`**; the admin list and detail
  show a "Returned" / "Partly returned" badge derived from its returns. No new order status.
  The customer order page badge is **deferred** (review M5): customers have no return request flow yet,
  so it ships with the future customer "Request return" phase.

### In-store exchange of an online order

- The in-store exchange window for an **online** bill counts 7 days from the order's `delivered_at`
  instead of the bill date (the bill is created at packing, days before delivery). Small change in
  `ExchangePage` / `exchangeHelpers.isWithinExchangeWindow` for bills linked to an online order.

## Edge cases

- Return opened for an order whose BoS already had units exchanged in store: those units aren't
  returnable.
- A second return on the same order: allowed for remaining units; shipping refunded only once
  (`_online_refund_create` already skips shipping if a shipping leg exists).
- Two admins receive the same return at once: row lock; the second sees `refunded` and gets the existing
  refund id.
- Variant deleted: not possible, `order_items.variantid` references `productsizecolors` without cascade.
- Unit exchanged in store while its online return is open: receive re-checks and refuses (above).
- Customer who paid fully with voucher/credit: refund completes at once, no choice link (existing
  behaviour for credit-only refunds).

## Tests

- DB tests on the local harness: returnable-unit maths (incl. in-store exchanged and RTO units),
  windows and superadmin override, receive → stock + refund + exchanges rows, shipping only when the
  whole order is back for damaged/wrong and never for change of mind, double receive is idempotent.
- Deno tests for the new `admin-order-action` actions and photo upload URL issuing.
- In-store exchange screen: a unit returned online is not offered for exchange (existing returned-qty
  logic over `exchanges`; add a test).
- Live sandbox: deliver a test order (tracking webhook), open, receive, refund both choices.

## Future phase: customer self-service (recorded 2026-10-26, not in version 1)

Discussed and parked to get live sooner:
- **"Request return"** on the customer's order page (same access link/login as tracking), shown after
  delivery inside the window: pick items and units, reason, upload photos.
- Staff then **approve or reject** in the admin (adds `requested` and `rejected` states before `open`).
- Needs a public upload endpoint: rate limits, file type/size checks, abuse protection.
- Optional: book the reverse pickup through the Shiprocket return-order API and track it via the
  courier webhook instead of typing the return AWB.
- Revisit when returns reach roughly dozens a week or staff time on WhatsApp becomes the bottleneck.
- Automated WhatsApp (Business API) was rejected for now: Meta approval, templates, per-message fees;
  email already covers notifications.

## Left to the builder

- Exact RPC and action names, event payloads, UI layout.
- Photo size/type limits within the bounds above.

## Calls made by Claude (owner to check)

- Partial damaged return refunds item value only; shipping only when the whole order comes back.
- Change-of-mind condition in the policy: unused, tags attached, original packaging.
- Windows are measured to when the customer first contacted the shop (staff enter it), so a slow staff
  reply doesn't need a superadmin override.
- An open return doesn't block in-store exchange; receive re-checks and refuses if the unit was
  exchanged meanwhile.
- New admin "Mark delivered" for missed courier webhooks.
- Order stays "delivered" after a return, with a Returned / Partly returned badge.
- In-store exchange window for online bills counts from delivery, not from packing.

## Open (owner)

- None.

## Changes from the adversarial review (Codex, 2026-10-26)

These override anything above that conflicts.

1. **In-store exchange becomes one locked DB function.** `ExchangePage` today restocks, updates manual
   item stock and inserts `exchanges` rows as separate browser calls. A new `exchange_record` RPC does all
   three in one transaction, after locking the bill's online order row (if the bill is an online Bill of
   Supply) and the `bill_items` rows, and re-checking the cumulative returned quantity, online refund
   offsets included. `online_return_receive` takes the same locks in the same order (order, then bill
   items by id). This also makes today's in-store exchange atomic.
2. **Open locks the order** before computing returnable units, so two admins can't reserve the same unit.
3. **Photos are tied to a return by the server.** Upload URLs are issued for a `returnId` only: the
   server checks the return exists and is `open`, derives the order and builds the path. Viewing takes a
   `photoId` and signs only that stored path. No client-supplied paths.
4. **Mark delivered is superadmin only**, with a required reason; it can't move `delivered_at` once set,
   and the date can't be more than 30 days back. Stored in the event for audit.
5. **Refund preview comes from the database**: a read-only `online_return_preview(return, items)` using
   the same allocation and shipping rule as receive. Receive recomputes under the lock and the dialog
   shows the confirmed amounts returned by receive.
6. **Photos:** a damaged/wrong return can be opened first and photos added any time while it is `open`;
   at least one photo is required before it can be received. The UI keeps "Add photos" available until
   receipt.
7. **Exchange window code:** `ExchangePage.handleLoadBill` must look up the linked online order's
   `delivered_at` before the window check (today the check runs first, `src/admin/pages/ExchangePage.js:173-189`).
