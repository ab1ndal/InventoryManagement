---
phase: 01-draft-stock-management
verified: 2026-04-03T00:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
human_verification:
  - test: "End-to-end draft lifecycle — create, edit, re-save"
    expected: "New bill creates bills + bill_items rows, stock decrements. Edit loads form correctly. Draft update reconciles stock. BillTable shows Draft badge."
    why_human: "Requires Supabase connection and browser interaction. Schema migration must be applied first (schema/migration_01_applied_codes.sql)."
  - test: "Out-of-stock error toast"
    expected: "Entering a quantity exceeding available stock shows a toast with item name, size/color, requested vs available"
    why_human: "Requires live Supabase stock data to trigger"
---

# Phase 1: Draft Stock Management Verification Report

**Phase Goal:** Implement the complete draft bill lifecycle — create draft, update draft with stock reconciliation, load-for-edit, and BillTable status badge.
**Verified:** 2026-04-03
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Schema migration file exists with correct ALTER TABLE statement | VERIFIED | `schema/migration_01_applied_codes.sql` contains `ALTER TABLE public.bills ADD COLUMN applied_codes text[] DEFAULT '{}'` |
| 2 | Unit tests for billUtils pure functions exist and pass | VERIFIED | `billUtils.test.js` has 10 `it()` blocks; all 17 tests pass |
| 3 | Unit tests for stock delta computation exist and pass | VERIFIED | `stockDelta.test.js` has 7 `it()` blocks; all pass |
| 4 | Stock delta helper is extracted as a pure testable function | VERIFIED | `stockHelpers.js` exports `computeStockDelta`, `buildBillItemsPayload`, `backCalcDiscountPct` |
| 5 | Clicking Save Draft inserts a bills row with paymentstatus='draft' and finalized=false | VERIFIED | `BillingForm.js` lines 280-294: `.from("bills").insert({..., paymentstatus: "draft", finalized: false, applied_codes: selectedCodes})` |
| 6 | bill_items rows are inserted for each item in the form | VERIFIED | `BillingForm.js` line 298: `buildBillItemsPayload(bill.billid, items)` then `.from("bill_items").insert(billItemsPayload)` |
| 7 | Stock is decremented in productsizecolors for each inventory item | VERIFIED | `BillingForm.js` lines 306-315: loop over inventoryItems, `.from("productsizecolors").update({ stock: currentStock - it.quantity })` |
| 8 | Save is blocked with error toast if any item qty exceeds available stock (D-01) | VERIFIED | `BillingForm.js` lines 265-276: outOfStock filter + `toast({ title: "Insufficient stock" })` |
| 9 | Editing a draft bill loads customer, items, notes, and applied discounts into BillingForm | VERIFIED | `BillingForm.js` lines 83-138: `loadBill` useEffect fetches bills + bill_items when `open && billId`; sets customer, notes, items, selectedCodes |
| 10 | Saving an edited draft reconciles stock — old quantities restored, new quantities subtracted | VERIFIED | `BillingForm.js` lines 149-244: fetches existingItems, calls `computeStockDelta`, validates final stock >= 0, delete-and-reinsert pattern, applies deltas |
| 11 | BillTable shows a status badge (Draft/Finalized/Cancelled) based on paymentstatus (D-03) | VERIFIED | `BillTable.js` lines 108-113: `<Badge variant={...}>` with ternary for finalized/cancelled/Draft |
| 12 | BillingPage passes billId={activeBillId} to BillingForm | VERIFIED | `BillingPage.js` line 40: `billId={activeBillId}` |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `schema/migration_01_applied_codes.sql` | applied_codes column migration | VERIFIED | Contains correct ALTER TABLE statement |
| `src/admin/components/billing/__tests__/billUtils.test.js` | Unit tests for computeBillTotals, priceItem, normalizeItem | VERIFIED | 10 test cases, 123 lines, imports from both `billUtils` and `stockHelpers` |
| `src/admin/components/billing/__tests__/stockDelta.test.js` | Unit tests for stock delta map computation | VERIFIED | 7 test cases, 77 lines, imports `computeStockDelta` from `stockHelpers` |
| `src/admin/components/billing/stockHelpers.js` | Extracted computeStockDelta and buildBillItemsPayload helpers | VERIFIED | 77 lines, exports all 3 functions, imports `priceItem` from `./billUtils` |
| `src/admin/components/billing/BillingForm.js` | handleSaveDraft for new + update; load-for-edit useEffect | VERIFIED | 441 lines; both new-draft and update paths implemented |
| `src/admin/components/BillTable.js` | Status badge column using paymentstatus | VERIFIED | Badge import present, paymentstatus in query, badge rendered per status |
| `src/admin/pages/BillingPage.js` | billId prop wired to BillingForm | VERIFIED | `billId={activeBillId}` at line 40 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `BillingForm.js` | `stockHelpers.js` | `import { buildBillItemsPayload, computeStockDelta, backCalcDiscountPct }` | WIRED | Line 3 of BillingForm.js |
| `BillingForm.js` | supabase bills | `from("bills").insert` (new) / `from("bills").update` (edit) | WIRED | Lines 281, 213 |
| `BillingForm.js` | supabase bill_items | `from("bill_items").insert` / `select` / `delete` | WIRED | Lines 299, 103, 204 |
| `BillingForm.js` | supabase productsizecolors | `.from("productsizecolors").update({ stock: ... })` | WIRED | Lines 308-316 (new), 232-237 (update) |
| `BillingPage.js` | `BillingForm.js` | `billId={activeBillId}` prop | WIRED | Line 40 of BillingPage.js |
| `billUtils.test.js` | `billUtils.js` | `import { computeBillTotals, priceItem, normalizeItem }` | WIRED | Line 1 of test file |
| `stockDelta.test.js` | `stockHelpers.js` | `import { computeStockDelta }` | WIRED | Line 1 of test file |
| `BillTable.js` | supabase bills | `select(...paymentstatus...)` | WIRED | Line 26 of BillTable.js |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `BillingForm.js` (load-for-edit) | `items`, `selectedCustomerId`, `selectedCodes` | supabase `bills` + `bill_items` queries in `loadBill` useEffect | Yes — real DB queries with `.eq("billid", billId)` | FLOWING |
| `BillTable.js` | `bills` array | supabase `bills` query in `loadBills` useEffect | Yes — real DB query with `.select("billid, ..., paymentstatus")` | FLOWING |
| `BillingForm.js` (save draft) | `computed.grandTotal`, `selectedCodes` | `useMemo` over `items` state + `computeBillTotals` | Yes — derived from form item state | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests pass (billUtils + stockDelta) | `npm test -- --watchAll=false --testPathPattern="billUtils\|stockDelta"` | 17 tests passed, 0 failed | PASS |
| stockHelpers.js exports all 3 functions | `node -e "const m = require('./src/admin/components/billing/stockHelpers.js'); console.log(typeof m.computeStockDelta, typeof m.buildBillItemsPayload, typeof m.backCalcDiscountPct)"` | Not runnable directly (ESM imports) | SKIP — verified via test suite pass |
| migration SQL contains correct statement | `grep "ALTER TABLE" schema/migration_01_applied_codes.sql` | Matches | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BILL-01 | 01-01, 01-02 | User can save a new bill as Draft | SATISFIED | `handleSaveDraft` new-draft path: inserts bills + bill_items with `paymentstatus='draft'` |
| BILL-02 | 01-01, 01-03 | User can update an existing Draft bill | SATISFIED | `handleSaveDraft` update path: delete-and-reinsert bill_items, update bills row, reconcile stock |
| BILL-03 | 01-01, 01-03 | User can load an existing bill into BillingForm | SATISFIED | `loadBill` useEffect populates all form state when `billId` is set |
| STOCK-01 | 01-01, 01-02 | Saving a Draft subtracts quantity from productsizecolors.stock | SATISFIED | New-draft save loop decrements stock for each variantid item |
| STOCK-02 | 01-01, 01-03 | Updating a Draft reconciles stock | SATISFIED | `computeStockDelta` + per-variant stock update in update path |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `BillingForm.js` | 332 | `// TODO: finalize bill in supabase` inside `handleFinalize` | Info | Not a Phase 1 gap — BILL-04 (Finalize) is assigned to Phase 3. The Finalize button is present in the UI but not functional yet. |

