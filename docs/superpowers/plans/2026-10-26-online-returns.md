# Online Returns (WhatsApp + Admin, v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff open, cancel, receive and refund post-delivery returns (damaged/wrong 48 h, change of mind 7 days) from the admin, with photos, exact stock and refunds that reuse the existing refund machinery.

**Architecture:** New tables and SECURITY DEFINER functions in one migration; refunds go through `_online_refund_create` + `_online_bill_offset` (from the rebook plan); `admin-order-action` gains return and mark-delivered actions and issues signed photo upload URLs for a private Storage bucket; admin order detail gets a Returns section; policy text changes ship in the same release.

**Tech Stack:** Postgres 15 plpgsql (Supabase), Supabase Storage, Deno Edge Functions, React 19 admin + storefront (Jest + RTL).

**Spec:** `docs/superpowers/specs/2026-10-26-online-returns-design.md` (approved 2026-10-26; its final section "Changes from the adversarial review" overrides earlier sections)

**Depends on:** `docs/superpowers/plans/2026-10-26-online-order-unstick-rebook.md` Task 1 (`_online_bill_offset`, `exchanges.order_refund_id`). Build that plan first.

## Global Constraints

- New SQL in `schema/migration_online_returns.sql`; tests in `schema/test_online_returns.sql` (local harness only).
- Function grants as in the rebook plan (service_role only); tables: RLS on, no anon/authenticated policies (all access via `admin-order-action` with the service role).
- Reasons: `damaged_wrong` (window 48 h), `change_of_mind` (window 7 days); window = `contacted_at - delivered_at`.
- Return statuses: `open`, `refunded`, `rejected`, `cancelled`. Order status stays `delivered`.
- Refund reason value: `return`. `exchanges.reason` text: `Return: damaged/wrong` / `Return: change of mind`.
- Shipping refunded only for `damaged_wrong` and only when every shipped unit has been received back across all returns; never for `change_of_mind`.
- Photos: bucket `order-returns`, private; path `<order_id>/<return_id>/<uuid>.<ext>`; types jpeg/png/webp/heic; max 10 MB each; at least one photo required before a `damaged_wrong` return can be received.
- Override outside window: superadmin only, `override_reason` non-blank.
- Any admin: open, cancel, receive, add photos. **Mark delivered: superadmin only**, reason required, `delivered_at` never changed once set, date at most 30 days back.
- Lock order everywhere: `orders` row first, then `bill_items` rows by `bill_item_id` ascending, then `order_returns` row.
- Photo paths are always built by the server from a `returnId`; clients never send paths.

## Review Focus

- Old in-store exchange page open while the online return is received → `exchange_record` refuses (cap) → Task 7.

- Customer contacted inside the window but staff open the return later → allowed without override (window uses `contacted_at`) → test in Task 2.
- A unit exchanged in store while its online return is open → receive refuses with a clear message → test in Task 3.
- Second return on the same order after a first damaged return refunded shipping → shipping not refunded again → test in Task 3.
- Receive pressed twice (double click / two admins) → one refund, second call returns the same refund id → test in Task 3.
- Order delivered but courier webhook missed → Mark delivered sets `delivered_at`, return can then be opened → test in Task 1.

---

### Task 1: Delivery date and Mark delivered

**Files:**
- Create: `schema/migration_online_returns.sql`, `schema/test_online_returns.sql` (fixtures as in `schema/test_online_orders.sql:12-131`)

**Interfaces:**
- Produces: `orders.delivered_at timestamptz`; backfill from the earliest `order_events` row of kind `delivered` per order.
- Produces: re-defined `online_order_apply_tracking` (latest definition, `schema/migration_online_orders.sql:1742-1800`): on first move to `delivered`, `delivered_at := coalesce(<payload delivered timestamp>, now())` where the payload key is `delivered_date` (UNVERIFIED Shiprocket key; parse only if it casts to timestamptz, else `now()`).
- Produces: `public.online_order_mark_delivered(p_order_id uuid, p_actor uuid, p_delivered_at timestamptz, p_reason text) returns jsonb` — from `shipped`/`out_for_delivery` only, `delivered_at` must be null; `p_delivered_at` not in the future, not before `paid_at`, not more than 30 days ago; reason non-blank; sets status, `delivered_at`, event `delivered` with `{manual: true, reason, actor}`, enqueues `email_delivered` like the webhook path. (Superadmin check is in the Edge Function.)

