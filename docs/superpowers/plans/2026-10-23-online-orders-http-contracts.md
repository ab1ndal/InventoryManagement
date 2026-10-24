# Online Orders — HTTP contracts (Edge Functions ↔ React)

Fixed 2026-10-23 so server and UI slices can be built in parallel. Server builders implement
exactly these shapes; UI builders call exactly these. All bodies JSON. Browser calls use
`supabase.functions.invoke(name, { body })` (POST) — the anon key or the user's JWT goes in
`Authorization` automatically. Errors: non-2xx with `{ error: string, code?: string }`;
`code` values listed per endpoint. Money in rupees (number, 2 dp).

## Public (storefront)

### `storefront_settings` (direct table read, anon)
`supabase.from("storefront_settings").select("checkout_live").eq("id", 1).single()`

### POST `checkout-quote`
Req: `{ items: [{ variantId: string, qty: number }], pincode?: string, code?: string, creditRequested?: number }`
Res 200:
```
{ live: boolean,
  quote: { lines: [{ variantId, productId, name, size, color, unitPrice, qty, promoShare, paidValue }],
           subtotal, promoDiscount, shipping, voucherApplied, creditApplied, gatewayAmount,
           amountDue, freeShippingGap },
  pincode: { ok: boolean, reason?: "format"|"not_up"|"unverifiable" } | null,   // null when no pincode sent
  shippingSource: "rate"|"flat"|"free",
  code: { status: "ok"|"invalid"|"rate_limited", kind?: "voucher"|"promo", message?: string } | null,
  creditAvailable: number,          // 0 for guests
  unavailable: [{ variantId, available: number }] }  // stock lower than requested qty
```

### POST `create-order`
Req: `{ attemptKey: string(uuid v4), items, address: { name, phone, email?, line1, line2?, city, state, pincode }, code?, creditRequested? }`
Res 200: `{ orderRef: "WEB-000123", accessToken: string, paymentSessionId: string|null, cashfreeMode: "sandbox"|"production", paid: boolean }`
(`paid: true` and `paymentSessionId: null` when credit/voucher covered everything.)
Errors: 403 `checkout_off`; 409 `price_changed` (re-quote); 409 `out_of_stock`; 422 `invalid_address` / `not_up` / `unverifiable_pincode` / `invalid_code`; 429 `rate_limited`; 502 `gateway_error`.

### POST `order-status`
Req: `{ orderRef, accessToken }` (or no token with a signed-in owner's JWT)
Res 200: `{ orderRef, status: "pending_payment"|"paid"|"processing"|"cancelling"|"packed"|"shipped"|"out_for_delivery"|"delivered"|"payment_failed"|"expired"|"cancelled"|"rto"|"rto_received", items: [{ name, size, color, qty, status }], totals: { subtotal, promoDiscount, shipping, voucherApplied, creditApplied, gatewayAmount }, trackingUrl: string|null, leftoverVoucher: { code, value }|null }`
404 for unknown ref or bad token (identical).

### RPC `online_order_lookup` (anon, for /track)
`supabase.rpc("online_order_lookup", { p_order_ref, p_phone })` → same shape as order-status `Res` but snake_case from SQL, or `null`. UI normalises.

### RPC `my_online_orders` (authenticated, for /account/orders) → array of order summaries (see migration).

### GET-like POST `refund-choice` with `{ token, action: "preview" }`
Res: `{ orderRef, status: "awaiting_choice"|"processing"|"completed"|"failed", amount: number, creditPart: number, gatewayPart: number, items: [{ name, size, color, units }], expiresAt: string, isGuest: boolean }`; 404 `invalid_token`; 410 `expired`.
### POST `refund-choice` with `{ token, action: "choose", choice: "store_credit"|"original" }`
Res: `{ status, choice, vouchers: [{ code, value, expiry }], creditAdded: number }`; 409 `already_chosen`; 410 `expired`.

## Admin (JWT of admin/superadmin; 401/403 otherwise)

Reads: direct table selects (admin RLS) on `orders`, `order_items`, `order_events`, `order_refunds`, `order_refund_legs`, `order_jobs`.

### POST `admin-order-action`
Req: `{ action: "set_availability", orderId, itemId, availableQty }`
   | `{ action: "process", orderId, opKey }`
   | `{ action: "cancel", orderId, opKey, reason }`
   | `{ action: "retry", orderId }`              // re-runs failed job(s) / resumes process
   | `{ action: "rto_received", orderId }`
   | `{ action: "set_live", live: boolean }`     // superadmin only; flips storefront_settings
Res 200: `{ ok: true, order: <orders row>, refundId?: string, billId?: number }`
Errors: 409 `busy` (another staff action holds the order), 409 `bad_state`, 502 `courier_error` (order left in `processing` with `process_error`; Retry resumes).

## Webhooks (no CORS, `--no-verify-jwt`)
- POST `cashfree-webhook` — Cashfree payment + refund events (signature checked).
- POST `courier-status` — Shiprocket tracking, exposed as `https://www.bindalscreations.com/hooks/courier-status` (vercel rewrite), header `x-api-key`.
- POST `run-jobs` — called by pg_cron every 2 min with header `x-cron-secret: <CRON_SECRET>`; also invoked internally after confirm.
