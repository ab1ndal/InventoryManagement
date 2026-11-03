# Fulfilment options: out-of-state orders, store pickup, Porter, shipping quote fixes

Status 2026-10-30: plan APPROVED. Shipped: PR A #101, PR B #102, PR C #103, PR D #104, PR F #105. PR E #106 OPEN, NOT on production: needs migrate + deploy (auto-mode blocked it 2026-10-30), then merge. Then PR G.

## Owner decisions (2026-10-29)
- Site copy keeps saying "we ship within UP", but checkout **never hard-blocks** an out-of-UP address. The owner
  decides fulfilment for those orders in admin. Owner was told about the GST composition s.10(2)(c) risk.
- Customer chooses **Ship to me** or **Pick up at the shop** at checkout.
- **Porter** = an admin-only fulfilment choice, booked by hand in the Porter app; admin marks dispatched/delivered.
- Shipping line shows **"Calculating…"** while the rate is loading, never a stand-in number that changes later.
- **Multiple items stack on weight** for the shipping rate.

## Facts from research (what is true today)
- UP rule is a hard block in four layers: zod schema (`src/storefront/lib/checkout.js:53-76`), LiveCheckout
  `canPay` (`LiveCheckout.jsx:201-208`), edge `create-order` (`handler.ts:234-244`, via `_shared/pincode.ts`
  `checkUpPincode`), and SQL `online_order_create` (`schema/migration_online_orders_r7.sql:64`).
- Outside pincode prefixes 20–28 the quote never asks Shiprocket for a rate; fallback slabs
  (`_shared/shipping.ts:103-114`) are calibrated on UP only.
- SQL rejects ₹0 shipping below ₹5,000 (`r7.sql:140-146`); pickup needs that relaxed.
- Fulfilment is Shiprocket-only: every paid order queues `shiprocket_create`; `mark_packed` needs AWB + label;
  only courier tracking moves packed → shipped; `mark_delivered` is superadmin-only and refuses `packed`;
  `email_shipped` throws without an AWB. Returns/exchanges need `delivered` + `delivered_at`.
- No fulfilment / pickup column exists anywhere today.
- Weight **already stacks**, but lightly: parcel = heaviest unit + 0.5 kg per extra unit, capped at 5 kg, and one
  package size regardless of count (`shipping.ts:73-91`). E.g. 3 lehengas = 3 kg, not 6 kg.
- "To pay" includes the fallback shipping while the Shipping line says "Enter your pincode"; during a re-quote
  the old number stays on screen (`CheckoutSummary.jsx:14-18`, `LiveCheckout.jsx:106-141`).

## Spec

### 1. Shipping quote display (frontend only)
- While a quote is in flight, Shipping and To pay show "Calculating…"; Pay disabled.
- No pincode yet: Shipping "Enter your pincode", To pay shows the subtotal labelled "+ shipping" (no hidden fee).

### 2. Weight stacking
- Parcel weight = sum of unit weights (no 0.5 kg discount per extra unit); package grows with count
  (bag → box; 2+ heavy units → large box). Cap raised from 5 kg to 10 kg; above that, fallback top slab.
  Owner confirmed full sum 2026-10-30.

### 3. Any Indian address
- Remove the UP hard blocks in all four layers. State dropdown keeps all states.
- Out-of-UP address: soft note under the address — "We usually deliver within Uttar Pradesh. We'll confirm
  delivery for your address on WhatsApp before dispatch." (owner to approve wording).
- Quote asks Shiprocket for a rate for every valid 6-digit pincode. If no rate comes back for an out-of-UP
  pincode, use a national fallback table (calibrated from a Shiprocket API sample of ~10 cities across India,
  same "never undercharge" rule as the UP slabs).
- Orders store `address.state`; admin list flags out-of-UP orders with a badge so they're never processed blind.

