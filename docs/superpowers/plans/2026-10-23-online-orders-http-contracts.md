# Online Orders — HTTP contracts (Edge Functions ↔ React)

Fixed 2026-10-23 so server and UI slices can be built in parallel. Server builders implement
exactly these shapes; UI builders call exactly these. All bodies JSON. Browser calls use
`supabase.functions.invoke(name, { body })` (POST) — the anon key or the user's JWT goes in
`Authorization` automatically. Errors: non-2xx with `{ error: string, code?: string }`;
`code` values listed per endpoint. Money in rupees (number, 2 dp).

## Public (storefront)

### `storefront_settings` (direct table read, anon)
`supabase.from("storefront_settings").select("checkout_live").eq("id", 1).single()`

### Holder key (stock holds, 2026-10-30)
Guests: `g:<uuid v4>`, created once in localStorage `bc_holder`, sent as `holderKey` to `cart-hold`,
`checkout-quote` and `create-order` (a malformed key → 400 `bad_request`). Signed in: the server uses
`u:<auth uid>` from the verified JWT and never accepts a `u:` key from the body; a guest key sent with a
JWT is adopted into the user key by `cart-hold`. "Available" for a shopper = stock − other holders'
active holds (cart holds 15 min, order holds 45 min), floor 0.

### POST `cart-hold` (`--no-verify-jwt`; optional user JWT verified by the handler)
Req: `{ holderKey?: "g:<uuid>", items: [{ variantId, qty: 0..20 }] (≤30), replace?: boolean }`
Sets each listed variant's hold to `qty` (0 releases). A new or changed hold runs to now + 15 min; the
same `qty` again (reload, cart open) keeps its expiry. Hold session cap (`migration_online_orders_hold_cap.sql`):
a hold never runs past 30 min from its start, then the holder gets none on that variant for 10 min
(`reason: "cooldown"`); releasing keeps the session clock. The cart line is never removed. `replace: true`
syncs the whole cart: also releases the holder's holds on variants not listed (`items: []` releases all).
`holderKey` is required without a JWT. Empty `items` without `replace` → 400.
Res 200:
```
{ rateLimited: boolean,              // >30 calls/min per holder: nothing changed, items []
  items: [{ variantId, requested, held, available, reason: null|"unavailable"|"holder_cap"|"ip_cap"|"cooldown" }],
  expiresAt: string|null }           // earliest expiry of the holder's cart holds
```
Caps never error: 5 held units per holder, 10 active per IP (cf-connecting-ip hash; off without
IP_HASH_SALT). The storefront shrinks a cart line only when `available` < its quantity.

### RPC `variant_availability(p_variant_ids uuid[], p_holder_key text default null)` (anon, authenticated)
Rows `{ variant_id, stock, held_by_others, available, my_held, others_expire_at }`. Used by the PDP
("In someone's cart — may free up in N min") and cart revalidation.

### POST `checkout-quote`
Req: `{ items: [{ variantId: string, qty: number }], pincode?: string, code?: string, creditRequested?: number, fulfilment?: "ship"|"pickup", holderKey?: "g:<uuid>" }`
(`fulfilment` defaults to `ship`. `pickup`: shipping 0, freeShippingGap 0, pincode ignored → `pincode: null`, `shippingSource: "pickup"`.)
Res 200:
```
{ live: boolean,
  quote: { lines: [{ variantId, productId, name, size, color, unitPrice, qty, promoShare, paidValue }],
           subtotal, promoDiscount, shipping, voucherApplied, creditApplied, gatewayAmount,
           amountDue, freeShippingGap },
  pincode: { ok: boolean, reason?: "format"|"not_up"|"unverifiable" } | null,   // null when no pincode sent
  shippingSource: "rate"|"flat"|"free"|"pickup",
  code: { status: "ok"|"invalid"|"rate_limited", kind?: "voucher"|"promo", message?: string } | null,
  creditAvailable: number,          // 0 for guests
  unavailable: [{ variantId, available: number }] }  // available (stock − others' holds) lower than qty
```

