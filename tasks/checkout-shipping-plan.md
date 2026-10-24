# Checkout & shipping plan

Written 2026-10-13. Status: plan, awaiting owner decisions (bottom) and accounts
(see `tasks/accounts-setup.md`). Builds on the earlier specs, which are still valid:
`docs/superpowers/specs/2026-05-03-cart-checkout-design.md` (Razorpay + Edge Functions; gateway is now Cashfree, same shape),
`docs/STOREFRONT-OVERHAUL-PLAN.md` (orders table, state machine, functions),
`docs/superpowers/specs/2026-05-30-shipping-fields-design.md` (weights/HSN).

## Where things stand today
- Cart works (localStorage, synced to `cart_items` when logged in).
- `/checkout` collects an address, but **"Place order" is permanently disabled**. The only way
  to finish is a pre-filled WhatsApp message to +91 98108 73280.
- No orders, payments or shipments tables. No Edge Functions (`send-bill-sms` was removed).
- Shipping fee in code: flat ₹99 below ₹5,000, free at or above (`lib/checkout.js:45-49`).
  The shipping policy page says "calculated based on location", **which contradicts the code**.
- Delivery estimate is static text; tracking and order history are "coming soon" pages.
- Terms and Privacy pages are placeholders pending legal review; gateways need them real.

> **Current (owner decision 2026-10-20):** the shop sells online itself under the composition
> scheme, UP-only. UP-only checkout + wording shipped in PR #32. Courier = **Shiprocket**,
> gateway = **Cashfree** (2026-10-23, replaces Razorpay), both KYC'd in the shop's name. (The 2026-10-14 plan to sell via the
> regular-scheme LLP across India is parked; see `tasks/todo.md`.)

## Constraint: composition GST → Uttar Pradesh only
The business is a composition dealer (Bill of Supply). CGST Act **s.10(2)(c) bars composition
dealers from inter-state supplies of goods**, so online orders can only ship to **UP addresses**.
Selling intra-state through the shop's own website appears allowed, but no source addresses
it directly. **The CA must confirm** before launch (see `tasks/accounts-setup.md` §1).
Consequences:
- Checkout blocks any non-UP pincode/state, with a friendly message pointing to WhatsApp or the store.
- The shipping policy page must say "we currently deliver within Uttar Pradesh only".
- Each online order is billed as a **Bill of Supply** (`bills.document_type = 'bos'`),
  the same as in store.
- Shipping nationwide later means leaving the composition scheme. That's a business/tax decision, not code.

## Recommended stack
| Need | Choice | Why |
|---|---|---|
| Payments | **Cashfree** (see Gateway decision below) | 0% platform fee on the first ₹20 lakh (festive offer), then 1.95% + GST. No setup or yearly fee, T+1 settlement, Payment Links free and need no code. |
| Shipping | **Shiprocket** (owner decision 2026-10-20; dashboard booking first, API in Phase C) | One API for pincode serviceability, rates and tracking across couriers. |
| COD | **Prepaid only at first**; add COD with a fee + WhatsApp/OTP confirmation if demand shows | COD return rates in fashion run ~30%, and each failed parcel costs ₹150–300 in two-way freight. |
| Server code | Supabase Edge Functions | The only safe place for the Cashfree secret and webhook signature checks (as in the earlier spec). |

Note: the 0.4% UPI fee (on payments over ₹2,000) was **postponed until after Diwali 2026**. Expect UPI costs to rise later.

### Gateway decision (2026-10-23)
Switched from Razorpay to **Cashfree** before any account was opened. Checked on both official pricing pages that day:
- **Cashfree festive offer:** 0% platform fee on the first ₹20,00,000 of GMV for merchants who sign up
  on or after 21 Jul 2026, valid until 31 Mar 2027. 18% GST is still charged on the notional 1.95%,
  so it costs about 0.35% of sales. A composition dealer can't claim that GST back. Cost on ₹20 lakh:
  about ₹7k, against about ₹47k on Razorpay (2% + GST). After the offer: 1.95% vs Razorpay's 2%.