### 4. Store pickup
- Checkout radio: **Ship to me** / **Pick up at the shop** (shop address + "Ready in 1–2 days, we'll message you").
- Pickup: shipping ₹0, address fields hidden (name + phone required, email optional), pays online as now.
- New column `orders.fulfilment` ('ship' | 'pickup'), set at create.
- Pickup flow: paid → (shelf check) → **Ready for pickup** (new status `ready_for_pickup`; creates the Bill of
  Supply; emails customer) → **Collected** (→ `delivered`, sets `delivered_at`, so returns/exchanges work).
- No `shiprocket_create` job for pickup orders.
- Customer order page: timeline Paid → Ready for pickup → Collected.

### 5. Porter (admin only)
- Process dialog on a ship order gets a choice: **Shiprocket** (existing flow) or **Porter (manual)**.
- Porter: admin books in the Porter app, optionally pastes the Porter tracking link, clicks **Dispatched** →
  status `shipped`, `orders.courier = 'porter'`, Bill of Supply created, shipped email (with link if given,
  without AWB). Then **Mark delivered** (any admin for Porter orders) → `delivered` + `delivered_at`.
- New column `orders.courier` ('shiprocket' | 'porter').

### Out of scope (v1)
- Converting a paid ship order to pickup with a shipping refund (admin can cancel + refund as today).
- Porter API booking; customer-facing same-day option; SMS/WhatsApp notifications (separate task).
- Changing site UP copy (stays as is).

## Plan (one PR per slice, each shippable alone)
**PR A — quote display + weight** (no DB change)
1. `CheckoutSummary.jsx` / `LiveCheckout.jsx`: Calculating… state, To pay without hidden shipping; tests.
2. `_shared/shipping.ts`: summed weight, package by count, cap; update `shipping_test.ts`, `quote_test.ts`.
3. Deploy `checkout-quote`, `create-order`; merge.

**PR B — any Indian address**
1. Migration `schema/migration_online_fulfilment_open_state.sql`: redefine `online_order_create` without the
   pincode-prefix raise (keep 6-digit check). Update `schema/test_online_orders.sql` (110001 now accepted).
2. `_shared/pincode.ts`: report `in_up` instead of blocking; rate lookup for all pincodes; national fallback table
   (calibrate with Shiprocket API — owner runs the login curl for a token).
3. `create-order`: drop `not_up` / `unverifiable` 422s. Frontend: remove refine/regex block, soft note, tests.
4. Admin list/detail: "Outside UP" badge.
5. Migrate → deploy functions → merge.

**PR C — store pickup**
1. Migration: `orders.fulfilment`, status check + `ready_for_pickup`, `online_order_create` accepts pickup (₹0
   shipping, minimal address), `confirm_payment` skips `shiprocket_create` for pickup, new RPCs
   `online_order_mark_ready` (creates BOS) and `online_order_mark_collected`; SQL tests.
2. Edge: quote/create-order pickup path; `admin-order-action` actions `mark_ready`, `mark_collected`; emails
   `email_ready_for_pickup`; tests.
3. Frontend checkout radio + hidden address; order page/timeline pickup steps; admin buttons + tab; tests.
4. Migrate → deploy → merge.

**PR D — Porter**
1. Migration: `orders.courier`, RPC `online_order_dispatch_manual` (processing/paid → shipped, BOS),
   `mark_delivered` allowed for any admin when courier = porter; SQL tests.
2. Edge: `admin-order-action` `dispatch_manual`; `email_shipped` works without AWB (optional link); tests.
3. Admin Process dialog courier choice + Porter link field; customer order page shows Porter link; tests.
4. Migrate → deploy → merge.

## Manual delivery stages (owner decision 2026-11-02; supersedes §5 Porter dispatch)
Branch `feat/manual-delivery-stages`. Porter and self-delivery have no tracker in another app: customers follow the
status staff set in admin, on `/track` (order number + phone, phone check kept: refs are sequential) or the order page.
No tracking link. No WhatsApp button.

