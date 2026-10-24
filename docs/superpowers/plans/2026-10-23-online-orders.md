# Online Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shoppers pay online (Cashfree), orders flow to Shiprocket, staff check shelf and Process, unavailable units are refunded (credit or original), tracking runs to Delivered; store credit, vouchers and promo codes work at checkout.

**Architecture:** Postgres owns every state change and every money/stock mutation through SECURITY DEFINER functions (one migration). Supabase Edge Functions (Deno) own all external calls (Cashfree, Shiprocket, Gmail SMTP) and call those functions with the service role. The React storefront and admin call Edge Functions; the live switch `storefront_settings.checkout_live` keeps the new checkout hidden until accounts exist.

**Tech Stack:** Postgres (Supabase), Deno 2 Edge Functions (`deno test`), React 19 CRA (`react-scripts test`), Cashfree PG API + `@cashfreepayments/cashfree-js`, Shiprocket API v2, Gmail SMTP 465.

**Spec:** `docs/superpowers/specs/2026-10-23-online-orders-design.md`. API facts: `docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md`, `docs/superpowers/specs/2026-10-23-api-notes-cashfree-gmail.md`. Executors read the spec section a task cites before starting.

> **Revision 2 (2026-10-23, after Codex adversarial review):** the section **Revisions (R1–R20)** at the end of this file OVERRIDES any task text it contradicts. Every executor reads it before starting a task.

## Global Constraints

