# Cart, Checkout, Payments & Shipping — Design Spec
**Date:** 2026-05-03  
**Status:** Approved — ready for implementation planning  
**Scope:** India-only (designed for future international extensibility)

---

## Overview

End-to-end e-commerce checkout for Bindal's Creations storefront. Covers 6 sequential phases, each with its own implementation plan. Phases must be built in order — each is a prerequisite for the next.

| Phase | Feature | Prerequisite |
|---|---|---|
| 0 | Product Detail Page | — |
| 1 | Cart | Phase 0 |
| 2 | Checkout Flow | Phase 1 |
| 3 | Payments (Razorpay) | Phase 2 |
| 4 | Shipping (Shiprocket) | Phase 3 |
| 5 | Orders & Admin Panel | Phase 4 |

---

## Architecture

### Approach: Razorpay Client SDK + Supabase Edge Functions

Razorpay's official `razorpay-js` browser SDK handles all payment UI (PCI compliant — no card data touches the platform). Supabase Edge Functions handle all server-side sensitive operations. No separate backend service required.

```
Browser (React SPA)
  ├── razorpay-js SDK          ← payment modal, PCI compliant
  └── supabase-js client       ← DB, auth, edge function calls

Supabase
  ├── PostgreSQL tables         ← data layer
  ├── Auth                     ← phone OTP + Google OAuth + email magic link
  └── Edge Functions (Deno)
        ├── initiate-payment    ← reserve stock + create Razorpay order
        ├── payment-verify      ← HMAC verify + create order + deduct stock
        ├── razorpay-webhook    ← async events (captured, failed, refunded)
        ├── shiprocket-rates    ← proxy rate fetch (checkout step 3)
        └── create-shipment     ← admin dispatch → AWB + pickup (admin JWT only)

External
  ├── Razorpay                 ← payments (UPI, PayTM, RuPay, cards, netbanking)
  └── Shiprocket               ← shipping aggregator, origin pincode 201001
```

### Security Guarantees
- Razorpay secret key never in browser — only `RAZORPAY_KEY_ID` (public) in client env
- Payment signature verified server-side (HMAC-SHA256) before any order is created
- Stock deducted atomically only after successful signature verification
- Shiprocket credentials in Supabase Vault — proxied, never client-exposed
- All Edge Functions require valid Supabase JWT; `create-shipment` additionally requires admin role
- RLS policies on `cart_items` and `orders`: users read/write own rows only
- Guest session token: cryptographically random UUID in localStorage — not guessable
- No PII stored in localStorage — only session token, variant IDs, quantities

---

## Data Model

### Changes to Existing Tables

```sql
-- customers: link storefront auth users to existing customer records
ALTER TABLE customers ADD COLUMN auth_user_id uuid REFERENCES auth.users(id) UNIQUE;
-- NULL for admin-created records. Set when storefront user registers.

-- discounts: flag codes redeemable by storefront customers
ALTER TABLE discounts ADD COLUMN storefront_redeemable boolean DEFAULT false;

-- products: dimensions for shipping rate calculation
ALTER TABLE products
  ADD COLUMN weight_kg  numeric(5,3) DEFAULT 0.500,
  ADD COLUMN length_cm  numeric(5,1) DEFAULT 32,
  ADD COLUMN width_cm   numeric(5,1) DEFAULT 28,
  ADD COLUMN height_cm  numeric(5,1) DEFAULT 5;
```

### New Tables