Customer timeline for every ship order, whichever courier (owner 2026-11-02):
Order placed → Processed → Packed → Picked up → Out for delivery → Delivered.
Shiprocket orders show the same steps plus a link to Shiprocket's own tracking page for its detailed steps; the link
appears once an AWB exists. For Shiprocket: `processing` = Processed, `packed` = Packed, `shipped` = Picked up,
`rto`/`rto_received` stop at Picked up with the existing note. Store pickup timeline is unchanged.

| Status | Customer step | Staff action | Side effects |
|---|---|---|---|
| paid | Order placed | none | as today |
| processed (new) | Processed | shelf check, Process, choose Porter/Self | unavailable refunds, courier + courier_name set, Shiprocket order cancelled best effort; none available → cancelled |
| packed | Packed | Packed | none |
| shipped | Picked up | Picked up | shipped_qty, Bill of Supply, email_shipped (ref `manual`) |
| out_for_delivery | Out for delivery | Out for delivery | none |
| delivered | Delivered | Delivered (date dialog) | delivered_at, email_delivered |

Rules:
- A new `processed` status, not `processing`: `processing` means a Shiprocket op holds a lease and drives Send back.
- Forward only. A later step completes the earlier ones; a repeat is a no-op. No step goes back.
- Crossing into shipped (including by skipping) does the bill + shipped_qty + email exactly once.
- Bill at Picked up, so cancelling before the parcel leaves has no bill to reverse.
- Cancel allowed at paid, processed, packed. Not after Picked up (as Porter today).
- Any admin may advance a manual order. Rebook / send back never apply.
- Jumping straight to Delivered sends both emails (accepted, rare).
- `courier_name`: Porter = `Porter`, self = `Bindal's Creation`.
- Orders already `shipped` with courier `porter` keep working: they read as Picked up and can advance.

Left out: switching courier after Process (cancel + refund instead); dropping `online_order_dispatch_manual` and
`manual_tracking_url` (unused after this; remove in a later cleanup once prod is on the new functions).

Ship order: migrate → deploy `admin-order-action` + `run-jobs` → merge. Prod steps need owner OK.

## Online Orders screen cleanup (approved 2026-11-02)
Branch `feat/online-orders-queues`, stacked on `feat/manual-delivery-stages`. No DB change. Owner works at half-screen
(720-960px).
- Eight tabs become three queues with counts on the first two:
  - Needs action: failed jobs, problem, process_error, rto; `paid`; open returns; manual orders in
    processed/packed/shipped/out_for_delivery untouched for 2+ days (a forgotten Delivered blocks the return window).
  - In progress: processing, cancelling, processed, packed, ready_for_pickup, shipped, out_for_delivery.
  - Closed: delivered, cancelled, rto_received.
- Search by order number, phone or name across every status replaces All. Unpaid and expired show only through search.
- Rows are two lines and show the next step, not a stack of badges. One delivery label; badges only for exceptions.
- Order URL `/admin/online-orders/:id`. Below 1280px the order fills the page with a Back link; from 1280px list and
  order sit side by side.
- Order page: next action directly under the header. Items stay open; Money, Shipment, Refunds, Timeline collapse.
  A problem opens the section it concerns.
- Customer timeline: three-column grid so six steps never leave one alone on a row.

## Owner answers (2026-10-30)
1. Weight: **full sum per item** (3 lehengas = 6 kg).
2. Pickup: **always prepaid online**.
3. Out-of-UP note wording: still open (ask at PR B).

## Added by owner 2026-10-30 (run unattended; commit + merge when ready)
- **PR A also:** cart must never exceed stock. Today `addItem` adds blindly and the cart only clamps later on
  revalidate. Clamp at add time (PDP passes stock), tell the shopper "Only N in stock".
