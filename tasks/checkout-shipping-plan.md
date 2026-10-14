# Checkout & shipping plan

Written 2026-10-13. Status: plan, awaiting owner decisions (bottom) and accounts
(see `tasks/accounts-setup.md`). Builds on the earlier specs, which are still valid:
`docs/superpowers/specs/2026-05-03-cart-checkout-design.md` (Razorpay + Edge Functions),
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

> **Superseded 2026-10-14:** online sales will be made by the owner's separate
> distribution company, registered under the **regular** GST scheme. The UP-only
> constraint below no longer applies: deliver across India. PR #14 closed.
> Open items: see `tasks/todo.md` "Online seller = regular-scheme company".

## (Superseded) Constraint: composition GST → Uttar Pradesh only
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
| Payments | **Razorpay** | Published pricing (2% + GST on UPI/cards/netbanking), no setup or yearly fee, T+1 settlement, Payment Links need no code. Matches the earlier spec. |
| Shipping | **Delhivery One** (manual dashboard booking first) | UP-only orders mostly get local/same-zone rates; COD remitted within ~48h vs Shiprocket's D+8. Shiprocket is the alternative if comparing several couriers matters more. |
| COD | **Prepaid only at first**; add COD with a fee + WhatsApp/OTP confirmation if demand shows | COD return rates in fashion run ~30%, and each failed parcel costs ₹150–300 in two-way freight. |
| Server code | Supabase Edge Functions | The only safe place for the Razorpay secret and webhook signature checks (as in the earlier spec). |

Note: the 0.4% UPI fee (on payments over ₹2,000) was **postponed until after Diwali 2026**. Expect UPI costs to rise later.

## Phase A — Diwali bridge (no new code, by ~Oct 25)
Take prepaid orders online for Diwali without building checkout:
1. Shopper places an order through the existing WhatsApp checkout message.
2. Staff confirm stock and delivery address (UP only), then send a **Razorpay Payment Link**
   from the Razorpay dashboard or app for the exact amount (incl. ₹99 shipping below ₹5,000).
3. Once paid: create the Bill of Supply in admin billing as usual, then book the parcel in the
   **Delhivery One dashboard** (pickup from the shop) and send the tracking link on WhatsApp.
4. The first-order discount (action plan P1 #8) is applied by hand at step 2.

Code changes in this phase (small, part of the Diwali work):
- [ ] Shipping policy: "Uttar Pradesh only", flat ₹99 below ₹5,000 (matches the code), dispatch and delivery times.
- [ ] Checkout form: UP-only state/pincode validation (UP pincodes start with 20–28) with a clear message.
- [ ] Replace placeholder Terms/Privacy with real content (needed for Razorpay website approval in Phase B).

## Phase B — Real online checkout (after Diwali, ~2–3 weeks of work)
Following the earlier spec, trimmed to prepaid-only and UP-only:
1. **Schema** (`schema/migration_orders.sql`): `orders` (ref, customer, UP shipping address,
   subtotal/shipping/discount/total, status state machine `pending_payment → paid → packed →
   shipped → delivered`, plus exits `cancelled`/`refunded`; razorpay ids, awb/tracking),
   `order_items` (variant, qty, price snapshot), stock reservation as in the earlier spec.
2. **Edge Functions:** `create-order` (re-price from DB, check stock, UP check, compute shipping
   and discount, create Razorpay order); `razorpay-webhook` (verify signature, mark paid,
   decrement stock atomically, idempotent on redelivery).
3. **Checkout UI:** enable "Place order" → Razorpay Checkout modal → confirmation page `/order/:ref`;
   prefill the address for logged-in customers via `resolve_my_customer`.
4. **Admin:** online orders list; "Create Bill of Supply" from an order (bills already support a
   customer + sales method); mark packed/shipped with AWB; cancel/refund.
5. **Customer side:** order history (`/account/orders`) and tracking (`/track`) read from `orders`.
6. **First-order discount** as a real code checked in `create-order` (reuse the `discounts` table).
7. **Notifications:** order confirmation and shipped messages (WhatsApp link or email).
8. **Tests:** pricing/shipping/discount logic (unit), Edge Functions with mocked Razorpay
   (signature verify, idempotency), one end-to-end test-mode payment.

## Phase C — Shipping automation (when volume justifies it)
- [ ] Delhivery API: pincode serviceability + live rate at checkout, auto-create shipment,
      tracking webhook updates order status.
- [ ] Product weights/dimensions per the 2026-05-30 shipping-fields spec (category defaults).
- [ ] COD (if decided), with a fee and confirmation before dispatch.

## Owner decisions needed
1. **CA confirmation of UP-only** online selling under composition (blocks Phase A going live).
2. **Courier:** Delhivery One (recommended) or Shiprocket (the earlier plan; more couriers, slower COD payout).
3. **COD:** prepaid only at launch (recommended), or COD with a fee + confirmation?
4. **Shipping fee:** keep flat ₹99 below ₹5,000 (recommended, simple for UP-only), or zone-based?
5. **First-order discount:** amount and how it's claimed (also in the action plan).
