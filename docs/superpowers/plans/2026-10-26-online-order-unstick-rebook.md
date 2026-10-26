# Online Orders Un-stick and Rebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can send an order stuck in `processing` back to To-check, and rebook a packed/shipped order the courier cancelled or lost, with exact stock, refunds and one Bill of Supply.

**Architecture:** All state and money changes are new or extended SECURITY DEFINER plpgsql functions in one new migration. Every Process write is fenced by the order's `op_key`. Send back and Rebook are two-phase (claim → Shiprocket cancel → finalize) through `supabase/functions/_shared/process.ts`; `admin-order-action` exposes them; the admin order detail gets two buttons and a dialog.

**Tech Stack:** Postgres 15 plpgsql (Supabase), Deno Edge Functions (TypeScript), React 19 admin (Jest + RTL).

**Spec:** `docs/superpowers/specs/2026-10-26-online-order-unstick-rebook-design.md` (approved 2026-10-26; its final section "Changes from the adversarial review" overrides earlier sections)

## Global Constraints

- New SQL goes in `schema/migration_online_orders_rebook.sql`; never edit existing `schema/*.sql` table files or earlier migrations (CLAUDE.md). Changed functions are re-defined in full with `create or replace` (drop first when the signature changes, and re-grant).
- New/changed functions: `security definer`, `set search_path = public`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role` (as `schema/migration_online_orders_ship.sql`).
- `order_items.stock_taken` = units the shop currently holds for the order. Both finalize functions end with per item `available_qty := null`, `shipped_qty := 0`.
- Fence: any write made on behalf of an operation (`online_order_checkpoint` Process steps, `online_order_mark_packed`, `online_order_send_back`, `online_order_rebook`) raises `stale operation` unless `orders.op_key = p_op_key`.
- `orders.op_action` allowed values: `process`, `cancel`, `send_back`, `rebook`.
- Shiprocket order id: attempt 1 = bare `order_ref`; attempt n ≥ 2 = `<order_ref>-<n>` (`orders.sr_attempt int not null default 1`).
- Failed or ambiguous Shiprocket cancel → stop, order stays claimed, problem `Cancel AWB <awb> / Shiprocket order <id> in Shiprocket dashboard` (omit null parts). Finalizing without an API cancel needs a superadmin and `manualCancelConfirmed: true`.
- `REBOOK_API_CANCEL` function secret: unless `on`, Rebook never calls the cancel-by-AWB API and always needs the superadmin manual confirmation (stays off until the call is verified on real Shiprocket).
- Rebook from `packed`, `shipped`, `out_for_delivery` only; note required. Send back from `processing` + `op_action = 'process'` + `op_lease_until < now()` only.
- Any admin may start `send_back` / `rebook`; only the manual-cancel confirmation needs superadmin.
- SQL tests: local harness only (`scripts/test-db.sh`), never against prod.

## Review Focus

- Old Process worker writes a checkpoint after Send back took over → `stale operation` → Task 2.
- Delivery webhook arrives while a Rebook is claimed → raw status stored, order status unchanged → Task 2.
- RTO after this change never writes a Shipping offset row → Task 1.
- `_online_bill_offset` called twice concurrently → one set of rows (unique index) → Task 1 (two-session test in `schema/test_harness/concurrency_test.sh` style).
- Cancel after send-back puts back only held units; Cancel after a lost-parcel rebook offsets the bill incl. shipping → Tasks 3–4.

---

### Task 1: Bill-offset helper (RTO moved onto it, unchanged)

**Files:**
- Create: `schema/migration_online_orders_rebook.sql`, `schema/test_online_orders_rebook.sql` (fixture helpers copied from `schema/test_online_orders.sql:12-131`; run line lists all online migrations + this file)
- Modify: `schema/test_harness/concurrency_test.sh` (add the two-session offset case)

**Interfaces:**
- Produces: columns `exchanges.order_refund_id uuid`, `exchanges.order_item_id uuid`; unique index `(order_refund_id, order_item_id) where order_item_id is not null`; unique partial index `(order_refund_id) where order_refund_id is not null and order_item_id is null` (the shipping row).
- Produces: `public._online_bill_offset(p_refund uuid, p_reason text, p_include_shipping boolean) returns void` — no-op without `bill_id`; one `exchanges` row per `order_refund_items` row (fields as `online_order_rto_received`, `schema/migration_online_orders.sql:1838-1852`, plus the two new ids), `on conflict do nothing`, then sets `order_refund_items.exchange_id`; when `p_include_shipping` and the refund has `shipping_gateway`/`shipping_credit` legs, one row against the bill's Shipping `bill_items` line (`:1625-1634`) worth their sum.
- Produces: `online_order_rto_received` re-defined to call `_online_bill_offset(v_refund, 'RTO', false)`.

- [ ] **Step 1:** Tests: `offset items + shipping once` (call twice → row count unchanged); `RTO writes no shipping offset row`; concurrency script case: two sessions call the helper for the same refund → exactly items+1 rows.
- [ ] **Step 2:** `scripts/test-db.sh up && scripts/test-db.sh sql schema/migration_atomic_shared_writes.sql schema/migration_online_orders.sql schema/migration_online_orders_r7.sql schema/migration_online_orders_refunds.sql schema/migration_online_orders_ship.sql schema/test_online_orders_rebook.sql` → FAIL.
- [ ] **Step 3:** Implement in `schema/migration_online_orders_rebook.sql`.
- [ ] **Step 4:** Add the migration to the run line → PASS; `schema/test_online_orders.sql`, `schema/test_online_orders_refunds.sql`, `schema/test_online_orders_ship.sql` → PASS; concurrency script → PASS.
- [ ] **Step 5:** Commit `feat(db): idempotent _online_bill_offset; RTO uses it`.

### Task 2: Operation fencing and admin-op claims

**Files:**
- Modify: `schema/migration_online_orders_rebook.sql`, `schema/test_online_orders_rebook.sql`, existing SQL tests that call `online_order_checkpoint` / `online_order_mark_packed` (`pg_temp.pack` in `schema/test_online_orders.sql:123-130` passes `'op-pack'`)
- Modify: `supabase/functions/_shared/process.ts` (`checkpoint` closure `:382-383`, `mark_packed` call `:448`, renew lease before each `ext(...)`), `supabase/functions/_shared/process_fakes.ts`
- Test: `supabase/functions/_shared/process_test.ts`

**Interfaces:**
- Produces: `online_order_checkpoint(p_order_id uuid, p_step text, p_data jsonb, p_op_key text default null)` — for steps `sr_update, awb, pickup, manifest, label, sr_cancelled` requires `p_op_key = o.op_key`; other steps unchanged (webhook/job callers pass null). New step `sr_cancelled` stores `{at, awb, sr_order_id}` in the event and is idempotent.
- Produces: `online_order_mark_packed(p_order_id uuid, p_shipment jsonb, p_actor uuid, p_op_key text)` — fenced.
- Produces: `online_order_claim` re-defined: action `send_back` (target status stays `processing`; requires `op_action = 'process'` and `op_lease_until < now()`, replaces `op_key`, sets `op_action = 'send_back'`); action `rebook` (from `packed/shipped/out_for_delivery`, status unchanged, sets `op_key/op_action/op_actor/lease`); same-key call resumes. `op_action` check constraint re-created with the four values.
- Produces: `online_order_apply_tracking` re-defined: when `op_action = 'rebook'`, store raw tracking fields and event, return `{matched: true, changed: false, held: true}`.
- Produces (TS): `runProcess` passes `opKey` to every checkpoint and `mark_packed`; before each Shiprocket call it calls `online_order_claim(order, 'process', actor, opKey)` and stops with `{kind: "busy"}` if not claimed.

- [ ] **Step 1:** SQL tests: `old worker checkpoint after send_back claim → stale operation`; `mark_packed with wrong key raises`; `send_back claim refused while lease live`; `rebook claim from shipped keeps status`; `tracking delivered during rebook claim → held, status shipped`. Deno: `runProcess renews claim before AWB call`, `runProcess stops when renewal not claimed`.
- [ ] **Step 2:** Run SQL + `cd supabase/functions && deno test _shared/process_test.ts` → FAIL.
- [ ] **Step 3:** Implement; update `pg_temp.pack` and fakes for the new parameter.
- [ ] **Step 4:** All SQL test files + `deno test --allow-all .` → PASS.
- [ ] **Step 5:** Commit `feat(db,functions): fence Process writes by op_key; claim send_back/rebook`.

### Task 3: Send back finalize (SQL)

**Files:** Modify `schema/migration_online_orders_rebook.sql`; Test `schema/test_online_orders_rebook.sql`

**Interfaces:**
- Produces: column `orders.sr_attempt int not null default 1`.
- Produces: `public.online_order_send_back(p_order_id uuid, p_actor uuid, p_op_key text) returns jsonb` → `{status, old_sr_order_id, old_awb}`. Requires `op_action = 'send_back'` and fence; refuses unless the order has no Shiprocket ids, or checkpoint `sr_cancelled` exists for this op, or `orders.manual_cancel_confirmed_by` (new nullable uuid, set by Task 6 superadmin path) is set. Clears fields (spec G1), `sr_attempt += 1`, `problem := null`, per item `stock_taken := coalesce(available_qty, stock_taken)`, `available_qty := null`, `shipped_qty := 0`, `op_* := null`, status `paid`, event `sent_back`. Already `paid` with no op → returns current (idempotent).

- [ ] **Step 1:** Tests: `finalize refused without sr_cancelled`; `clears shipment, keeps refund, sr_attempt 2` (2 units, 1 unavailable refunded first); `send back then cancel: only held unit back to stock`; `send back then second check refunds only newly missing; all missing → cancelled with shipping`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(db): online_order_send_back`.

