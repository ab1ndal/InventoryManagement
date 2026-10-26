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
   | `{ action: "send_back", orderId, opKey, manualCancelConfirmed?: boolean }`
     // stalled Process (processing, op 'process', lease expired) → paid; opKey must differ from the Process key
   | `{ action: "rebook", orderId, opKey, parcelLost: boolean, note: string, manualCancelConfirmed?: boolean }`
     // packed / shipped / out_for_delivery → paid (re-send) or cancelled (nothing left; refundId returned)
   | `{ action: "release_op", orderId, opKey }`
     // any admin: abandon a send_back / rebook claim whose courier booking was NOT cancelled
Res 200: `{ ok: true, order: <orders row>, refundId?: string, billId?: number }`
Errors: 400 `invalid_request` (bad/missing field; `note` blank, `parcelLost` / `manualCancelConfirmed` not boolean), 403 `forbidden` (`manualCancelConfirmed: true` from a non-superadmin, `set_live` from an admin), 409 `busy` (another staff action holds the order), 409 `bad_state`, 502 `courier_error` (order left in `processing` with `process_error`; Retry resumes).

`cancel` on an order that is already `cancelled` (e.g. by a rebook that refunded everything) → 200 with the order and no `refundId`.

`send_back` / `rebook` courier cancel (once per opKey; skipped when the order has no Shiprocket ids or the `sr_cancelled` checkpoint is already recorded for this opKey):
- order has an AWB: `REBOOK_API_CANCEL=on` → cancel by AWB via API; otherwise → 502 `courier_error` "Courier booking AWB <awb> must be cancelled in the Shiprocket dashboard; a superadmin then confirms it here."
- Shiprocket order id but no AWB: cancel the Shiprocket order via API (regardless of the flag).
- API cancel fails → 502 `courier_error` "Cancel AWB <awb> / Shiprocket order <id> in Shiprocket dashboard" (null parts omitted), also stored as the order's `problem`.
- `manualCancelConfirmed: true` (superadmin) → records the manual dashboard cancel instead of calling the API.
After a 502 the order stays claimed (`op_action` send_back / rebook, 5-minute lease): resend with the **same opKey** (e.g. a superadmin with `manualCancelConfirmed: true`); a different opKey gets 409 `busy` until the lease expires. Repeating a finished send_back / rebook with its opKey returns 200 again (lost-response retry).

`release_op` (SQL `online_order_release_op`): allowed with the claim's own opKey, or any opKey once its lease expired. send_back → order stays `processing` as a stalled Process (`op_action` 'process', lease expired, key kept) so Retry / Send back take over; rebook → claim cleared, status unchanged (courier tracking was only held while the rebook lease was live). 200 `{ ok: true, order }`. Refused → 409 `bad_state`: courier booking already cancelled for the order (`sr_cancelled` recorded or manual cancel confirmed — finish the action instead), another key's lease still live, or no send_back / rebook in progress. Event `op_released {action, op_key, actor}`.

## Webhooks (no CORS, `--no-verify-jwt`)
- POST `cashfree-webhook` — Cashfree payment + refund events (signature checked).
- POST `courier-status` — Shiprocket tracking, exposed as `https://www.bindalscreations.com/hooks/courier-status` (vercel rewrite), header `x-api-key`.
- POST `run-jobs` — called by pg_cron every 2 min with header `x-cron-secret: <CRON_SECRET>`; also invoked internally after confirm.