- **Offer conditions:** one per PAN. Not for partner-referred or custom-priced accounts, so sign up
  directly. AMEX, corporate cards, EMI and pay-later are excluded. Cashfree may withdraw the offer if
  credit cards reach 60% or more of GMV (worst case: back to 1.95%).
- **Build effort:** about the same as Razorpay (order API, JS checkout, signed webhook).
- **Rejected:** Razorpay (no new-merchant offer). PhonePe PG (promo terms unclear). Shopify: Shopify
  Payments isn't in India, and Shopify adds 0.5–2% on top of the gateway; it would also duplicate
  inventory and Bill of Supply billing.

## Phase A — Diwali bridge (no new code, by ~Oct 25)
Take prepaid orders online for Diwali without building checkout:
1. Shopper places an order through the existing WhatsApp checkout message.
2. Staff confirm stock and delivery address (UP only), then send a **Cashfree Payment Link**
   from the Cashfree dashboard or app for the exact amount (incl. ₹99 shipping below ₹5,000).
3. Once paid: create the Bill of Supply in admin billing as usual, then book the parcel in the
   **Shiprocket dashboard** (pickup from the shop) and send the tracking link on WhatsApp.
4. The first-order discount (action plan P1 #8) is applied by hand at step 2.

Code changes in this phase (small, part of the Diwali work):
- [ ] Shipping policy: "Uttar Pradesh only", flat ₹99 below ₹5,000 (matches the code), dispatch and delivery times.
- [ ] Checkout form: UP-only state/pincode validation (UP pincodes start with 20–28) with a clear message.
- [x] Replace placeholder Terms/Privacy with real content (owner-approved 2026-10-23, `feat/cashfree-readiness`; Cashfree reviews these at activation).

## Phase B — Real online checkout (after Diwali, ~2–3 weeks of work)
Following the earlier spec, trimmed to prepaid-only and UP-only:
1. **Schema** (`schema/migration_orders.sql`): `orders` (ref, customer, UP shipping address,
   subtotal/shipping/discount/total, status state machine `pending_payment → paid → packed →
   shipped → delivered`, plus exits `cancelled`/`refunded`; cashfree ids, awb/tracking),
   `order_items` (variant, qty, price snapshot), stock reservation as in the earlier spec.
2. **Edge Functions:** `create-order` (re-price from DB, check stock, UP check, compute shipping
   and discount, create Cashfree order); `cashfree-webhook` (verify signature, mark paid,
   decrement stock atomically, idempotent on redelivery).
3. **Checkout UI:** enable "Place order" → Cashfree Checkout modal → confirmation page `/order/:ref`;
   prefill the address for logged-in customers via `resolve_my_customer`.
4. **Admin:** online orders list; "Create Bill of Supply" from an order (bills already support a
   customer + sales method); mark packed/shipped with AWB; cancel/refund.
5. **Customer side:** order history (`/account/orders`) and tracking (`/track`) read from `orders`.
6. **First-order discount** as a real code checked in `create-order` (reuse the `discounts` table).
7. **Notifications:** order confirmation and shipped messages (WhatsApp link or email).
8. **Tests:** pricing/shipping/discount logic (unit), Edge Functions with mocked Cashfree
   (signature verify, idempotency), one end-to-end test-mode payment.

## Phase C — Shiprocket integration (spec 2026-10-20)

API facts verified from apidocs.shiprocket.in / support.shiprocket.in on 2026-10-20 (research
notes in session; re-check anything marked unverified against a live call):
base `https://apiv2.shiprocket.in`; `POST /v1/external/auth/login {email,password}` → Bearer
token valid 240 h; API user is a separate email, password shown once, max 4 users.

### C1. Pincode check + delivery estimate at checkout (needs only the API user; no orders table)
Edge Function `shipping-quote` (Deno, public, CORS = `ALLOWED_ORIGIN`):
- Input `{ pincode, weightClass }`; reject anything not 6 digits before calling Shiprocket.
- `GET /v1/external/open/postcode/details?postcode=` → must be state Uttar Pradesh. This replaces
  the 20–28 prefix check, which wrongly lets Uttarakhand pincodes through (keep the prefix check
  client-side as a fast pre-filter). Unknown pincode returns `status_code` 403 → "not serviceable".
- `GET /v1/external/courier/serviceability/?pickup_postcode=201001&delivery_postcode=…&weight=…&cod=0`
  → serviceable if `available_courier_companies` is non-empty (treat empty list **and** a body
  `status: 404` as not serviceable; exact signal unverified). Return
  `{ serviceable, state, etdDays }` from `recommended_courier_company_id` (else fastest).
- Token: cached in a service-role-only table `integration_tokens (provider, token, expires_at)`;
  re-login when <24 h left or on 401. Never log the token or password.
- Failure mode: Shiprocket down/timeout (5 s) → `{ serviceable: null }`, checkout falls back to
  the prefix check + static "5–7 days" text. Never block an order because the quote API failed.
- Customer still pays the flat fee (₹99 below ₹5,000) unless the owner chooses pass-through after
  seeing the rate table; the quote's `rate` is returned to admin only, never shown to shoppers.
- Weight classes (no per-product weights yet): light 0.5 kg (kurtis, shirts, tops, T-shirts),
  medium 1 kg (sarees, suits, kurta pajama, gowns, dresses, cord sets), heavy 2 kg (lehengas,
  sherwanis, suit sets). Cart weight = heaviest class + 0.5 kg per extra item, capped at 5 kg.
- Tests: pure helpers (weight calc, response parsing incl. empty/404/403 cases) unit-tested;
  function tested with mocked `fetch`; one manual live call per pincode in the owner's rate table.

### C2. Shipments from orders (after Phase B orders table exists)
Admin "Ship" button on a paid order → Edge Function `create-shipment` (admin-only):
`/orders/create/adhoc` (`order_id` = our order ref, `pickup_location` = `Shop`,
`payment_method` = Prepaid, `selling_price` GST-inclusive, `invoice_number` = Bill of Supply no.)
→ `/courier/assign/awb` → `/courier/generate/pickup` → `/courier/generate/label`. Store
`sr_order_id`, `shipment_id`, `awb`, label URL on the order; idempotent on retry (check stored ids
first; Shiprocket rejects reused `order_id`s, even cancelled ones). Print our own Bill of Supply,
not Shiprocket's auto invoice.

### C3. Tracking webhook
Settings → API → Webhooks → our URL with a security token (arrives as `x-api-key`). URL must not
contain "shiprocket", "sr", "kr" or "kartrocket" → name it `/functions/v1/courier-status`.
Treat the token as a shared secret only: on each event re-fetch `/courier/track/awb/{awb}` and map
status ids (6 Shipped, 17 Out for delivery, 7 Delivered, 9/10 RTO, 8/45 Cancelled) onto the order
state machine; always return 200. Customer `/track` page reads from `orders`.

### Not now
COD; Shiprocket's paid plans (revisit above ~100 shipments/month); returns via courier;
per-product weights (2026-05-30 shipping-fields spec) until weight disputes show it's needed.

## Owner decisions needed
1. **CA confirmation of UP-only** online selling under composition (blocks Phase A going live).
2. ~~Courier~~ decided 2026-10-20: **Shiprocket**.
3. **COD:** prepaid only at launch (recommended), or COD with a fee + confirmation?
4. **Shipping fee:** keep flat ₹99 below ₹5,000 (recommended, simple for UP-only), or zone-based?
5. **First-order discount:** amount and how it's claimed (also in the action plan).