### Task 4: Rebook finalize + bill-aware cancel and shelf check (SQL)

**Files:** Modify `schema/migration_online_orders_rebook.sql`; Test `schema/test_online_orders_rebook.sql`

**Interfaces:**
- Consumes: `_online_bill_offset` (Task 1), fence/claim (Task 2), `sr_attempt` (Task 3).
- Produces: column `order_items.lost_qty int not null default 0`.
- Produces: `public.online_order_rebook(p_order_id uuid, p_actor uuid, p_op_key text, p_parcel_lost boolean, p_note text) returns jsonb` → `{status, refund_id, old_sr_order_id, old_awb}`. Requires `op_action = 'rebook'`, fence, same cancel evidence rule as Task 3, note non-blank. Still at shop: `stock_taken := shipped_qty`. Lost: `lost_qty += shipped_qty`; per item in `order by variantid, line_no`, `n := least(shipped_qty, greatest(floor(stock),0))`, `_stock_apply(v, -n)`, `stock_taken := n`; units not replaced → `_online_refund_create(o, 'unavailable', units, <nothing left to send>, actor)` + `_online_bill_offset(refund, 'Rebook: not re-sent', <nothing left to send>)`. Then clearing as Task 3; status `paid`, or `cancelled` when nothing is left to send. Event `rebooked`.
- Produces: `online_order_prepare_process` re-defined: after `_online_refund_create`, when `bill_id` set → `_online_bill_offset(v_refund, 'Rebook: unavailable', v_all)`.
- Produces: `online_order_cancel` re-defined: when `bill_id` set → `_online_bill_offset(v_refund, 'Cancel after rebook', true)`. Stock maths unchanged.

