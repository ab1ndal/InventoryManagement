# Online Orders: Checkout, Payment, Fulfilment, Refunds, Credit — Design

**Date:** 2026-10-23
**Status:** Approved by owner in chat 2026-10-23 (every part played back and confirmed)
**Supersedes:** gateway/flow parts of `docs/superpowers/specs/2026-05-03-cart-checkout-design.md`
and Phases B/C of `tasks/checkout-shipping-plan.md`. Facts and API notes there remain useful.

## 1. Intent

Shoppers on bindalscreations.com can pay online and get their order delivered with as little
handwork at the shop as possible. Staff do only what can't be automated: check the shelf, pack,
hand over to the courier. Everything else (payment, stock, Shiprocket order, Bill of Supply,
refunds, store credit, tracking, customer messages) runs by itself.

Diwali is 8 Nov 2026. Slices are released as they finish. The **live switch stays off** until
the owner's Cashfree and Shiprocket accounts are active, so customers never see a half-built
payment step. Until then the existing WhatsApp checkout stays.

## 2. Hard constraints

- **Seller:** the shop, BINDAL'S CREATION, GST composition scheme. Delivery **within Uttar
  Pradesh only**. Every online sale gets a **Bill of Supply** (`bills.document_type = 'bos'`),
  never a tax invoice. No GST is added on top of any price.
- **Payments:** **Cashfree** (Payment Gateway, Orders API + JS checkout + webhooks). Prepaid
  only, no COD.