```sql
-- Logged-in user carts (guest cart lives in localStorage)
CREATE TABLE cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES productsizecolors(id),
  product_id  text NOT NULL REFERENCES products(productid),
  quantity    int  NOT NULL CHECK (quantity > 0),
  added_at    timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, variant_id)
);

-- 15-minute stock holds during checkout
CREATE TABLE stock_reservations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id          uuid NOT NULL REFERENCES productsizecolors(id),
  quantity            int  NOT NULL,
  session_token       text NOT NULL,  -- user_id or guest UUID
  razorpay_order_id   text NOT NULL UNIQUE,
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at          timestamptz DEFAULT now()
);

-- Storefront orders (both guest and logged-in)
CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid REFERENCES customers(id),      -- NULL for guests
  guest_email         text,
  guest_phone         text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','confirmed','processing','shipped','delivered','cancelled','failed','refunded')),
  razorpay_order_id   text UNIQUE,
  razorpay_payment_id text,
  subtotal            numeric(10,2) NOT NULL,
  discount_amount     numeric(10,2) NOT NULL DEFAULT 0,
  shipping_amount     numeric(10,2) NOT NULL DEFAULT 0,
  total               numeric(10,2) NOT NULL,
  discount_code       text,
  courier_id          text,
  courier_name        text,
  shipping_address    jsonb NOT NULL,  -- {name, line1, line2, city, state, pincode, phone}
  shiprocket_order_id text,
  tracking_id         text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Line items — snapshot product details at order time
CREATE TABLE order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES productsizecolors(id),
  product_id    text NOT NULL,
  product_name  text NOT NULL,   -- snapshot
  size          text NOT NULL,   -- snapshot
  color         text NOT NULL,   -- snapshot
  quantity      int  NOT NULL,
  unit_price    numeric(10,2) NOT NULL,  -- snapshot
  total_price   numeric(10,2) NOT NULL
);

-- Configurable store settings
CREATE TABLE store_config (
  key    text PRIMARY KEY,
  value  text NOT NULL
);
INSERT INTO store_config VALUES ('free_shipping_threshold_inr', '5000');
```

### Available Stock Formula
Used everywhere stock is displayed (product page, cart, checkout):
```sql
available = productsizecolors.stock
          - COALESCE(
              (SELECT SUM(quantity) FROM stock_reservations
               WHERE variant_id = $id AND expires_at > now()),
            0)
```

---

## Phase 0 — Product Detail Page

**Route:** `/product/:productid`

**Components:**
- Image gallery (primary image + thumbnails if multiple)
- Product name, price in ₹, fabric, category badge
- Variant picker: size selector → color selector (filtered by available stock per combination)
- Available stock indicator (uses formula above)
- "Add to Cart" button — disabled if variant not selected or out of stock
- Sticky mobile "Add to Cart" bar on scroll

**Behaviour:**
- `ProductCard` links already point to `/product/:id` — route just needs to exist
- Variant selection mirrors existing admin `productsizecolors` data structure
- Out-of-stock variants shown greyed-out, not hidden

---

## Phase 1 — Cart

**Persistence:**
- Guest: localStorage (`bc_cart` key) — array of `{variant_id, product_id, quantity}`
- Logged-in: `cart_items` table in Supabase, synced in real time
- On login: localStorage cart merged into `cart_items` (upsert, quantities summed)

**UI:**
- Slide-in drawer from right (triggered by `ShoppingBag` icon in header — already present)
- Badge count on icon showing total item quantity
- Drawer: item rows with image, name, size/color, qty stepper, remove button, line total
- Subtotal at bottom, "Checkout" CTA
- Empty state with "Shop Now" link

**Cart Context:** React context (`CartContext`) wraps `StorefrontLayout` — provides `addItem`, `removeItem`, `updateQty`, `clearCart`, `itemCount`, `items`.

---

## Phase 2 — Checkout Flow

**Route:** `/checkout` (multi-step, single page with step state)

**Steps:**

1. **Identity** — login gate: phone OTP / Google OAuth / email magic link / guest. Guest requires email + phone.
2. **Address** — name, phone, address lines, city, state, pincode. Logged-in users see saved addresses. Pincode validated for Shiprocket serviceability before proceeding.
3. **Shipping** — `shiprocket-rates` Edge Function called. Shows courier options (name, price, ETA). Customer picks one. Free if subtotal ≥ threshold from `store_config`.
4. **Review** — order summary with items, subtotal, shipping, discount code field (1 code, `storefront_redeemable = true` only), total. Final available-stock check.
5. **Payment** — "Confirm & Pay" calls `initiate-payment` → stock reserved → Razorpay modal opens → payment completed → `payment-verify` → redirect to confirmation.

**15-minute timer:** Visible in UI from step 5 onward. On expiry: modal closes, customer sees "Session expired — items returned to cart."

---

## Phase 3 — Payments (Razorpay)

**Integration pattern:** Approach C — client SDK for payment modal, Edge Functions for verification.

**Edge Functions:**

`initiate-payment`:
1. Validate cart items exist and are in stock (available stock formula)
2. Insert `stock_reservations` rows
3. Call Razorpay Orders API → get `razorpay_order_id`
4. Return `{key_id, razorpay_order_id, amount}` to browser