- [ ] **Step 1:** Tests: `rebook still at shop: paid, stock unchanged, one bill after re-pack`; `rebook lost with stock: replacement taken, lost_qty`; `rebook lost without stock: cancelled, refund incl shipping, item + shipping offsets`; `cancel after lost rebook: stock back = replacement only, bill offset incl shipping`; `second shelf check after rebook: offset item, no shipping`; `old AWB ignored after rebook`; `rebook from delivered raises`; `blank note raises`.
- [ ] **Step 2–4:** FAIL → implement → PASS (all online SQL test files).
- [ ] **Step 5:** Commit `feat(db): online_order_rebook; bill-aware cancel and shelf check`.

### Task 5: Shiprocket client: cancel by AWB, attempt suffix

**Files:**
- Modify: `supabase/functions/_shared/shiprocket.ts` (client type `:85-96`, impl near `cancel` `:413`), `supabase/functions/_shared/process.ts` (`OrderRow` `:58`, `buildSrInput` `:225-240`), `supabase/functions/_shared/process_fakes.ts`
- Modify: `docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md` (cancel-by-AWB entry, UNVERIFIED)
- Test: `supabase/functions/_shared/shiprocket_test.ts`, `supabase/functions/_shared/process_test.ts`

**Interfaces:**
- Produces: `ShiprocketClient.cancelAwbs(awbs: string[]): Promise<void>` → `POST /orders/cancel/shipment/awbs` body `{ awbs }`; any non-2xx or unexpected body throws; empty list → no call.
- Produces: `OrderRow.sr_attempt: number`; exported `srOrderRef(o: OrderRow): string` (`-<n>` from attempt 2); `buildSrInput` uses it (create and update).

- [ ] **Step 1:** Tests: `cancelAwbs posts awbs`, `cancelAwbs([]) no call`, `cancelAwbs throws on 4xx`, `buildSrInput -2 on second attempt`, `bare ref on first attempt`.
- [ ] **Step 2–4:** `deno test _shared/shiprocket_test.ts _shared/process_test.ts` FAIL → implement → PASS; lint clean.
- [ ] **Step 5:** Commit `feat(functions): Shiprocket cancel by AWB; attempt-suffixed order id`.

### Task 6: runSendBack / runRebook + admin-order-action