- Seller is a GST composition dealer: Bill of Supply only (`document_type='bos'`), no GST added anywhere. Delivery within Uttar Pradesh only.
- Prepaid only. Prices = `products.retailprice`.
- Shipping: free if (subtotal − promo) ≥ ₹5,000; else Shiprocket recommended-courier rate rounded **up** to next ₹10; flat ₹99 if no rate within 5 s. Never increased after order time.
- One code per order (voucher looked up first, then promo). Registered store credit never expires; online vouchers expire 1 year after issue, codes ≥ 12 chars random.
- Refund choice default after 48 h = original method. Shipping refunded only when every unit is refunded and not on RTO.
- First paid wins on stock; no holds or timers.
- Secrets only in Supabase function secrets: `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV`, `SHIPROCKET_API_EMAIL`, `SHIPROCKET_API_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ALLOWED_ORIGIN`, `SITE_URL`. Never logged.
- Migrations: new file only, no `BEGIN/COMMIT` (exec_sql 0A000), additive; in-store billing behaviour unchanged. Fetch live schema first (CLAUDE.md command). Confirm column names by grepping existing queries.
- Shiprocket webhook URL must not contain `shiprocket`, `kartrocket`, `sr`, `kr` (substring): expose it as `https://www.bindalscreations.com/hooks/courier-status` via a `vercel.json` rewrite to the Supabase function.
- Order ref format `WEB-` + 6-digit zero-padded sequence (Cashfree `order_id` 3–45 chars `[A-Za-z0-9_-]`; Shiprocket ≤ 50).
- Cashfree facts (notes file): `x-api-version: 2026-01-01`; `customer_id` alphanumeric only → send `C{customerid}`; `return_url` built with the real ref (no placeholder); set `order_expiry_time` = now + 30 min explicitly; only `order_status == 'PAID'` means paid (an EXPIRED order can still become PAID); webhook signature = base64(HMAC-SHA256(client secret, `x-webhook-timestamp` + rawBody)) with no separator; refunds `refund_id` 3–40 chars, Σ partial refunds ≤ captured, within 6 months. Browser SDK loaded from `https://sdk.cashfree.com/js/v3/cashfree.js` (no npm dependency).
- Mail: `npm:nodemailer@^9` (Supabase's official example), `smtp.gmail.com:465`, `secure: true` hard-coded; Gmail cap 500/day.
- CRA rules (tasks/lessons.md): no `globalThis`, exhaustive-deps is a build error, run tests with `CI=true npx react-scripts test <path> --watchAll=false`. Pre-existing failing suites: App.test.js, dashboardData, RevenueChart, BillTable.
- Each slice ends with `npm run build` clean, its tests green, a PR, and merge. Live DB migration, function deploys and secrets are done by the controller (main session), never by task subagents.

## Review Focus

1. **Duplicate/out-of-order webhooks** (Cashfree success twice, success after expiry, Shiprocket events out of order): confirm and tracking must be idempotent and never move state backwards. Tests in Tasks 1, 5 and 7.
2. **Money arrives after the order expired or its credit/voucher was released**: must re-validate and either confirm (if coverable) or auto-refund the gateway amount. Tests in Tasks 1 and 5.
3. **Rounding**: promo shares, credit splits and per-unit refunds must sum exactly to totals in paise; Σ refunds never exceeds paid per source. Property-style tests in Task 2.
4. **Concurrent last unit**: two confirms for the same single-stock variant: exactly one gets stock, the other's unit becomes unavailable + refund. Test in Task 1.
5. **Live switch off**: with `checkout_live=false`, checkout UI is byte-for-byte the current WhatsApp flow and every public order function refuses. Tests in Tasks 1, 4 and 6.

---

## Slice 0: Free-shipping nudge (storefront only; independent, start immediately)

### Task 0: Free-shipping progress + suggestions

**Files:**
- Create: `src/storefront/lib/freeShipping.js`, `src/storefront/components/FreeShippingNudge.jsx`
- Modify: `src/storefront/components/CartDrawer.jsx`, `src/storefront/pages/CartPage.jsx`, `src/storefront/pages/CheckoutPage.jsx` (render the nudge above totals)
- Test: `src/storefront/__tests__/freeShipping.test.js`, `src/storefront/__tests__/FreeShippingNudge.test.jsx`

**Interfaces:**
- Produces: `FREE_SHIPPING_THRESHOLD = 5000`; `freeShippingProgress(amount) -> { qualified: boolean, gap: number, percent: number }`; `SUGGEST_GAP_LIMIT = 2000`; `<FreeShippingNudge amount={number} cartItems={items} />`.
- Consumes: existing `src/storefront/lib/similarProducts.js` / `cartApi.js` query patterns for in-stock products (respect the 1000-row cap: filter server-side, `limit(4)`).

- [ ] **Step 1: Failing tests** — `freeShippingProgress(3760)` → `{qualified:false, gap:1240, percent:75}` (percent floored); `freeShippingProgress(5000)` → `{qualified:true, gap:0, percent:100}`; `freeShippingProgress(0)` → `gap:5000, percent:0`. Component: amount 3760 renders "Add ₹1,240 more for free shipping" and a progressbar with `aria-valuenow=75`; amount 5200 renders "You've unlocked free shipping"; amount 2000 (gap 3000) renders no suggestion row; amount 3500 (gap 1500) with mocked supabase returning 4 products renders "Add one of these" and excludes product ids already in `cartItems`; empty cart (amount 0, no items) renders nothing.
- [ ] **Step 2: Run, verify fail.** `CI=true npx react-scripts test src/storefront/__tests__/freeShipping --watchAll=false`
- [ ] **Step 3: Implement.** Make `src/storefront/lib/checkout.js` import the threshold from `freeShipping.js` (single source). Suggestions: in-stock products (variant stock > 0, has images per existing anon policy) with `retailprice >= gap`, categories from cart first then any, ordered by `retailprice` ascending, limit 4. Reuse `ProductCard` styling at small size. In CheckoutPage pass the item subtotal for now (Task 8 switches it to server quote).
- [ ] **Step 4: Run tests + `npm run build`.**
- [ ] **Step 5: Commit** `feat(storefront): free-shipping progress nudge with suggestions`, PR, merge.

---

## Slice 1: Foundation

### Task 1: Migration — tables, settings, RLS, state functions

**Files:**
- Create: `schema/migration_online_orders.sql`, `schema/test_online_orders.sql` (rollback-wrapped SQL tests, same style as `schema/test_storefront_customer_auth.sql`)

**Interfaces (Produces — exact names; every later task uses these):**
- Tables: `storefront_settings(id int pk check (id=1), checkout_live bool not null default false)` anon-readable; `orders`, `order_items`, `order_events`, `order_refunds`, `order_refund_items`, `store_credit_ledger`, `integration_tokens` (service role only), `code_attempts` (rate limit). `orders.status` check: `pending_payment, paid, packed, shipped, out_for_delivery, delivered, payment_failed, expired, cancelled, rto, rto_received`. `order_items.status`: `ordered, available, partially_available, unavailable, shipped, refunded`; columns `qty, available_qty`. `order_refunds.status`: `awaiting_choice, processing, completed, failed`; `choice`: `null|store_credit|original`; `token text unique`, `token_expires_at`; split columns `credit_amount, gateway_amount, shipping_amount`.
- `discounts.storefront_redeemable boolean not null default false`; `vouchers.source` check gains `'online_refund'`; `vouchers.held_order_id uuid null`; an `Online` row in `salesmethods` if absent (check live first).
- Functions (all `security definer`, `set search_path = public`, execute granted to `service_role` only unless marked):
  - `online_order_create(p_order jsonb, p_items jsonb) returns table(order_id uuid, order_ref text)` — matches/creates customer (§9 guests by phone, `is_guest=true`), inserts order `pending_payment` with money columns from the quote, holds credit (ledger `hold`, decrements `customers.store_credit`) and voucher (`held_order_id`), records promo code; raises if `checkout_live` false, if credit balance or voucher no longer valid.
  - `online_order_confirm_payment(p_order_ref text, p_cf_payment_id text, p_amount numeric) returns jsonb` — idempotent; `{result: 'confirmed'|'already'|'refund_required', race_units: [{item_id, units}]}`; locks order row; converts holds to spent; takes stock per unit with `update productsizecolors set stock = stock - n where variantid = ... and stock >= n`, falling back unit-by-unit; units not obtained become unavailable and get a refund row (reason `stock_race`); records promo usage in `discount_usage`; consumes voucher and issues leftover voucher; if order is expired/failed and holds can't be re-taken and not fully coverable → returns `refund_required` with amount and writes event.
  - `online_order_fail(p_order_ref text, p_status text, p_reason text) returns void` — `payment_failed|expired`, releases holds; no-op if already paid.
  - `online_order_expire_stale() returns int` — pending older than **45 min** → expired (Cashfree order expires at 30; 15 min grace for in-flight attempts).
  - `online_order_set_availability(p_order_id uuid, p_item_id uuid, p_available_qty int, p_actor uuid) returns void` — only in `paid`.
  - `online_order_prepare_process(p_order_id uuid, p_actor uuid) returns jsonb` — creates one refund (reason `unavailable`) for all unavailable units; returns `{shippable_items:[...], all_unavailable: bool, refund_id}`; if all unavailable, cancels order with shipping included in refund.
  - `online_order_mark_packed(p_order_id uuid, p_shipment jsonb, p_actor uuid) returns bigint` (bill id) — stores Shiprocket ids/AWB/courier/label, sets `packed`, calls `online_order_create_bos`.
  - `online_order_create_bos(p_order_id uuid) returns int` — inserts `bills` (`document_type='bos'`, `finalized=true`, customer, Online sales method, totals = shipped paid value + shipping) and `bill_items` (one per shipped line, `discount_total` = promo share, no GST, **no stock change**) and a `Shipping` item when shipping > 0; numbering via existing trigger.
  - `online_order_cancel(p_order_id uuid, p_actor uuid, p_reason text) returns uuid` (refund id) — only `paid`; returns stock for units not marked unavailable; refund includes shipping.
  - `online_order_apply_tracking(p_awb text, p_status text, p_payload jsonb) returns void` — forward-only state order `packed < shipped < out_for_delivery < delivered`; `rto` allowed from shipped states; ignores stale.
  - `online_order_rto_received(p_order_id uuid, p_actor uuid) returns uuid` — returns stock for shipped units, refund of item value without shipping, offsets bill (check `ReturnReceiptView`/exchange tables for an existing return record; else a negative `bills` row is NOT allowed — record in `order_events` and flag for owner).
  - `online_refund_choose(p_token text, p_choice text) returns jsonb` — **anon executable**; valid only `awaiting_choice` and unexpired; `store_credit` completes instantly (registered: `customers.store_credit +=` with ledger `refund_credit`; guest: new voucher `source='online_refund'`, 1-year expiry, returns code); `original` → `processing`.
  - `online_refund_default_expired() returns setof uuid` — `awaiting_choice` past 48 h → choice `original`, `processing`; credit-paid parts always completed as credit.
  - `online_refund_set_status(p_refund_id uuid, p_status text, p_cf_refund_id text, p_note text) returns void`.
  - `online_order_lookup(p_order_ref text, p_phone text) returns jsonb` — **anon executable**; returns status, items (name/size/color/qty/status), totals, tracking url; rate-limited via `code_attempts`.
  - `my_online_orders() returns setof jsonb` — **authenticated**; via `auth.uid()` → `customers.auth_user_id`.
  - `online_code_check(p_code text, p_phone text, p_customer_id int) returns jsonb` — voucher (online_refund or owned) then promo (`storefront_redeemable`, active, dates, once_per_customer); rate limit 10 failures/hour per phone; generic failure message.
- RLS: enable on all new tables; anon/authenticated have no direct table access except `storefront_settings` select.

- [ ] **Step 1: Fetch live schema** (CLAUDE.md command) for `customers, vouchers, discounts, discount_usage, bills, bill_items, salesmethods, saleslocations, productsizecolors, products`; record exact column names/types used in a comment at the top of the migration.
- [ ] **Step 2: Write `schema/test_online_orders.sql`** — each test in `begin; ... rollback;` with `do $$ ... assert ... $$`: create→confirm takes stock and converts credit hold; confirm twice → second returns `already`, stock taken once; two orders for a stock-1 variant both confirmed → one gets the unit, other has `race_units` and an `awaiting_choice` refund; confirm after `online_order_fail(... 'expired')` with credit re-takeable → confirmed, not re-takeable and uncovered → `refund_required`; `checkout_live=false` → `online_order_create` raises; set availability 1 of 2 → prepare_process refund covers 1 unit's paid value only, no shipping; all unavailable → order `cancelled`, refund includes shipping; mark_packed creates bill with `document_type='bos'`, Shipping item when shipping>0, stock unchanged; apply_tracking delivered then shipped → stays delivered; refund_choose store_credit for guest returns 12+ char code and sets voucher expiry = issue + 1 year; choose twice → second raises; default_expired flips only rows older than 48 h; lookup with wrong phone returns null.
- [ ] **Step 3: Write the migration** to satisfy those tests.
- [ ] **Step 4: Run tests against a disposable target.** Use `supabase db query --linked -- "$(cat schema/test_online_orders.sql)"` **only after** the controller applies the migration (Task 1 subagent stops here and reports; controller applies with `npm run migrate`, then runs the test file; every test is rollback-wrapped so prod data is untouched).
- [ ] **Step 5: Commit** `feat(db): online orders schema, state and money functions`.

### Task 2: Shared pure logic (`_shared`) with deno tests

**Files:**
- Create: `supabase/functions/_shared/pricing.ts`, `supabase/functions/_shared/shipping.ts`, `supabase/functions/_shared/tracking.ts`, tests `supabase/functions/_shared/*_test.ts`, `supabase/functions/deno.json` (tasks: `test`)

**Interfaces (Produces):**
- `type Line = { itemKey: string; variantId: string; productId: string; name: string; size: string; color: string; category: string | null; unitPrice: number; qty: number }`
- `type Promo = { code: string; type: 'flat'|'percentage'|'conditional'; value: number; max_discount: number|null; min_total: number|null; rules: Record<string, unknown>|null }`
- `promoDiscount(promo: Promo|null, subtotal: number): number` — same maths as `billUtils.valueOfDiscount` for these types, never > subtotal.
- `shippingCharge(rate: number|null, discountedSubtotal: number): number` — 0 if ≥ 5000; `Math.ceil(rate/10)*10` if rate; 99 if null.
- `allocate(totalPaise: number, weights: number[]): number[]` — integer paise, sums exactly, remainder to largest weight (ties: first).
- `quoteOrder(input: { lines: Line[]; promo: Promo|null; shippingRate: number|null; creditRequested: number; creditAvailable: number; voucherValue: number }): Quote` where `Quote = { lines: (Line & { promoShare: number; paidValue: number; creditPart: number; gatewayPart: number })[]; subtotal; promoDiscount; shipping; creditApplied; voucherApplied; gatewayAmount; freeShippingGap }` (rupees, 2 dp). Order of application: promo → shipping → voucher → credit (credit capped at `min(creditRequested, creditAvailable, remaining)`). Non-gateway money (voucher+credit) covers goods before shipping; per-line `creditPart = allocate(nonGatewayGoods, paidValues)`.
- `refundSplit(line: QuotedLine, units: number): { credit: number; gateway: number }` — per-unit via `allocate` over `qty` units, deterministic (first units carry remainder).
- `parcelWeightKg(categories: (string|null)[]): number` — light 0.5 / medium 1 / heavy 2 per spec §12 map; heaviest + 0.5 per extra unit, cap 5; unknown → medium.
- `mapShipmentStatus(shipmentStatusId: number): 'shipped'|'out_for_delivery'|'delivered'|'rto'|'cancelled'|null` — per Shiprocket notes table (`shipment_status_id`: 6→shipped, 17→out_for_delivery, 7→delivered, 9/10→rto, 8/45→cancelled; others per notes).

- [ ] **Step 1: Failing tests** — `shippingCharge(73, 1200) === 80`; `shippingCharge(80, 1200) === 80`; `shippingCharge(null, 1200) === 99`; `shippingCharge(120, 5000) === 0`; promo percentage 10% max 300 on 4000 → 300; conditional min_total 3000 below → 0; quote with 3 lines (1000×1, 1500×2, 333×3), 10% promo, rate 73, credit 500: Σ promoShare = promoDiscount, Σ paidValue + shipping = total due, gatewayAmount = due − 500, Σ creditPart = 500; property test: 500 random quotes → all sums exact to the paisa and every `refundSplit(line, line.qty)` equals `{credit: creditPart, gateway: gatewayPart}`; voucher larger than due → gatewayAmount 0, voucherApplied = due; free-shipping gap 5000 − discounted subtotal clamped ≥ 0; `parcelWeightKg(['Lehenga','Kurti','Kurti']) === 3`; 12 sarees → 5; `mapShipmentStatus(7) === 'delivered'`, unknown → null.
- [ ] **Step 2: Run** `cd supabase/functions && deno test _shared/` → fail.
- [ ] **Step 3: Implement.** Integer paise internally.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `feat(functions): shared pricing, shipping and tracking logic`. PR for slice 1 (Tasks 1–2), merge after controller applies migration and SQL tests pass.

---

## Slice 2: Pay

### Task 3: External clients + shared infra

**Files:**
- Create: `supabase/functions/_shared/cashfree.ts`, `_shared/shiprocket.ts`, `_shared/mailer.ts`, `_shared/http.ts` (CORS with `ALLOWED_ORIGIN`, JSON helpers, service-role Supabase client, admin-JWT check via `profiles.role in ('admin','superadmin')`), tests with mocked `fetch`.

**Interfaces (Produces):**
- `cashfree.createOrder({orderRef, amount, customer:{id, name, phone, email}, returnUrl, notifyUrl, expiresAt}) -> {cfOrderId, paymentSessionId}`; `cashfree.getOrder(orderRef) -> {status: 'ACTIVE'|'PAID'|'EXPIRED'|..., amount}`; `cashfree.getPayments(orderRef) -> {cfPaymentId, status, amount}[]`; `cashfree.verifyWebhook(rawBody: string, signature: string, timestamp: string) -> Promise<boolean>`; `cashfree.createRefund(orderRef, {refundId, amount, note}) -> {cfRefundId, status}`; `cashfree.getRefund(orderRef, refundId)`.
- `shiprocket.token()` (cached in `integration_tokens`, re-login < 24 h left or on 401); `shiprocket.postcodeState(pincode) -> string|null`; `shiprocket.rate({deliveryPincode, weightKg, declaredValue}) -> {rate, courierId, etdDays}|null` (5 s timeout; null on any failure); `shiprocket.createOrder(order, items) -> {srOrderId, shipmentId}`; `shiprocket.updateOrder(...)`; `shiprocket.assignAwb(shipmentId, courierId?) -> {awb, courierName}`; `shiprocket.pickup(shipmentId)`; `shiprocket.manifest(shipmentId)` (400 "already manifested" = ok); `shiprocket.label(shipmentId) -> labelUrl` (check `label_created`); `shiprocket.cancel(srOrderIds)`; `shiprocket.track(awb)`.
- `mailer.send({to, subject, text, html})` — Gmail SMTP 465 per Cashfree/Gmail notes; no-op + warning log when secrets missing.
- Exact endpoints, headers, versions, signature algorithm: from the two API notes files; anything marked UNVERIFIED gets a `// UNVERIFIED:` comment and a test pinning our assumption.

- [ ] **Step 1: Failing tests** with a fake `fetch`: createOrder sends `x-client-id`, `x-client-secret`, `x-api-version` from notes, amount with 2 dp; verifyWebhook true for a fixture signed per notes, false for tampered body; shiprocket.rate returns null on timeout (fake fetch never resolves; 5 s via injected timer) and on body `status: 404`; picks `recommended_courier_company_id`'s `rate`; token cached second call (one login fetch); label() throws when `label_created` falsy; mailer with missing secrets resolves without sending.
- [ ] **Step 2–4: Implement, run `deno test`.**
- [ ] **Step 5: Commit** `feat(functions): Cashfree, Shiprocket and mail clients`.

### Task 4: `checkout-quote` and `create-order`

**Files:** `supabase/functions/checkout-quote/index.ts`, `supabase/functions/create-order/index.ts`, `supabase/functions/_shared/quote.ts` (DB loading: variants, prices, categories, promo/voucher via `online_code_check`, credit via customer), tests.

**Interfaces:**
- POST `checkout-quote` body `{items:[{variantId, qty}], pincode?, code?, creditRequested?}` + optional user JWT → `{quote: Quote, pincodeOk: boolean|null, codeStatus: 'ok'|'invalid'|null, creditAvailable: number, live: boolean}`. Pincode: 6 digits, prefix 20–28, then `shiprocket.postcodeState` must equal "Uttar Pradesh" (null state on API failure → accept prefix result).
- POST `create-order` body `{items, address:{name, phone, email, line1, line2, city, state, pincode}, code?, creditRequested?}` → `{orderRef, paymentSessionId|null, mode: 'sandbox'|'production', paid: boolean}`. Re-quotes (never trusts client totals), refuses when `checkout_live` false (403), calls `online_order_create`, then `cashfree.createOrder` with `returnUrl = SITE_URL/order/{order_id}`; if gatewayAmount 0 → `online_order_confirm_payment(ref, 'NO_GATEWAY', 0)` and `paid:true`. On Cashfree failure → `online_order_fail(ref,'payment_failed', ...)` and 502.

- [ ] Steps: failing tests (live false → 403; client-supplied price ignored; Uttarakhand pincode 263001 → `pincodeOk:false`; zero-gateway path confirms without calling Cashfree; Cashfree error releases holds), implement, `deno test`, commit `feat(functions): checkout quote and order creation`.

### Task 5: `cashfree-webhook`, `order-status`, expiry

**Files:** `supabase/functions/cashfree-webhook/index.ts`, `supabase/functions/order-status/index.ts`, `schema/migration_online_orders_cron.sql` (pg_cron: every 5 min `online_order_expire_stale()`; hourly call to `refund-sweeper` via pg_net — Task 12 creates it), tests.

**Interfaces:**
- `cashfree-webhook` (deployed `--no-verify-jwt`): reads **raw** body, verifies signature, handles success → `online_order_confirm_payment`; failed/dropped → `online_order_fail`; refund events → `online_refund_set_status`; on `refund_required` → `cashfree.createRefund` full gateway amount with refundId `AUTO-{ref}`; always 200 after verification; 401 on bad signature.
- `order-status` GET `?ref=` → `{status, paid: boolean}`; if pending, asks `cashfree.getOrder` and applies the same confirm/fail path (so a closed browser + missed webhook still converges).
- After confirm with `result:'confirmed'` both functions call `postPaidActions(ref)` from `_shared/postPaid.ts` (Task 9 fills in Shiprocket create; Task 14 fills in emails); stub now as no-op exported function.

- [ ] Steps: failing tests (valid signature success twice → confirm called twice, function returns 200 both, DB function handles idempotency; bad signature → 401 and no DB call; success for expired order with `refund_required` → refund API called once with `AUTO-` id; order-status pending + Cashfree PAID → confirm), implement, commit `feat(functions): Cashfree webhook and order status`.

### Task 6: Checkout UI behind live switch + order page

**Files:**
- Modify: `src/storefront/pages/CheckoutPage.jsx`, `src/storefront/lib/checkout.js` (shipping text), `src/App.js` (route `/order/:ref`)
- Create: `src/storefront/lib/ordersApi.js` (calls functions via `supabase.functions.invoke`; reads `storefront_settings`), `src/storefront/pages/OrderPage.jsx`, `src/storefront/components/CheckoutSummary.jsx`
- Modify policy: `src/storefront/pages/policies/policyContent.js` SHIPPING "Shipping charges" → "Shipping is free on orders of ₹5,000 and above. Below that, the courier charge for your pincode is shown at checkout before you pay."; update `policyPages.test.jsx` accordingly (the flat-fee test is replaced).
- No new dependency: load `https://sdk.cashfree.com/js/v3/cashfree.js` once via a script tag helper in `ordersApi.js`, `Cashfree({mode})`, `checkout({paymentSessionId, redirectTarget: '_self'})`.
- Tests: `src/storefront/__tests__/CheckoutPage.live.test.jsx`, `OrderPage.test.jsx`

**Interfaces:**
- Consumes Task 4/5 HTTP contracts.
- `ordersApi.getCheckoutLive() -> Promise<boolean>`, `quote(payload)`, `createOrder(payload)`, `orderStatus(ref)`.

- [ ] Steps: failing tests — live false → renders today's WhatsApp CTA and never calls quote; live true → totals come from mocked quote (shipping line shows "₹80"), code box shows "Code applied"/"That code isn't valid"; signed-in with credit 700 shows "Use store credit" input capped at 700; Pay button text "Pay ₹{gatewayAmount}"; `paid:true` response navigates to `/order/WEB-000001` without SDK; OrderPage polls until `paid` then shows "Order confirmed"; `FreeShippingNudge` gets `quote.subtotal − quote.promoDiscount`. Implement, run storefront suite + build, commit `feat(storefront): live checkout with Cashfree behind switch`. PR slice 2 (Tasks 3–6), merge.

---

## Slice 3: Ship

### Task 7: Shiprocket order on payment + courier-status webhook

**Files:** `supabase/functions/_shared/postPaid.ts` (fill Shiprocket part), `supabase/functions/courier-status/index.ts`, `vercel.json` (add rewrite `/hooks/courier-status` → `https://epotsxdugwfhyeiudjox.supabase.co/functions/v1/courier-status`), migration addition if needed for sync columns (`schema/migration_online_orders_sync.sql`), tests.

**Interfaces:**
- `postPaidActions(ref)` → `shiprocket.createOrder` with `order_id = ref`, pickup `Shop`, Prepaid, items at paid value, `sub_total`, dims 32×28×5 cm, `weight = parcelWeightKg`; stores `sr_order_id`, `shipment_id`, sync status `ok|failed` + last error on the order (failure never throws to the webhook).
- `courier-status` (deployed `--no-verify-jwt`): checks `x-api-key === SHIPROCKET_WEBHOOK_TOKEN`, takes AWB from payload, re-fetches `shiprocket.track(awb)`, maps `shipment_status_id` via `mapShipmentStatus`, calls `online_order_apply_tracking`; always 200 when token valid.

- [ ] Steps: failing tests (Shiprocket down → order still paid, sync `failed` recorded; webhook wrong token → 401, no DB call; delivered event → apply_tracking('delivered'); webhook payload status ignored in favour of re-fetched one), implement, commit `feat(functions): Shiprocket order on payment and tracking webhook`. PR slice 3, merge.

---

## Slice 4: Admin

### Task 8: `admin-order-action`

**Files:** `supabase/functions/admin-order-action/index.ts`, tests.

**Interfaces:** POST (admin JWT) `{action, orderId, ...}`:
- `set_availability {itemId, availableQty}` → DB function.
- `process {}` → `online_order_prepare_process`; if `all_unavailable` → refund flow (Task 10 `startRefund(refundId)`), Shiprocket cancel; else if shippable set differs from original → `shiprocket.updateOrder`; then `assignAwb(shipmentId, quotedCourierId)` → `pickup` → `manifest` → `label` → `online_order_mark_packed`; partial failures leave order `paid` with sync error, retry-safe (skips steps whose ids are stored).
- `cancel {reason}` → `online_order_cancel` + `shiprocket.cancel` + `startRefund`.
- `retry_sync {}` → re-runs `postPaidActions` or the incomplete process step.
- `rto_received {}` → `online_order_rto_received` + `startRefund`.
Non-admin JWT → 403.

- [ ] Steps: failing tests (non-admin 403; process with AWB already stored skips assign; label failure leaves `paid` + error; all-unavailable cancels Shiprocket and starts refund), implement, commit.

### Task 9: Online Orders admin page

**Files:** Create `src/admin/pages/OnlineOrdersPage.jsx`, `src/admin/components/onlineOrders/OrderList.jsx`, `OrderDetail.jsx`, `onlineOrdersApi.js`; modify `src/App.js` (route `/admin/online-orders`), `src/admin/components/AdminLayout.js` (nav item "Online Orders" with count of `paid`). Tests in `src/admin/components/onlineOrders/__tests__/`.

**Interfaces:** reads orders via an admin RLS select policy on `orders`, `order_items`, `order_events`, `order_refunds` (add to Task 1 migration: `using (exists (select 1 from profiles where id = auth.uid() and role in ('admin','superadmin')))`); actions via `admin-order-action`.

- [ ] Steps: failing tests — list filters (Paid / Packed / Shipped / Delivered / Problems = sync failed or rto); detail shows money breakdown (subtotal, promo, shipping, credit, voucher, paid online), per-line available qty stepper (0..qty), **Process** disabled until every line has been set, confirm dialog lists units to refund and amount; Cancel needs a reason; Retry shown only when sync error; label and Bill of Supply links when packed; timeline from `order_events`. Implement with existing shadcn/ui components and Sonner toasts (single toast system per audit memory). Run admin tests + build, commit. PR slice 4 (Tasks 8–9), merge.

---

## Slice 5: Refunds, credit, codes

### Task 10: Refund engine + choice page + sweeper

**Files:** `supabase/functions/_shared/refunds.ts` (`startRefund(refundId)`: emails choice link; credit-paid part completes immediately in DB), `supabase/functions/refund-choice/index.ts` (public: `{token, choice}` → `online_refund_choose`; if `original` → `cashfree.createRefund(ref, {refundId, amount: gateway part})`), `supabase/functions/refund-sweeper/index.ts` (scheduled: `online_refund_default_expired()` then Cashfree refunds; then polls `processing` refunds older than 1 h via `getRefund`), storefront `src/storefront/pages/RefundChoicePage.jsx` + route `/refund-choice/:token`, tests.

- [ ] Steps: failing tests (choose credit as guest → page shows voucher code; choose twice → "already chosen"; expired token → message with WhatsApp link; sweeper creates exactly one Cashfree refund per refund id even if run twice — idempotency key = refund id; refund > paid impossible: engine asserts Σ ≤ paid per source before calling Cashfree), implement, commit.

### Task 11: Codes and credit at checkout + policy text

**Files:** `src/storefront/pages/CheckoutPage.jsx` (code box + credit input already wired in Task 6 → ensure states), `src/storefront/pages/policies/policyContent.js` (Returns: refund "to the original payment method, or instant store credit if you choose"; RTO line from spec §6.10; Terms cancellation paragraph same), `src/admin/pages/DiscountPage.js` (checkbox "Valid on website" → `storefront_redeemable`), tests (`policyPages.test.jsx`, DiscountPage test if one exists).

- [ ] Steps: failing tests (Returns page contains "instant store credit if you choose" and "shipping charge is not refundable"; DiscountPage saves `storefront_redeemable`; checkout with voucher larger than due shows "₹X left on your voucher will be emailed to you"), implement, commit. PR slice 5 (Tasks 10–11), merge.

---

## Slice 6: Messages and tracking

### Task 12: Emails

**Files:** `supabase/functions/_shared/emails.ts` (templates: `orderConfirmed`, `shopNewOrder`, `itemsRefundChoice` (with similar-pieces link `SITE_URL/shop?category=...`), `refundCompleted`, `shipped` (tracking link), `delivered`, `voucherIssued`), wire into `postPaid.ts`, refunds, `admin-order-action` (shipped on packed? no: on `shipped` tracking), `courier-status` (shipped/delivered). Tests snapshot subject + key lines.

- [ ] Steps: failing tests (orderConfirmed lists items, total paid, order ref, "We deliver within Uttar Pradesh"; shopNewOrder goes to `GMAIL_USER`; shipped includes AWB link; no email when shopper email empty except shop alert), implement, commit.

### Task 13: Track + account orders

**Files:** `src/storefront/pages/TrackOrderPage.jsx` (ref + phone → `online_order_lookup`), `src/storefront/pages/AccountOrdersPage.jsx` (`my_online_orders`), `src/storefront/components/OrderTimeline.jsx`, tests.

- [ ] Steps: failing tests (wrong phone → "We couldn't find that order"; delivered order shows all steps ticked; account page lists newest first with status badges), implement, run full storefront suite + build, commit. PR slice 6 (Tasks 12–13), merge.

---

## Controller-only steps (main session; never subagents)

1. After slice 1 merge: `npm run migrate`, then run `schema/test_online_orders.sql` via `supabase db query --linked --`; verify `storefront_settings.checkout_live = false`; `npm run probe:anon` still passes.
2. After slices 2–6 merges: `supabase functions deploy <name>` (`--no-verify-jwt` for `cashfree-webhook`, `courier-status`, `refund-choice`, `checkout-quote`, `create-order`, `order-status`); apply cron migration.
3. Going live (owner present): secrets set by owner, Cashfree webhook URL + Shiprocket webhook configured, sandbox end-to-end order (pay, process, refund one unit, both choices), then flip `checkout_live`.
4. Update `tasks/todo.md`, memory, and graphify after each merge.


---

## Revisions (R1–R20) — from Codex adversarial review, 2026-10-23

**Go-live gate (replaces "merge each slice independently" risk):** slices merge independently with `checkout_live=false`, so no money moves until **all** of slices 0–6 and **Slice 1b** are merged, deployed and sandbox-tested. `create-order` refuses while false. This makes slice order safe; the refund engine existing before admin actions still matters for tests, so Task 8 depends on Task 10's `startRefund` (implement Task 10 before Task 8, or stub with a contract test).

**R1 (critical, new Slice 1b, Task 1b): in-store writes become atomic.** In-store `BillingForm.js` read-modify-writes `productsizecolors.stock` (≈ lines 918–1019, 1162–1269), `customers.store_credit` (≈ 461–483, 1408–1416, 1457–1468, 1788–1797) and voucher redemption (≈ 642–680, 1438–1448, 1772–1782). Add DB functions and switch those call sites to them, keeping every visible behaviour identical:
- `stock_adjust(p_variant uuid, p_delta numeric, p_reason text, p_ref text) returns numeric` — `update ... set stock = stock + p_delta ... returning stock` (no floor check for in-store: in-store can legitimately go below what online thinks; keep current semantics, just atomic).
- `store_credit_adjust(p_customer int, p_delta numeric, p_reason text, p_ref text) returns numeric` — atomic, writes `store_credit_ledger` (source `instore`), rounds to 2 dp; raises if result < 0 for negative deltas.
- `voucher_redeem(p_voucher text, p_bill int) returns boolean` — `update vouchers set redeemed=true, redeemed_at=now(), redeemed_billid=p_bill where voucher_id=p_voucher and redeemed=false and held_order_id is null and expiry_date >= current_date`; returns found. In-store voucher lookup also rejects `held_order_id is not null` with message "This voucher is reserved for an online order".
- `customers.store_credit` stays `double precision` (no type migration; existing balances untouched); all new writers round to 2 dp.
- Tests: billing suite (`src/admin/components/billing/__tests__`) stays green; new tests assert BillingForm calls the RPCs with the same deltas it used to write (mock supabase); SQL tests: concurrent `stock_adjust` + `online_order_confirm_payment` on the same variant sum correctly; held voucher cannot be redeemed in store.

**R2 (critical): outbox.** Add `order_jobs(id, order_id, kind, status, attempts, last_error, run_after, unique(order_id, kind))`. `online_order_confirm_payment` inserts `shiprocket_create`, `email_confirmed`, `email_shop` jobs in the same transaction. A `run-jobs` Edge Function (pg_cron every 2 min + called opportunistically by webhook/order-status even when confirm returns `already`) claims jobs with `for update skip locked`, retries with backoff, max 10 attempts then flags the order problem. Replace `postPaidActions` with job handlers.

**R3 (critical): Process checkpoints + claim.** Orders get per-step columns: `sr_updated_at, awb, courier_id, courier_name, pickup_requested_at, manifest_url, label_url, bill_id`, each persisted by `online_order_checkpoint(p_order_id, p_step text, p_data jsonb)` immediately after its external call succeeds. `admin-order-action process` first calls `online_order_claim(p_order_id, p_action text, p_actor uuid, p_op_key text) returns jsonb` which locks the row, moves `paid → processing` (or `paid → cancelling`), and returns the existing operation if `p_op_key` repeats or another action holds it (lease 5 min). Each step is skipped when its checkpoint exists. Failure leaves `processing` with error; Retry resumes. Cancel is only allowed from `paid` (not `processing`). Tests: failure injected after each step, then retry completes without repeating earlier calls; two concurrent claims → one wins.

**R4 (critical): payment confirmation contract.** Confirm only after the Edge Function fetched `cashfree.getOrder(ref)` with `order_status == 'PAID'`, currency INR, `order_amount == orders.gateway_amount`, and `cf_order_id` matching the stored one; the successful payment's `cf_payment_id` is stored with a unique index. `online_order_confirm_payment(p_order_ref, p_cf_payment_id, p_amount, p_currency)` re-checks amount/currency equality and raises otherwise; a mismatch event creates `refund_required` for the full captured amount.

**R5 (critical): failed attempts don't fail the order.** `PAYMENT_FAILED/USER_DROPPED` webhooks only append an `order_events` row. Orders leave `pending_payment` only via (a) confirm, or (b) the expiry job, which for each pending order older than 45 min calls `cashfree.getOrder`: `PAID` → confirm path; `ACTIVE` → wait (until 24 h, then mark problem); `EXPIRED/TERMINATED` → `online_order_fail(..., 'expired')`. A late success on an expired order goes through R4 + the existing re-take-or-refund logic.

**R6 (high): create-order idempotency.** Client sends `attemptKey` (UUID v4 generated when the checkout page mounts, reused on retry). `orders.attempt_key unique`; repeat calls return the same order and session (re-fetching the session via Cashfree Get Order if needed). Cashfree create uses `x-idempotency-key = attemptKey`. On Cashfree timeout/5xx/409 → `getOrder(ref)`; only if Cashfree has no such order → `online_order_fail`.

**R7 (high): ₹1 minimum.** In `quoteOrder`: if `0 < gatewayAmount < 1`, reduce applied credit (then voucher) so `gatewayAmount = 1.00`; if that's impossible (no credit/voucher applied), unchanged. Tests at due−tender = 0, 0.01, 0.99, 1.00.

**R8 (high): identity.** Customer identity for credit and owned vouchers comes **only** from a verified JWT (`supabase.auth.getUser(jwt)` in the Edge Function → `customers.auth_user_id`). Guest phone matching is bookkeeping only (customer row for bill/usage) and never unlocks store credit or customer-owned vouchers. `online_order_create` takes `p_auth_user uuid` (null for guests) and derives everything else. Test: guest using a registered customer's phone gets no credit and can't use their owned voucher.

**R9 (high): code checks.** `online_code_check` is service-role only; Edge Function passes verified identity and a hashed client IP (`x-forwarded-for` first hop, SHA-256 with a server salt). Limits: 10 failed attempts/hour per IP hash and per phone/customer; responses identical for "not found" and "not eligible". Online-issued voucher codes: 16 chars from a 32-char unambiguous alphabet.

**R10 (high): order access.** `create-order` returns `accessToken` (32 random bytes, base64url); DB stores SHA-256 hash. Return URL and order page use `/order/{ref}?t={token}`. `order-status` requires `ref` + token (or a verified JWT that owns the order); rate-limited per IP. `/track` keeps ref + phone via `online_order_lookup` with rate limits. Responses for wrong token/phone are identical to not found.

**R11 (high): JWT + CORS contract.** `_shared/http.ts`: `optionalUser(req)` returns null for absent header and throws 401 for present-but-invalid (verified with `supabase.auth.getUser`); exact match of `Origin` against `ALLOWED_ORIGIN` (comma list) for browser-facing functions, preflight `OPTIONS` handled, no wildcard, no credentials. Webhooks have no CORS. Tests: absent/forged/expired/valid JWT; hostile origin; preflight.

**R12 (high): promo reservation.** `promo_reservations(code, identity_key, order_id, status)` with a unique partial index on `(code, identity_key) where status in ('held','used')` for `once_per_customer` codes; `identity_key` = `c:{customerid}` or `p:{normalized phone}`. Created in `online_order_create`, `used` at confirm, released on expiry/fail. Concurrent creates for the same identity → one succeeds.

**R13 (high): refund legs.** `order_refunds` is the header (reason, units, totals, choice, token, overall status derived). `order_refund_legs(refund_id, source in ('credit','gateway','shipping_gateway','shipping_credit'), amount, status, destination in ('store_credit','voucher','original'), cf_refund_id, voucher_id, unique(refund_id, source))`. Credit issuance per leg is idempotent through `store_credit_ledger` unique `(ref_type, ref_id)`. Cashfree refund call per gateway leg with `refund_id = leg id` (≤ 40 chars). Overall `completed` only when all legs completed. Tests: crash after credit leg, retry doesn't double-credit; Σ legs ≤ paid per source per order (DB check in a trigger or function assertion).

**R14 (high): RTO accounting.** `online_order_rto_received` atomically: inserts one `exchanges` row per shipped, not-yet-refunded bill line (`original_bill_item_id`, `quantity`, `reason='RTO'`, `customerid`, `credit_amount` = refund value, `voucher_id` when the refund goes to a voucher — filled when the leg completes), returns stock for those units via `stock_adjust`, creates the refund (no shipping legs). Only units shipped and not already refunded count. Second call → no-op returning the existing refund id. Tests: partial availability then RTO refunds only shipped units; double RTO; RTO while an earlier refund is still processing.

**R15 (medium): courier problem states.** Store raw `shipment_status_id` + label + time on every tracking update. `mapShipmentStatus` also returns `'problem'` for 12, 21, 24, 25, 40, 41, 46, 76, 78 (per notes table) which sets `orders.problem` text without changing status; admin "Problems" filter includes these. Courier cancellation (8/45) after packing sets problem "Courier cancelled shipment — rebook or cancel", never a business cancel/refund.

**R16 (medium): UP check fail-closed.** Pincodes with 3-digit prefix in {244, 246, 247, 248, 249, 262, 263} (shared with Uttarakhand) require a successful Shiprocket postcode lookup returning "Uttar Pradesh"; if the lookup fails for these → "We couldn't verify this pincode right now, please try again or WhatsApp us" (blocks). Other 20–28 prefixes accept on lookup failure. Shipping rate failure stays flat ₹99 (independent).

**R17 (medium): Shiprocket email.** `billing_email` = shopper email if present else `GMAIL_USER`; shopper email stored separately; missing shopper email skips customer emails without failing anything.

**R18 (medium): rate selection tests.** `shiprocket.rate`: recommended courier if present in `available_courier_companies` and not blocked; else lowest numeric `etd_hours` (ties: lowest rate); parse `rate`/`etd_hours` as numbers; none usable → null. Tests for each case.

**R19 (medium): manifest/label validation.** Manifest success requires `status === 1` and non-empty `manifest_url`, or the documented "already manifested" 400 followed by a successful print/status check; label requires `label_created` truthy and non-empty `label_url`. HTTP-200-with-failure fixtures tested.

**R20: task order for execution.** Wave A (parallel): Task 1 (+ R2/R3/R4/R5/R8/R12/R13/R14 DB parts), Task 2 (+R7), Task 1b (R1). Wave B (parallel, after A merged): Task 3 (+R6 client, R11, R17–R19), Task 9 UI shell against mocked API. Wave C: Tasks 4, 5, 7 (+R2 run-jobs, R5 expiry, R15, R16). Wave D: Task 10 then Task 8, Task 6, Task 11. Wave E: Tasks 12, 13. Controller applies migrations and deploys between waves.

**R21 (as built, Task 2, 2026-10-23): pricing names.** Per-line non-gateway money (voucher + credit combined) is `nonGatewayPart` (no `creditPart`). `refundSplit(line, units, alreadyRefundedUnits = 0)` returns `{ nonGateway, gateway }`. `Quote` also has `amountDue`, `shippingNonGateway`, `shippingGateway` (use these for R13 shipping legs). `allocate` gives leftover paise one each to the largest weights (never more than a part's weight). Category→weight table lives in `_shared/shipping.ts`. Tracking map: shipped 42/6/18/38/22, out_for_delivery 17, delivered 7, rto 9/14/10, cancelled 8/45, problem 12/21/24/25/40/41/46/76/78.