- [ ] **Step 1:** Tests: `tracking delivered sets delivered_at once` (second delivered update keeps the first value); `payload delivered_date used when parseable`; `mark delivered from shipped`; `mark delivered from packed raises`; `future date raises`; `date 31 days back raises`; `blank reason raises`; `already delivered raises`; `backfill` (insert a delivered event for an order without `delivered_at`, run the backfill statement, assert set).
- [ ] **Step 2:** Run harness with all prior migrations + `migration_online_orders_rebook.sql` + this test → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `schema/test_online_orders.sql` still PASS.
- [ ] **Step 5:** Commit `feat(db): delivered_at and manual mark delivered`.

### Task 2: Return tables, returnable units, open/cancel

**Files:**
- Modify: `schema/migration_online_returns.sql`; Test: `schema/test_online_returns.sql`

**Interfaces:**
- Produces tables per spec "Data": `order_returns(id uuid pk, order_id, reason, status, contacted_at, note, return_awb, override_reason, opened_by, opened_at, received_by, received_at, receive_note, refund_id, created_at, updated_at)`, `order_return_items(return_id, item_id, units, received_units, restock_units, primary key (return_id, item_id))`, `order_return_photos(id, return_id, path unique, uploaded_by, uploaded_at)`. `order_refunds.reason` check re-created with `return` added.
- Produces: `public.online_return_returnable(p_order_id uuid) returns table(item_id uuid, units int)` = per spec formula (shipped − open-return units − received units of refunded returns − in-store `exchanges` units on the item's `bill_item_id` where `order_refund_id is null`).
- `online_return_open` locks the order row first, then computes returnable units and inserts in the same transaction.
- Produces: `public.online_return_open(p_order_id uuid, p_actor uuid, p_is_superadmin boolean, p_reason text, p_contacted_at timestamptz, p_items jsonb /* [{item_id, units}] */, p_note text, p_return_awb text, p_override_reason text) returns uuid` — order `delivered` with `delivered_at`; units ≤ returnable; note required; window per Global Constraints, outside → raise `return window closed (% of %)` unless superadmin with override reason; `contacted_at` not in the future and not before `delivered_at`; event `return_opened`.
- Produces: `public.online_return_cancel(p_return_id uuid, p_actor uuid, p_note text) returns void` — `open` only, note required, event `return_cancelled`.

- [ ] **Step 1:** Tests: `returnable = shipped`; `returnable minus open return`; `returnable minus in-store exchange on bill line`; `open inside window by contacted_at even if opened late` (delivered_at = now-3d, contacted_at = now-3d+40h, reason damaged_wrong → ok); `outside window refused for admin`; `outside window allowed for superadmin with override`; `units above returnable raises`; `cancel open → cancelled, units returnable again`; `cancel refunded raises`; concurrency script case (`schema/test_harness/concurrency_test.sh`): two sessions open a return for the same last unit → exactly one succeeds.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): order returns open/cancel and returnable units`.

### Task 3: Receive and refund

**Files:**
- Modify: `schema/migration_online_returns.sql`; Test: `schema/test_online_returns.sql`

**Interfaces:**
- Consumes: `_online_refund_create(order, 'return', units jsonb, include_shipping, actor)`, `_online_bill_offset(refund, reason)`, `_stock_apply`.
- Produces: `public.online_return_receive(p_return_id uuid, p_actor uuid, p_items jsonb /* [{item_id, received_units, restock_units}] */, p_note text) returns jsonb` → `{status, refund_id, refund}`. Locks per Global Constraints. Already `refunded`/`rejected` → returns stored result (idempotent). `received_units ≤ units`, `restock_units ≤ received_units`; note required when any `received_units < units`; `damaged_wrong` requires ≥ 1 photo row. Re-checks `received_units ≤ returnable + this return's units` (in-store exchange race) → raise `item % was exchanged in store; reduce received pieces`. All received = 0 → `rejected`, no refund. Else restock, refund (shipping per Global Constraints), offset bill, `refunded`, event `return_refunded`.