- **Courier:** **Shiprocket**, pickup location named `Shop` at 201001.
- **Email:** sent from **bindalscreations@gmail.com** over Gmail SMTP with an app password
  (owner's choice; no domain DNS work). Shop alerts go to the same inbox.
- **Prices:** `products.retailprice`, the same as in store.
- **Secrets** only in Supabase Edge Function secrets: `CASHFREE_CLIENT_ID`,
  `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV` (`sandbox`|`production`), `SHIPROCKET_API_EMAIL`,
  `SHIPROCKET_API_PASSWORD`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ALLOWED_ORIGIN`. Nothing
  secret in the React bundle. Never log tokens, passwords, or full card/UPI data.
- **Schema:** new migrations only (`schema/migration_*.sql`), additive. Fetch the live schema
  first (CLAUDE.md command). The same database serves the in-store billing app, so nothing it
  relies on may change behaviour.
- The storefront is a CRA React 19 SPA; server code is **Supabase Edge Functions (Deno)** in
  `supabase/functions/`, plus Postgres functions. No other backend.

## 3. Goals

1. Checkout: address (UP only, pincode verified), live shipping rate for the pincode,
   promo/voucher code box, store credit for
   signed-in customers, server-computed totals, Cashfree payment, confirmation page.
2. Payment confirmation is authoritative only from the server (webhook or server-side status
   check), idempotent, and takes stock atomically.
3. On payment: order created in Shiprocket (no courier yet), shop emailed, shopper emailed.
4. Admin **Online Orders** screen: per-item "available / not available", **Process** (books
   courier, label, Bill of Supply), **Cancel order**, retry for any failed sync, full timeline.
5. Item-level refunds for unavailable items, with the shopper choosing **instant store credit**
   or **refund to original method**; default to original method after 48 h.
6. Tracking updates flow back from Shiprocket automatically up to **Delivered**; shoppers can
   track by order (signed in: account page; guest: order ref + phone).
7. Store credit (registered customers, partial use) and one-time voucher codes (guests,
   leftover reissued) and website promo codes, all usable at checkout.
8. Emails at each step to the shopper; a "similar pieces" link when something is refunded.

## 4. Non-goals

COD. Delivery outside UP. Returns by courier. Customer self-cancel button (cancellation is by
WhatsApp/email, then staff click Cancel). Editing a paid order or swapping items inside it
(alternatives are a new order). Per-product weights. WhatsApp automation. Checkout timers or
stock holds. Abandoned-cart nudges. Multiple shipments per order.

## 5. Anti-goals (failure even if it "works")

- An order marked paid without money actually received, or money received with no order.
- Stock decremented twice (at payment and again at Bill of Supply), or never.
- A shopper charged more because items were unavailable (e.g. shipping re-added after refunds).
- In-store billing behaviour changing in any way.
- Shoppers seeing a payment step that can't complete (live switch off until accounts work).
- Any refund larger than what was paid for that item, or refunded twice.

## 6. The order journey (owner-approved)

1. **Checkout.** Shopper enters address; pincode must be UP (client prefix check 20–28, then
   server check via Shiprocket postcode API, which also rejects Uttarakhand pincodes that share
   the prefix). Shopper may enter one code (promo or voucher) and, if signed in, apply any part
   of their store credit. Totals always come from the server (`checkout-quote`).
2. **Pay.** `create-order` re-prices from the database, writes the order as
   `pending_payment`, creates the Cashfree order, returns the payment session. If credit or a
   voucher covers the whole amount, no Cashfree step: the order is confirmed directly.
3. **Paid.** Cashfree webhook (or the return page's server-side status check, whichever comes
   first) confirms. One database function, idempotent per order: marks `paid`, takes stock for
   each line **first paid wins**. A line whose stock is already gone is marked unavailable and
   refunded automatically, like a staff-marked one. Then: Shiprocket order created (no AWB),
   shop email, shopper email.
4. **Shelf check.** Staff open the order, tick each item available or not available.
5. **Process.** Unavailable lines are refunded (see §8). If at least one line remains: the
   Shiprocket order is updated to just those lines and their weight, courier assigned (AWB),
   pickup scheduled, label generated; the **Bill of Supply** is created for the shipped lines
   plus a **"Shipping" line** when shipping was charged; order goes to `packed`. If no line
   remains, the order is `cancelled` and fully refunded including shipping.
6. **Courier.** Shiprocket tracking webhook moves the order through `shipped`,
   `out_for_delivery`, `delivered` (or `rto`). Shopper emailed at shipped (with tracking link)
   and delivered.
7. **Cancel (staff).** Before Process, staff can cancel the whole order: every line refunded
   (with the credit/original choice), shipping refunded, Shiprocket order cancelled. Stock is
   returned only for units not marked unavailable.
8. **Stock on unavailable** (my call, builder check #2): units staff mark not available do
   **not** get stock back (the shelf didn't have them; the count was wrong). Stock-race units
   never took stock. The online path is the only writer of stock for online orders.
9. **Partial availability** (my call, builder check #6): availability is per unit; a line has
   `qty` and `available_qty`; refunds and allocations are per unit.
10. **Returned to origin (RTO)** (owner 2026-10-23): order goes to `rto`; staff click
   **Parcel received back**; then stock is returned for the shipped units and the item value
   is refunded (credit-or-original choice). Shipping is **not** refunded. The Bill of Supply
   is offset by a return record (reuse the existing in-store return/credit-note mechanism if
   one fits; builder checks `ReturnReceiptView`), never deleted.
   The Returns page gains (slice 5): "If a prepaid parcel is refused or undeliverable and
   returns to us, we refund the item value; the shipping charge is not refundable."


## 7. Money rules

- `subtotal` = Σ retailprice × qty for all lines.
- `promo_discount` from at most **one** website-valid code (see §9), allocated to lines in
  proportion to line value (rounded to paise; remainder on the largest line).
- `shipping` (owner decision 2026-10-23): free if (subtotal − promo_discount) ≥ ₹5,000.
  Otherwise the **Shiprocket rate of the cheapest usable courier** (owner decision 2026-10-26; was
  the recommended courier, which live calls showed can cost more) for the delivery pincode and the
  cart's parcel weight (§12), floored at the package's volumetric weight (L×B×H cm / 5000) because
  couriers bill the greater of the two. Package by heaviest unit class (assumed 2026-10-26, nothing
  shipped yet): light → bag 30×40×4 (0.96 kg), medium → bag 40×50×5 (2 kg), heavy → box 45×35×12
  (3.78 kg); the same dims go to Shiprocket at Process. Replace with measured sizes after test parcels,
  prepaid, **rounded up to the next ₹10**. If Shiprocket can't be reached within 5 s or returns
  no rate, charge a **flat ₹150** (₹99 until 2026-10-26; live Lite-plan rates run ₹74–₹149 up to 2 kg) (checkout never blocks on the rate API). The quoted courier id
  is stored on the order and preferred when booking at Process. Computed once at order time and
  **never increased** later (the shopper is not re-charged if the parcel gets lighter or the
  rate changes).
- `credit_applied` (store credit and/or voucher) applied last, up to the amount due.
- `gateway_amount` = subtotal − promo_discount + shipping − credit_applied (≥ 0).
- **Per-line paid value** = line value − its promo share. Each line's paid value is split
  between credit and gateway in the same ratio as the whole order's credit:gateway split
  (shipping counts as gateway-paid first, i.e. credit covers goods before shipping only if
  gateway is zero; builder may choose any deterministic rule that guarantees Σ refunds ≤ paid
  per source; document it).
- **Refund of a line** = its paid value. Credit-paid part always returns as credit (store
  credit for registered; new voucher for guests). Gateway-paid part follows the shopper's
  choice (instant store credit, or Cashfree refund to original method).
- **Shipping refund** only when every line is refunded (order cancelled).
- Free-shipping threshold is never re-evaluated after refunds.

## 8. Refund choice

When a line becomes unavailable (staff, stock race, or cancel), the system creates a refund
record per order event (grouping the lines refunded together) with status `awaiting_choice`
and emails the shopper a link `/refund-choice/:token` (random, single-use, 48 h) offering:
**Instant store credit** or **Refund to original payment method (5–7 working days)**.
- No choice in 48 h → original method. Enforced by a scheduled job (pg_cron calling an Edge
  Function, or pg_cron + pg_net); builder chooses, must be idempotent.
- Guests choosing credit get a one-time voucher code by email instead of balance.
- Cashfree refund is called with an idempotency key = refund id; refund status updated from
  Cashfree's refund webhook or a status poll.
- The refund email also links to a **similar pieces** page (existing `similarProducts.js`
  logic: same category, similar price, in stock). Alternatives are a new order.
- The published Shipping Policy (currently "flat ₹99 below ₹5,000") and the
  `shippingFee`/policy test are updated in slice 2 to: free at ₹5,000+, otherwise the courier
  rate shown at checkout. The FAQ and cart's "Shipping calculated at checkout" text stay true.
- The published Returns page and Terms are updated in the same slice to say "refund to the
  original payment method, or instant store credit if you choose".

## 9. Codes and credit

- **Promo codes** reuse `discounts`. New column `storefront_redeemable boolean default false`;
  only those work online. Online supports types `flat`, `percentage`, `conditional`, honouring
  `active`, `start_date`/`end_date`, `min_total`, `max_discount`, `once_per_customer` (by
  customer or by phone for guests), with the same maths as `billUtils.valueOfDiscount`.
  `auto_apply`, `exclusive`, category/free-item types are ignored or rejected online.
- **Store credit** = existing `customers.store_credit` (shared with in-store). Signed-in
  customers (linked via `customers.auth_user_id`, `resolve_my_customer`) choose an amount up
  to balance. **Held at `create-order`** (my call, builder check #1): the credit amount is
  debited into a hold (ledger row `hold`) when the order is created; payment confirm converts
  the hold to `spent`; order expiry/failure releases it. Every online movement is written to a
  new append-only `store_credit_ledger`. Registered-customer credit **never expires** (owner
  2026-10-23), same as in store today.
- **Vouchers** reuse `vouchers` (`source` gains `'online_refund'`). A guest (or anyone) may
  enter one voucher code; it is **reserved at `create-order`** (marked held against the order)
  and consumed at payment confirm; released on expiry/failure; any unused value is reissued
  as a new voucher (same expiry) and emailed. Online-issued **vouchers** expire after 1 year.
- **Safety net:** if at confirm any held credit/voucher/promo turns out invalid anyway, the
  order is still confirmed only if fully covered; otherwise the gateway amount is refunded
  automatically and the order marked `payment_failed` with an event. Money is never kept
  without an order.
- **Which vouchers work online** (my call, builder check #7): vouchers with
  `source='online_refund'` (long random codes, ≥ 12 chars, unguessable) and any voucher whose
  `customerid` is the signed-in customer. Code attempts are rate-limited per IP/phone
  (e.g. 10 per hour) and failures don't reveal whether a code exists.
- **Guests** (my call, builder check #4): at `create-order` a guest is matched to an existing
  `customers` row by phone, else a new row with `is_guest = true` is created. Gives
  `discount_usage`, vouchers and `bills.customerid` a customer. Signed-in shoppers use their
  linked row.
- One code box: the entered code is looked up as voucher first, then promo. One code per order.

## 10. States

Order: `pending_payment` → `paid` → `packed` → `shipped` → `out_for_delivery` → `delivered`.
Exits: `payment_failed` / `expired` (from pending_payment; pending orders expire after 45 min,
nothing was taken), `cancelled` (from paid), `rto` (from shipped states). Transitions only via
database functions; every transition appended to `order_events` (who/what/when/why).
Line: `ordered` → `available` | `unavailable` → (`shipped` | `refunded`).
Refund: `awaiting_choice` → `processing` → `completed` | `failed` (credit refunds complete
immediately).
Integration sync on order: Shiprocket create/update/ship each have a status and last error so
admin can **Retry**; a Shiprocket outage never blocks payment confirmation.

## 11. Data (new, additive)

Builder designs exact DDL; must include: `orders` (public `order_ref` like `WEB-000123`
from a sequence, used as Shiprocket `order_id`; customer link nullable for guests; contact
name/phone/email; UP address jsonb; money columns per §7; code used; cashfree order/payment
ids; shiprocket order/shipment ids, AWB, courier, label URL, tracking status; bill id; status;
timestamps), `order_items` (variant, product snapshot name/size/color, unit price, qty, promo
share, paid value, line status, refund id), `order_events`, `order_refunds` (+ lines),
`store_credit_ledger`, `refund_choice_tokens` (or a token column on refunds), a public-readable
`storefront_settings` row with `checkout_live boolean default false`, and a service-role-only
`integration_tokens` (Shiprocket bearer cache). RLS: shoppers read only their own orders
(via `auth_user_id`); guests read through a function taking `order_ref` + phone; admins
(`profiles.role` admin/superadmin) read all; writes only through security-definer functions or
service role.

## 12. Edge Functions (Deno)

`checkout-quote` (public; prices a cart + code + credit + pincode, returns lines and totals;
pincode/UP check and shipping rate via Shiprocket with a 5 s timeout, falling back to the
prefix check and flat ₹150; the pricing function takes the shipping rate as an input so it stays
pure),
`create-order` (public; re-quote, insert order, Cashfree order, return payment session or
confirm zero-amount), `cashfree-webhook` (verify signature on raw body, idempotent confirm,
refund status), `order-status` (return page; server-side Cashfree status check),
`admin-order-action` (admin JWT required; actions: set availability, process, cancel, retry
sync), `courier-status` (Shiprocket webhook; token check; re-fetch tracking; map statuses; URL
must not contain "shiprocket"/"sr"/"kr"/"kartrocket"), `refund-choice` (public, token),
`refund-sweeper` (scheduled, 48 h default), and a shared `_shared/` module for pricing,
Cashfree client, Shiprocket client, mailer, CORS. Pure logic (pricing, allocation, refund
split, status mapping, weight) lives in `_shared/` and is unit-tested with `deno test`. API
calls are tested with mocked `fetch`. Verify every Cashfree and Shiprocket endpoint, header
and signature scheme against their current docs; record what was verified.

Weight for Shiprocket (no per-product weights): light 0.5 kg (kurtis, shirts, tops, T-shirts),
medium 1 kg (sarees, suits, kurta pajama, gowns, dresses, cord sets), heavy 2 kg (lehengas,
sherwanis, suit sets); parcel = heaviest + 0.5 kg per extra item, cap 5 kg. Map from product
category; unknown → medium.

## 13. Storefront and admin UI

- `/checkout`: when `checkout_live` is false, behaves exactly as today (WhatsApp). When true:
  address form (prefilled for signed-in), code box, credit slider/input (signed-in with
  balance), server totals, **Pay ₹X** → Cashfree JS checkout → `/order/:ref`.
- **Free-shipping nudge** (owner idea 2026-10-23; details my call): in the cart drawer, cart
  page and checkout, for any cart under ₹5,000 show a progress bar and "Add ₹X more for free
  shipping"; at/above show "You've unlocked free shipping". When the gap is ≤ ₹2,000 also show
  "Add one of these": up to 4 in-stock pieces priced ≥ the gap, from categories already in the
  cart (fallback: any category), excluding items already in the cart. In cart/drawer the gap
  uses the item subtotal; at checkout it uses subtotal − promo discount, matching §7. Does not
  depend on `checkout_live`; ships as its own small slice first.
- `/order/:ref`: polls `order-status` until paid/failed; shows summary; guest sees "save your
  order ref".
- `/track` and `/account/orders` (exist as placeholders) read real orders.
- `/refund-choice/:token`, `/similar/:productId` (or reuse an existing listing).
- Admin `/admin/online-orders`: list with status filters and counts; detail with lines,
  availability toggles, Process / Cancel / Retry, money breakdown, refunds, timeline, label and
  Bill of Supply links. Uses existing shadcn/ui patterns.
- Bill of Supply is created by a database function from the order (not by `BillingForm`), with
  `document_type='bos'`, existing numbering trigger, lines at paid value (promo share as line
  discount), a Shipping line when charged, `salesmethod` = online, and **no stock change**
  (stock was taken at payment).

## 14. Release slices (each merges independently, live switch off)

0. **Free-shipping nudge** (storefront only, no backend; can go live immediately).
1. **Foundation:** migration (tables, RLS, functions for confirm/stock/credit/state changes,
   settings flag), `_shared` pricing + tests.
2. **Pay:** Shiprocket rate/postcode client (needed for the quote), `checkout-quote`, `create-order`, `cashfree-webhook`, `order-status`, checkout UI
   behind the flag, `/order/:ref`.
3. **Ship:** Shiprocket order create on paid, `courier-status`, weight, pincode check.
4. **Admin:** Online Orders screen + `admin-order-action` (availability, process, cancel,
   retry), Bill of Supply function.
5. **Refunds + credit + codes:** refund records, choice page, sweeper, Cashfree refunds,
   vouchers/credit at checkout, policy text update.
6. **Messages + tracking:** Gmail mailer and templates, shopper `/track` and account orders.

Going live = owner adds secrets, Cashfree webhook URL, Shiprocket webhook, sandbox end-to-end
test, then flips `checkout_live`.

## 15. Left to the builder

Exact DDL and function signatures; pending-order expiry mechanism; scheduler choice;
deterministic credit/gateway split rule (within §7); email template wording (plain, matching
site tone); admin layout details; how `/similar` is presented.