`payment-verify`:
1. Receive `{razorpay_payment_id, razorpay_order_id, razorpay_signature}`
2. Verify: `HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, secret)`
3. If valid: deduct stock from `productsizecolors`, insert `orders` + `order_items`, delete reservations, send confirmation SMS/email
4. If invalid: 400 error, reservation expires naturally

`razorpay-webhook` (registered in Razorpay dashboard):
- `payment.captured` — idempotent order confirm (safety net for browser-close)
- `payment.failed` — mark order failed, delete reservations immediately
- `refund.processed` — update order status to `refunded`
- Webhook secret verified on every call

**Environment variables (Supabase Vault):**
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

**Client env (public):**
- `REACT_APP_RAZORPAY_KEY_ID`

---

## Phase 4 — Shipping (Shiprocket)

**Origin:** pincode `201001`, Ghaziabad, UP

**Edge Functions:**

`shiprocket-rates` (called at checkout step 3):
- Input: `{delivery_postcode, weight_kg, length_cm, width_cm, height_cm, cod: false}`
- Calls Shiprocket Rate Calculator API
- Returns sorted courier options: `[{courier_id, name, rate, etd}]`
- Free shipping override: if `subtotal >= store_config.free_shipping_threshold_inr`, return all rates as ₹0

`create-shipment` (admin-only, requires admin JWT):
- Input: `{order_id}`
- Reads order + items + address from DB
- Calls Shiprocket Create Order API with `courier_id` stored on order
- Calls Shiprocket Schedule Pickup
- Writes `shiprocket_order_id`, `tracking_id` to order, sets status → `processing`
- Sends customer dispatch SMS

**Shiprocket SMS notifications (automatic):** picked up, in transit, out for delivery, delivered — Shiprocket sends these natively, no platform work needed.

**Environment variables (Supabase Vault):**
- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD` (or API token)

---

## Phase 5 — Orders & Admin Panel

**New admin route:** `/admin/orders`

**Customer routes:**
- `/order/:id/confirmation` — post-payment confirmation, "create account" nudge for guests
- `/account/orders` — order history (requires auth)
- `/account/orders/:id` — order detail with status timeline and tracking link

**Order Status Lifecycle:**
```
pending → confirmed → processing → shipped → delivered
              └→ failed → refunded
              └→ cancelled
```

**Admin Orders Page:**
- Tab filters: Confirmed | Processing | Shipped | All
- Table: order ID, customer, item count, total, status badge, action button
- "Process & Ship" button on confirmed orders → confirmation dialog (courier + destination) → calls `create-shipment`
- "Track" link on shipped orders → opens Shiprocket tracking URL
- Cancel button with reason field (triggers refund via Razorpay API)

**Auth:**
- Customer login: phone OTP (primary), Google OAuth, email magic link — all passwordless
- OTP: 60-second validity, 3 attempts before cooldown
- Guest → account upgrade: post-confirmation nudge links past order via phone/email match
- RLS on `cart_items`, `orders`, `order_items`: users access own rows only

**Notifications:**
- Platform sends: order confirmed (SMS + email with invoice), order dispatched (SMS + email with tracking)
- Shiprocket sends: pickup, in transit, out for delivery, delivered (automatic)
- Transactional email provider: Resend (see assumptions doc)

---

## New Routes Summary

| Route | Audience | Auth required |
|---|---|---|
| `/product/:productid` | Storefront | No |
| `/checkout` | Storefront | No (guest allowed) |
| `/order/:id/confirmation` | Storefront | No |
| `/account/orders` | Storefront | Yes (customer) |
| `/account/orders/:id` | Storefront | Yes (customer) |
| `/admin/orders` | Admin | Yes (admin/superadmin) |

---

## Out of Scope (this design)

- International shipping / multi-currency
- COD (cash on delivery)
- Wishlist (icon exists in header, functionality deferred)
- Product reviews
- Low-stock threshold alerts
- Automated order fulfilment (manual dispatch is intentional for launch)
- Returns portal (return/refund policy must be defined first — see assumptions doc)

---

## Related Files

- `docs/superpowers/cart-checkout-assumptions.md` — placeholder values requiring owner decision before launch