- Produces: `public.online_return_preview(p_return_id uuid, p_items jsonb) returns jsonb` → `{credit_part, gateway_part, shipping, total}` — read-only, same allocation (`_cum_alloc` over `credit_part`/`gateway_part` from current `refunded_qty`) and shipping rule as receive; shared private helper `_online_return_amounts(...)` used by both.

- [ ] **Step 1:** Tests: `preview equals receive amounts on an order with an earlier partial refund and mixed voucher/gateway payment`; `change of mind: product value only, no shipping, stock +restock`; `damaged whole order: shipping included`; `damaged partial: no shipping`; `second damaged return after shipping refunded: no shipping again`; `voucher-paid part completes at once` (order paid with voucher, assert credit leg `completed`); `failed pieces: received 1 of 2 refunds 1, note required`; `nothing passed → rejected, no refund`; `receive twice returns same refund`; `damaged without photo raises`; `in-store exchange meanwhile → raises`; `exchanges rows written with order_refund_id`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run all online test files → PASS.
- [ ] **Step 5:** Commit `feat(db): receive and refund online returns`.

### Task 4: Photo storage

**Files:**
- Modify: `schema/migration_online_returns.sql` (bucket insert into `storage.buckets` with `public = false`, `file_size_limit = 10485760`, `allowed_mime_types` jpeg/png/webp/heic; no storage policies for anon/authenticated)
- Modify: `schema/migration_online_returns.sql`: `public.online_return_photo_path(p_return_id uuid, p_ext text) returns text` (return must exist and be `open`; `p_ext` in jpg/png/webp/heic; returns `<order_id>/<return_id>/<gen_random_uuid()>.<ext>`) and `public.online_return_add_photo(p_return_id uuid, p_path text, p_actor uuid) returns uuid` (return `open`; path must start with that return's prefix and match the issued shape)
- Test: `schema/test_online_returns.sql`

- [ ] **Step 1:** Tests: `photo path for open return has order/return prefix`; `photo path for refunded or unknown return raises`; `add photo with foreign prefix raises`; `add photo to refunded return raises`; `path with .. raises`.
- [ ] **Step 2–4:** FAIL → implement → PASS (bucket row is skipped by the local harness if `storage` schema is absent: guard with `if exists (select 1 from information_schema.schemata where schema_name='storage')`).
- [ ] **Step 5:** Commit `feat(db): return photos bucket and add_photo`.

### Task 5: admin-order-action return actions

**Files:**
- Create: `supabase/functions/_shared/returns.ts` (pure validation + Storage URL helpers)
- Modify: `supabase/functions/admin-order-action/index.ts`, `docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md`
- Test: `supabase/functions/_shared/returns_test.ts`, `supabase/functions/admin-order-action/index_test.ts`

**Interfaces:**
- Produces actions (admin JWT):
  - `mark_delivered {orderId, deliveredAt: ISO string}` → RPC Task 1.
  - `return_open {orderId, reason, contactedAt, items: [{itemId, units}], note, returnAwb?, overrideReason?}` → passes `p_is_superadmin` from `deps.isSuperadmin(user.id)`; `200 {ok, order, returnId}`.
  - `return_photo_url {returnId, contentType}` → maps type to ext, path from RPC `online_return_photo_path`, returns `{uploadUrl, path}` from `storage.from('order-returns').createSignedUploadUrl(path)`.
  - `return_photo_add {returnId, path}` → RPC Task 4 (re-validates the prefix).
  - `return_preview {returnId, items}` → RPC `online_return_preview`.
  - `return_cancel {returnId, note}`, `return_receive {returnId, items: [{itemId, receivedUnits, restockUnits}], note?}` → `200 {ok, order, refundId?}`.
  - `return_photo_view {photoId}` → looks up the stored path by id, `{url}` signed for 10 min.
  - `mark_delivered {orderId, deliveredAt, reason}` → 403 unless `deps.isSuperadmin`.
- `getOrder` response gains `returns` (with items and photo paths) for the order detail.

- [ ] **Step 1:** Tests: input validation (missing note 400, bad reason 400, non-integer units 400, contentType `application/pdf` 400, any `orderId`/`path` field on `return_photo_url` ignored); `return_photo_view` with unknown photoId 404; `mark_delivered` by admin 403; superadmin flag passed true/false; `return_receive` maps camelCase to RPC jsonb; DB raise → `409 bad_state` with the message.
- [ ] **Step 2:** `deno test _shared/returns_test.ts admin-order-action/` → FAIL. **Step 3:** Implement. **Step 4:** `deno test --allow-all .` PASS, lint clean.
- [ ] **Step 5:** Commit `feat(functions): return and mark-delivered admin actions`.

### Task 6: Admin UI: Returns section, dialogs, badges

**Files:**
- Create: `src/admin/components/onlineOrders/ReturnsSection.jsx`, `src/admin/components/onlineOrders/OpenReturnDialog.jsx`, `src/admin/components/onlineOrders/ReceiveReturnDialog.jsx`
- Modify: `src/admin/components/onlineOrders/OrderDetail.jsx` (mount section, Mark delivered button), `orderHelpers.js` (`returnBadge(order) → "Returned" | "Partly returned" | null`, `windowLabel(reason, deliveredAt, contactedAt) → "Day 2 of 7"`), `OrderList.jsx` (badge)
- Test: `src/admin/components/onlineOrders/__tests__/ReturnsSection.test.jsx`, `orderHelpers` tests in existing test files

- [ ] **Step 1:** Tests: `windowLabel` for both reasons incl. outside window; `returnBadge` partly/full; Open dialog caps units at returnable; "Add photos" stays available while the return is open and Receive is disabled for damaged until a photo exists; Receive dialog shows amounts from `return_preview`; override field only for superadmin when outside; Receive dialog shows refund preview and requires note when fewer pieces; Mark delivered only for superadmin on shipped/out_for_delivery, reason required.
- [ ] **Step 2:** `CI=true npx react-scripts test --watchAll=false src/admin/components/onlineOrders` → FAIL. **Step 3:** Implement (upload: `return_photo_url` → `fetch(uploadUrl, {method:'PUT', body: file})` → `return_photo_add`). **Step 4:** PASS, eslint clean.
- [ ] **Step 5:** Commit `feat(admin): online returns section`.

### Task 7: In-store exchange as one locked RPC + window from delivery

**Files:**
- Modify: `schema/migration_online_returns.sql`, `schema/test_online_returns.sql`
- Modify: `src/admin/pages/ExchangePage.js` (`handleLoadBill` `:173-189`: look up `orders.delivered_at` by `bill_id` **before** the window check; `handleConfirm` `:284-340`: replace steps 1–3 with one RPC call)
- Modify: `src/admin/components/billing/exchangeHelpers.js` (`daysSinceBill(orderdate, deliveredAt?)`, `isWithinExchangeWindow(orderdate, deliveredAt?)`)
- Test: existing `exchangeHelpers` tests; `src/admin/pages/__tests__/ExchangePage.test.js` (create if absent, following the repo's RTL + supabase mock pattern)

**Interfaces:**
- Produces: `public.exchange_record(p_billid int, p_customerid int, p_items jsonb /* [{bill_item_id, quantity, credit_amount, reason, product_name, product_code, variantid, manual_item_id}] */) returns int[]` (exchange ids) — `security definer`, callable by `authenticated` admins only (`is_admin()` check inside); locks the online order row if `orders.bill_id = p_billid`, then `bill_items` rows ascending; per item re-checks `sum(exchanges.quantity) + quantity <= bill_items.quantity`, raises `item % already returned (% of %)`; restocks via `_stock_apply` (variants) or `manual_items.stock = stock + qty` (manual); inserts exchanges; all in one transaction.

- [ ] **Step 1:** Tests: SQL `exchange_record caps cumulative qty incl. online return offsets`; `exchange_record restocks variant and manual item atomically` (failing insert rolls back stock); concurrency script case: online receive vs `exchange_record` on the same last unit → exactly one succeeds; helper `online bill: window from delivery` (bill 9 days ago, delivered 3 → within); `in-store bill unchanged`; ExchangePage `nine-day-old online bill delivered three days ago loads`.
- [ ] **Step 2–4:** FAIL → implement → PASS (SQL harness + `CI=true npx react-scripts test --watchAll=false src/admin`).
- [ ] **Step 5:** Commit `feat(billing): atomic exchange_record; online bills exchange window from delivery`.

### Task 8: Policy text (same release)

**Files:**
- Modify: `src/storefront/pages/policies/policyContent.js` (`:34`, `:52-56`, `:66-69`, `:170-173`), `src/storefront/components/home/TrustBar.jsx:13`
- Test: `src/storefront/__tests__/policyPages.test.jsx`

Exact rules to state (spec "Policy text"): damaged/wrong — tell us within 48 h of delivery on WhatsApp or email with photos; we arrange pickup at our cost; full refund incl. shipping when the whole order comes back, else item value; refund after the item reaches us and passes our check. Change of mind — within 7 days of delivery; unused, tags attached, original packaging; you send it back at your cost or bring it to the shop; product price refunded (shipping not); pieces that fail the check are sent back at your cost. No replacement shipments (reorder, or exchange in store within 7 days of delivery with the bill). Custom pieces excluded. Refund to original payment in 5–7 working days or instant store credit, your choice. TrustBar: `7-day returns & exchange`.

- [ ] **Step 1:** Update tests to assert the new key sentences (48 hours, 7 days of delivery, shipping not refunded for change of mind, no "send a replacement").
- [ ] **Step 2–4:** FAIL → edit copy → PASS.
- [ ] **Step 5:** Commit `feat(storefront): returns policy for online orders`.

### Task 9: Ship (main loop, owner-approved steps)

Order matters: the frontend embeds `order_returns` (Online Orders list/detail) and ExchangePage reads `orders.delivered_at` and calls `exchange_record`, so merging (Vercel deploys the frontend) before the migration breaks the Online Orders screens and every in-store exchange. The migration and the function are backward compatible with the current frontend.

- [ ] **Step 1:** `npm run migrate` (owner approval): applies the Plan B rebook migration first if still pending, then `schema/migration_online_returns.sql`. Verify bucket: `supabase db query --linked "select id, public from storage.buckets where id='order-returns'"` → `public = false`; backfill count of `delivered_at`.
- [ ] **Step 2:** Deploy `admin-order-action` (JWT on) and `run-jobs` (`--no-verify-jwt`), both with `--use-api --import-map supabase/functions/deno.json`. `run-jobs` sends the `refund_notify` emails, so without it return refunds keep the "no longer available" wording.
- [ ] **Step 3:** PR, checks, merge (owner approval). Vercel auto-deploys the frontend from main.
- [ ] **Step 4:** Sandbox run: deliver a test order via `online_order_mark_delivered`, open damaged return with photo, receive, refund both choices; record in `docs/testing/`. Rebuild graphify; update `tasks/todo.md`.

## Future phase (not in this plan)

Customer "Request return" page — see spec "Future phase".
