# Cart & Checkout — Assumptions & Placeholder Values

Decisions made with placeholder values that need owner confirmation before going live.
Update this file when a decision is finalized; remove the entry when implemented and verified.

---

## Shipping

### Free Shipping Threshold
- **Current value:** ₹5,000 order subtotal
- **Status:** Placeholder — owner to confirm before launch
- **Implementation note:** Store in a `store_config` table (key/value) so admin can change without code deploy. Key: `free_shipping_threshold_inr`.

### Default Product Shipping Dimensions
Applied to any product where admin has not set custom dimensions.

| Field | Default value | Notes |
|---|---|---|
| `weight_kg` | `0.500` | Actual garment weight |
| `length_cm` | `32` | Folded + packaged |
| `width_cm` | `28` | Folded + packaged |
| `height_cm` | `5` | Folded + packaged |
| Volumetric weight | `0.90 kg` | (32×28×5) ÷ 5000 |
| Chargeable weight | `0.90 kg` | max(actual, volumetric) |

**Why these values:** Covers a single folded kurta/dress in a poly mailer with padding. Slightly overestimates to avoid surprise surcharges. Heavier items (lehenga, saree, suit sets) should have custom values set by admin.

- **Status:** Placeholder — admin should measure and update per product before launch
- **Implementation note:** Admin can edit weight/dims per product on the Inventory page.

---

## Payments

### Razorpay Account
- **Status:** Not yet created — owner to sign up at razorpay.com and complete KYC
- **Keys needed:** `RAZORPAY_KEY_ID` (public, in client env), `RAZORPAY_KEY_SECRET` (in Supabase Vault), `RAZORPAY_WEBHOOK_SECRET` (in Supabase Vault)

### Payment Methods Enabled
- **Assumed enabled:** UPI, PayTM, RuPay, Credit/Debit cards, Netbanking
- **Status:** Confirm in Razorpay dashboard after account setup

---

## Shipping Aggregator

### Shiprocket Account
- **Status:** Not yet created — owner to sign up at shiprocket.in and add pickup address
- **Pickup pincode:** `201001` (Ghaziabad, UP) — confirmed
- **Keys needed:** `SHIPROCKET_EMAIL` + `SHIPROCKET_PASSWORD` (or API token) → stored in Supabase Vault

### Courier Partners
- **Assumed:** Shiprocket auto-selects from available partners (Delhivery, BlueDart, FedEx India, Ekart, etc.)
- **Status:** Review available couriers in Shiprocket dashboard after account setup

---

## Auth

### SMS OTP Provider
- **Options:** Twilio (Supabase built-in) or MSG91 (cheaper for India)
- **Status:** Not decided — owner to choose before launch
- **Recommendation:** Start with Twilio (zero config with Supabase), switch to MSG91 if SMS costs are high at volume

### OTP Rate Limits
- **Assumed:** 3 attempts per 10 minutes per phone number (Supabase default)
- **Status:** Confirm Supabase phone auth limits before launch

---

## Store Configuration

### Customer-Facing Brand Name
- **Assumed:** "Bindal's Creations" (from existing logo/header)
- **Status:** Confirm for order confirmation emails and SMS

### Order Confirmation Email Sender
- **Status:** Not set up — need transactional email provider (Resend / SendGrid / Supabase built-in)
- **Recommendation:** Resend (generous free tier, excellent deliverability)

### Return / Refund Policy
- **Status:** Not defined — needed for checkout page footer and order confirmation
- **Affects:** Razorpay refund flow in `razorpay-webhook` Edge Function

---

## Inventory

### Stock Reservation Duration
- **Current value:** 15 minutes
- **Status:** Confirmed ✓

### Low Stock Threshold (optional, future)
- **Not in scope for launch** — flag products as "low stock" when quantity ≤ N. Add later.