### POST `create-order`
Req: `{ attemptKey: string(uuid v4), items, address: { name, phone, email?, line1, line2?, city, state, pincode }, code?, creditRequested?, fulfilment?: "ship"|"pickup", holderKey?: "g:<uuid>" }`
(The holder's cart holds become the order's holds for 45 min; released on payment failure / expiry,
consumed at confirm. Another holder's units → 409 `out_of_stock`.)
(`fulfilment: "pickup"`: `address` needs only `{ name, phone, email? }`; the order stores `{ name, phone }` and ₹0 shipping.)
Res 200: `{ orderRef: "WEB-000123", accessToken: string, paymentSessionId: string|null, cashfreeMode: "sandbox"|"production", paid: boolean }`
(`paid: true` and `paymentSessionId: null` when credit/voucher covered everything.)
Errors: 403 `checkout_off`; 409 `price_changed` (re-quote); 409 `out_of_stock`; 422 `invalid_address` / `not_up` / `unverifiable_pincode` / `invalid_code`; 429 `rate_limited`; 502 `gateway_error`.

### POST `order-status`
Req: `{ orderRef, accessToken }` (or no token with a signed-in owner's JWT)
Res 200: `{ orderRef, status: "pending_payment"|"paid"|"processing"|"cancelling"|"packed"|"shipped"|"out_for_delivery"|"delivered"|"payment_failed"|"expired"|"cancelled"|"rto"|"rto_received"|"ready_for_pickup", fulfilment: "ship"|"pickup", courier: "shiprocket"|"porter"|null, items: [{ name, size, color, qty, status }], totals: { subtotal, promoDiscount, shipping, voucherApplied, creditApplied, gatewayAmount }, trackingUrl: string|null, leftoverVoucher: { code, value }|null }`
(`courier: null` = the default Shiprocket flow. `trackingUrl`: the Shiprocket link when there is an AWB; for a Porter order the link staff pasted, or null.)
404 for unknown ref or bad token (identical).

### RPC `online_order_lookup` (anon, for /track)
`supabase.rpc("online_order_lookup", { p_order_ref, p_phone })` → same shape as order-status `Res` but snake_case from SQL, or `null`. UI normalises. (`courier`, `tracking_url` as above.)

### RPC `my_online_orders` (authenticated, for /account/orders) → array of order summaries (see migration).

### GET-like POST `refund-choice` with `{ token, action: "preview" }`
Res: `{ orderRef, status: "awaiting_choice"|"processing"|"completed"|"failed", amount: number, creditPart: number, gatewayPart: number, items: [{ name, size, color, units }], expiresAt: string, isGuest: boolean }`; 404 `invalid_token`; 410 `expired`.
### POST `refund-choice` with `{ token, action: "choose", choice: "store_credit"|"original" }`
Res: `{ status, choice, vouchers: [{ code, value, expiry }], creditAdded: number }`; 409 `already_chosen`; 410 `expired`.

## Admin (JWT of admin/superadmin; 401/403 otherwise)

Reads: direct table selects (admin RLS) on `orders`, `order_items`, `order_events`, `order_refunds`, `order_refund_legs`, `order_jobs`.

### POST `admin-order-action`
Req: `{ action: "set_availability", orderId, itemId, availableQty }`
   | `{ action: "process", orderId, opKey }`           // ship orders only; a pickup order → 409 bad_state
   | `{ action: "dispatch_manual", orderId, trackingUrl?: string|null }`
     // Porter, booked by hand: paid ship order (shelf checked, no AWB) → shipped with courier 'porter' (billId)
     // or cancelled (nothing available; refundId). trackingUrl optional, https:// only, ≤ 500 chars (else 400).
     // The Shiprocket order made at payment is cancelled best effort; a failure is left on orders.problem.
     // No opKey: a repeat returns the stored result. A Porter order refuses process / send_back / rebook (409 bad_state).
   | `{ action: "mark_ready", orderId }`               // pickup: paid (shelf checked) → ready_for_pickup (billId) or cancelled (nothing available; refundId)
   | `{ action: "mark_collected", orderId }`           // pickup: ready_for_pickup → delivered (delivered_at = now)
   | `{ action: "cancel", orderId, opKey, reason }`    // paid, or ready_for_pickup
   | `{ action: "retry", orderId }`              // re-runs failed job(s) / resumes process
   | `{ action: "rto_received", orderId }`
   | `{ action: "set_live", live: boolean }`     // superadmin only; flips storefront_settings
   | `{ action: "send_back", orderId, opKey, manualCancelConfirmed?: boolean }`
     // stalled Process (processing, op 'process', lease expired) → paid; opKey must differ from the Process key
   | `{ action: "rebook", orderId, opKey, parcelLost: boolean, note: string, manualCancelConfirmed?: boolean }`
     // packed / shipped / out_for_delivery → paid (re-send) or cancelled (nothing left; refundId returned)
   | `{ action: "release_op", orderId, opKey }`
     // any admin: abandon a send_back / rebook claim whose courier booking was NOT cancelled
   | `{ action: "mark_delivered", orderId, deliveredAt: <ISO-8601 with zone>, reason }`   // superadmin only; delivered_at is never changed once set, at most 30 days back
     // Porter order (courier 'porter'): any admin, reason optional
   | `{ action: "return_open", orderId, reason: "damaged_wrong"|"change_of_mind", contactedAt: <ISO-8601 with zone>, items: [{ itemId, units }], note, returnAwb?, overrideReason? }`
     // outside the return window only a superadmin may open it, with a non-blank overrideReason
   | `{ action: "return_photo_url", returnId, contentType }`  // image/jpeg|png|webp|heic|heif; any orderId / path in the body is ignored
   | `{ action: "return_photo_add", returnId, path }`        // path as returned by return_photo_url; the DB re-validates its shape
   | `{ action: "return_photo_view", photoId }`
   | `{ action: "return_preview", returnId, items: [{ itemId, receivedUnits, restockUnits }] }`   // every item of the return listed once, same rules as receive
   | `{ action: "return_receive", returnId, items: [{ itemId, receivedUnits, restockUnits }], note? }`
   | `{ action: "return_cancel", returnId, note }`
Res 200: `{ ok: true, order: <orders row>, refundId?: string, billId?: number }`
- `order.returns`: every order response carries the order's returns, each `{ ...order_returns columns, items: [order_return_items rows], photos: [{ id, uploaded_at }] }`. Photo paths are never sent; staff view a photo through `return_photo_view`.
- `return_open` → also `returnId`.
- `return_photo_url` → `{ ok, uploadUrl, path, token }` (no `order`): the browser PUTs the file to `uploadUrl` (signed upload URL on the private `order-returns` bucket), then calls `return_photo_add` with `path`. The path is built by the server (`<order_id>/<return_id>/<uuid>.<ext>`).
- `return_photo_add` → also `photoId`.
- `return_photo_view` → `{ ok, url }` (signed URL, valid 10 minutes; no `order`).
- `return_preview` → `{ ok, preview: { credit_part, gateway_part, shipping, total } }` (no `order`).
- `return_receive` → also `status` (`refunded` | `rejected`), `refund`, and `refundId` when a refund was created.
- `return_cancel`, `mark_delivered` → just the order.
Errors: 400 `invalid_request` (bad/missing field; `note` blank, `parcelLost` / `manualCancelConfirmed` not boolean; return actions: bad `reason`, `contactedAt` / `deliveredAt` not an ISO timestamp with zone, `items` empty or listing an item twice, `units` not a positive integer, `receivedUnits` / `restockUnits` not non-negative integers or restock above received, `contentType` not an allowed image type, `trackingUrl` not an https:// link), 403 `forbidden` (`manualCancelConfirmed: true` from a non-superadmin, `set_live`, or `mark_delivered` of a non-Porter order, from an admin), 404 `not_found` (unknown `returnId` on add-photo / receive / cancel, unknown `photoId`), 409 `busy` (another staff action holds the order), 409 `bad_state`, 502 `courier_error` (order left in `processing` with `process_error`; Retry resumes).

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