**Files:**
- Modify: `supabase/functions/_shared/process.ts`, `supabase/functions/admin-order-action/index.ts` (contract `:1-14`, switch `:97`), `docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md`
- Test: `supabase/functions/_shared/process_test.ts`, `supabase/functions/admin-order-action/index_test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `runSendBack(deps: ShipDeps, orderId: string, actor: string, opKey: string, manualCancelConfirmed: boolean): Promise<AdminOpOutcome>` and `runRebook(deps: ShipDeps, orderId: string, actor: string, opKey: string, parcelLost: boolean, note: string, manualCancelConfirmed: boolean, apiCancel: boolean): Promise<AdminOpOutcome>` where `AdminOpOutcome = {kind: "done"; status: string; refundId: string | null} | {kind: "cancel_failed"; problem: string} | {kind: "busy"} | {kind: "bad_state"; status: string}`. Steps: claim (`send_back`/`rebook`) → if no `sr_cancelled` checkpoint and the order has Shiprocket ids: when `manualCancelConfirmed` → RPC `online_order_confirm_manual_cancel(order, actor, op_key)` (sets `manual_cancel_confirmed_by`); else when allowed to call the API (`send_back` always, `rebook` only if `apiCancel`) → `cancelAwbs([awb])` or `cancel([sr_order_id])` then checkpoint `sr_cancelled`; on error → set problem, return `cancel_failed` → finalize RPC.
- Produces: actions `send_back {orderId, opKey, manualCancelConfirmed?}` and `rebook {orderId, opKey, parcelLost, note, manualCancelConfirmed?}`; `manualCancelConfirmed: true` requires `deps.isSuperadmin` (403 otherwise); `cancel_failed` → `502 courier_error` with the problem text; `apiCancel` read from env `REBOOK_API_CANCEL === "on"`.

- [ ] **Step 1:** Tests: `send_back cancels AWB, checkpoints, finalizes`; `send_back retry with same key skips cancel after sr_cancelled`; `cancel failure → cancel_failed, not finalized`; `manual confirm by admin → 403`; `manual confirm by superadmin finalizes without API`; `rebook with REBOOK_API_CANCEL off and no confirm → cancel_failed message asks for manual confirmation`; `rebook note required (400)`; `parcelLost must be boolean (400)`.
- [ ] **Step 2–4:** FAIL → implement → `deno test --allow-all .` PASS; lint clean.
- [ ] **Step 5:** Commit `feat(functions): send_back and rebook admin actions`.

### Task 7: Admin UI

**Files:** Modify `src/admin/components/onlineOrders/OrderDetail.jsx`; Test `src/admin/components/onlineOrders/__tests__/OrderDetail.test.jsx`

**Interfaces:** Consumes `action(payload)` (`src/admin/components/onlineOrders/onlineOrdersApi.js:146`) and `newOpKey()` (`:142`); keep one op key per dialog session so a retry resumes.

- [ ] **Step 1:** Tests: `Send back shown on processing order with error and expired lease`; `hidden on packed`; `Rebook on shipped requires note`; `parcel lost sends parcelLost true`; `courier_error shows problem text and, for superadmin only, "I cancelled it in Shiprocket" which resends with manualCancelConfirmed`; `confirmation text "Refunds already made stay"`.
- [ ] **Step 2:** `CI=true npx react-scripts test --watchAll=false src/admin/components/onlineOrders` → FAIL.
- [ ] **Step 3:** Implement with existing shadcn `Dialog`/`Button`/`RadioGroup` and the existing toast pattern. Copy: Send back — "Cancels the courier booking (AWB <awb>) and returns this order to To-check. Refunds already made stay." Rebook — "Cancels AWB <awb>. Parcel still at shop: re-send the same pieces. Parcel lost: take new pieces from stock; anything we can't replace is refunded."
- [ ] **Step 4:** PASS; `npx eslint src/admin/components/onlineOrders` clean.
- [ ] **Step 5:** Commit `feat(admin): send back and rebook online orders`.

### Task 8: Ship (main loop, owner-approved steps)

- [ ] **Step 1:** Push, PR, checks, merge (owner approval).
- [ ] **Step 2:** `npm run migrate` (owner approval). Verify: `supabase db query --linked "select proname from pg_proc where proname in ('online_order_send_back','online_order_rebook','_online_bill_offset')"` → 3 rows.
- [ ] **Step 3:** Deploy `admin-order-action` (JWT on) and every function importing `_shared/process.ts` (`run-jobs`, `courier-status`) with `--use-api --import-map supabase/functions/deno.json`. Leave `REBOOK_API_CANCEL` unset.
- [ ] **Step 4:** After Shiprocket is live: sandbox S7 (fail Process → Send back → Process) and verify cancel-by-AWB on a real shipment; only then set `REBOOK_API_CANCEL=on`. Update `tasks/todo.md`, `docs/testing/`, graphify; commit.