No blockers or warnings found. The `handleFinalize` stub is intentional: the Finalize button is rendered (Phase 1 renders it), but the implementation is deferred to Phase 3 per REQUIREMENTS.md.

---

### Human Verification Required

#### 1. End-to-end draft lifecycle

**Test:** Apply `schema/migration_01_applied_codes.sql` in Supabase dashboard. Open `http://localhost:3000/admin/billing`. Create a new bill with customer, 2 inventory items, a discount code, and notes. Click Save Draft.
**Expected:** Toast shows "Draft saved — Bill #[id]". BillTable shows a "Draft" badge. Supabase `bills` row has `paymentstatus='draft'`, `finalized=false`, `applied_codes` populated. `bill_items` rows exist. Stock decremented in `productsizecolors`.
**Why human:** Requires live Supabase connection and browser. Migration must be applied first.

#### 2. Load-for-edit and draft update

**Test:** Click Edit on the saved draft bill. Verify form is pre-populated with customer, items, notes, and applied discount codes. Item quick-discount percentages should match original values. Change item quantity, remove one item. Click Save Draft.
**Expected:** Form loads correctly. After update: old stock quantities are restored, new quantities subtracted. Supabase `bill_items` reflects the new items only.
**Why human:** Requires live Supabase data and visual confirmation of form state.

#### 3. Out-of-stock blocking

**Test:** Attempt to save a draft where one item quantity exceeds the variant's current stock.
**Expected:** Error toast with message including item name, size/color, requested vs available quantity. Bill is NOT saved.
**Why human:** Requires controlling available stock in Supabase to set up the scenario.

---

### Gaps Summary

No gaps found. All 12 observable truths are verified. All 7 required artifacts exist and are substantively implemented. All key links are wired. Data flows from real Supabase queries. Unit tests (17 cases) pass. The only stub present — `handleFinalize` — is an intentional deferral to Phase 3, explicitly out of scope for Phase 1.

The implementation exceeds the plan spec in two small ways:
1. `loadBill` fetches `applied_codes` in a separate resilient query (so the form still works if the migration hasn't been applied yet), rather than in the same select.
2. Reconstructed items include a `source` field (`"inventory"` vs `"manual"`) not in the plan spec, which is additive and not harmful.

---

_Verified: 2026-04-03_
_Verifier: Claude (gsd-verifier)_