- **PR E — 15-minute hold:** adding to cart holds the units for 15 min (others see them as unavailable); hold
  expires automatically; also covers concurrent checkout. Design after research (anon identity, abuse caps).
- **PR F — Indian address format:** pincode first (fills city/state), Flat/House/Building, Area/Street/Locality,
  Landmark (optional), City, State. Landmark goes to Shiprocket.
- **PR G — sign-in prompt + phone-only path:** nudge sign-in for follow-ups/reminders; can a shopper go through
  with phone only? Needs owner decision on an OTP channel (SMS needs DLT registration; WhatsApp OTP needs Meta
  Cloud API) — research + recommendation, build what needs no new external account.

## PR E design — 15-minute cart hold (research 2026-10-30)
Facts: no stock is reserved today. `online_order_create` never touches stock; `online_order_confirm_payment`
takes stock "first paid wins" and refunds the loser (`stock_race`). Every shopper read (PDP, grid, cart
revalidate, quote) uses raw `productsizecolors.stock` (anon-readable). Guests have no server identity (cart in
localStorage `bc_cart`); anonymous sign-in is not used (and would give guests the `authenticated` role, which has
blanket UPDATE on attribute tables — avoid). pg_cron + run-jobs exist.

Design (defaults chosen while running unattended; owner can change):
- Table `stock_holds(id, variant_id, holder_key, qty, expires_at, order_id null, ip_hash)`; active = expires_at > now()
  (no sweeper needed for correctness; a daily purge for tidiness). holder_key = auth user id when signed in,
  else a random id kept in localStorage (`bc_holder`).
- Edge function `cart-hold` (service role): set/replace the holder's hold for a variant to the cart quantity,
  capped at stock − others' active holds; 15 min, renewed only when the qty changes, never past 30 min from the
  hold's start, then a 10-min cooldown (2026-10-30, after "clock restarts on reload"); cart lines are never removed
  by a hold, they show why they aren't reserved and checkout re-checks. Caps against hoarding: max 5 units
  per holder across all variants, max 10 active units per IP hash, at most 1 hold create per variant per holder per
  minute.
- Availability = stock − active holds by others. PDP (selected variant), cart revalidate and checkout quote use
  it via an anon RPC `variant_availability(variant_ids)`. PDP shows "In someone's cart — may free up in N min"
  when all units are held. Shop grid unchanged (still raw stock) to keep the change contained.
- Checkout: `online_order_create` attaches the holder's holds to the order and extends them to 45 min (Cashfree
  window 30 min + expiry sweep). `confirm_payment` takes at most stock − holds of others, so a non-holder can no
  longer pay for a held unit; `online_order_fail`/expiry releases the order's holds.
- In-store POS ignores holds (physical sale wins); the online holder then sees "no longer available" at checkout.
- Hold expiry shown in the cart: "Held for you for 14:32".

## PR G design — sign-in prompt, phone-only path, follow-ups (2026-10-30)
Facts: customer login = email magic link only. Guest checkout already works with phone alone (create-order finds or
creates a guest `customers` row by phone); guests track orders with order ref + phone (TrackOrderPage). No phone
OTP anywhere. No abandoned-cart concept; guest carts live only in localStorage.
G1 (build now, no new external account):
- Sign-in nudge for guests in the cart drawer, cart page and checkout: "Sign in to track orders and get your saved
  cart and address" → /login, returning to where they were. Never required; guest + phone checkout stays.
- Admin "Abandoned checkouts" list: unpaid orders (payment_failed / expired, last 30 days, not later paid by the same
  phone) with name, phone, items, total, and a WhatsApp button opening wa.me with a prefilled reminder; "followed up"
  mark so the owner doesn't message twice. This gives follow-ups from the phone number alone.
G2 (needs owner action — not built): phone OTP sign-in. Needs an SMS provider with India DLT registration (sender ID +
templates) or a WhatsApp Business API number for OTP. Owner to choose; then wire Supabase phone auth.
