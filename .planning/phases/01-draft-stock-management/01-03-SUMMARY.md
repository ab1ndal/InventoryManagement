---
phase: 01-draft-stock-management
plan: 03
subsystem: billing
tags: [billing, stock, supabase, react, shadcn]

# Dependency graph
requires:
  - phase: 01-draft-stock-management
    plan: 01
    provides: stockHelpers.js with computeStockDelta, buildBillItemsPayload, backCalcDiscountPct
  - phase: 01-draft-stock-management
    plan: 02
    provides: BillingForm save-draft (new path), BillTable with Edit button, applied_codes schema

provides:
  - Draft update with stock reconciliation (delete-and-reinsert bill_items, delta stock apply)
  - Load-for-edit: BillingForm pre-populates from existing bill (customer, items, notes, discount codes)
  - Back-calculation of quickDiscountPct from stored discount_total
  - BillTable status badge using paymentstatus (Draft/Finalized/Cancelled)

affects:
  - phase: 02 (finalize, cancel bill flows will build on this draft lifecycle)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delete-and-reinsert pattern for bill_items update (avoids partial update drift)"
    - "computeStockDelta for atomic stock reconciliation on draft edit"
    - "backCalcDiscountPct for round-trip discount percentage recovery from DB"
    - "Applied codes loaded from DB override auto-apply codes on edit"

key-files:
  created: []
  modified:
    - src/admin/components/billing/BillingForm.js
    - src/admin/components/BillTable.js

key-decisions:
  - "Delete-and-reinsert bill_items on update rather than diffing individual rows — simpler, avoids partial state"
  - "computeStockDelta handles both removed items (restore stock) and added items (subtract stock) atomically"
  - "applied_codes from DB overrides auto-apply codes when editing, preserving original discount intent"

patterns-established:
  - "BillingForm load-for-edit: fetch bill + bill_items, reconstruct form state via backCalcDiscountPct"
  - "Stock delta: computeStockDelta(existingItems, newItems) → validate → delete old → insert new → apply delta"

requirements-completed: [BILL-02, BILL-03, STOCK-02]

# Metrics
duration: 30min
completed: 2026-04-04
---

# Phase 01 Plan 03: Draft Stock Management — Edit & Status Badge Summary

**Draft bill edit with stock reconciliation: load-for-edit populates BillingForm, stock delta computed via computeStockDelta, and BillTable shows Draft/Finalized/Cancelled badges via paymentstatus**

## Performance

- **Duration:** ~30 min (including bug fixes and human verification)
- **Started:** 2026-04-03
- **Completed:** 2026-04-04
- **Tasks:** 3 of 3 (all tasks complete, human verification approved)
- **Files modified:** 2

## Accomplishments

- BillingForm now loads existing bill data (customer, items with back-calculated discounts, notes, applied codes) when opened in edit mode
- Draft update path reconciles stock: fetches old bill_items, computes delta with computeStockDelta, validates available stock, deletes old rows, inserts new rows, applies deltas to productsizecolors
- BillTable replaces the `finalized` text display with a shadcn Badge component driven by `paymentstatus` (Draft = secondary, Finalized = default, Cancelled = destructive)

## Task Commits

1. **Task 1: Draft update with stock reconciliation + Load-for-edit** - `0a0619b` (feat)
2. **Task 2: BillTable status badge and paymentstatus query** - `c1f8604` (feat)
3. **Bug fix: productid field mapping and resilient applied_codes load** - `53ea491` (fix)
4. **Bug fix: account for reserved stock when editing a draft bill item** - `a495eea` (fix)
5. **Task 3: End-to-end verification** - approved by human (no code changes)

## Files Created/Modified

- `src/admin/components/billing/BillingForm.js` — Added load-for-edit useEffect, full draft-update path with computeStockDelta
- `src/admin/components/BillTable.js` — Badge import, paymentstatus in select query, Badge status cell

## Decisions Made

- Delete-and-reinsert pattern for bill_items update (avoids partial update drift)
- applied_codes from DB overrides auto-apply discount codes when editing a draft

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed productid field mapping in load-for-edit**
- **Found during:** Task 3 (human verification)
- **Issue:** BillingForm load-for-edit was not mapping the `productid` field from `bill_items`, causing incorrect item identification when editing
- **Fix:** Added correct `productid` field mapping during item reconstruction in `loadBill`
- **Files modified:** `src/admin/components/billing/BillingForm.js`
- **Committed in:** `53ea491`

**2. [Rule 1 - Bug] Fixed applied_codes load to be resilient to null/missing values**
- **Found during:** Task 3 (human verification)
- **Issue:** `applied_codes` load would error or misbehave when the field was null or not yet populated on older bills
- **Fix:** Added null-safe guard so applied_codes only overrides auto-apply codes when the value is a non-empty array
- **Files modified:** `src/admin/components/billing/BillingForm.js`
- **Committed in:** `53ea491`

**3. [Rule 1 - Bug] Accounted for reserved stock when editing a draft bill item**
- **Found during:** Task 3 (human verification)
- **Issue:** Stock validation for draft edit was checking raw `stock` from `productsizecolors` without accounting for the fact that the current draft already has some of that stock reserved — this caused false "insufficient stock" errors when keeping or increasing quantities on an item already in the draft
- **Fix:** When computing available stock for validation, the delta-based check correctly uses `current_stock + delta >= 0`, which implicitly accounts for the existing reservation. Verification confirmed this logic is correct.
- **Files modified:** `src/admin/components/billing/BillingForm.js`
- **Committed in:** `a495eea`

---

**Total deviations:** 3 auto-fixed (all Rule 1 - Bug, discovered during human verification)
**Impact on plan:** All fixes were necessary for correct end-to-end behavior. No scope creep.

## Issues Encountered

Pre-existing test failure: `src/App.test.js` fails with "Cannot find module 'react-router-dom'" — this is unrelated to our changes, pre-existed before this plan, and is out of scope per deviation rules. All 17 business-logic tests (billUtils + stockDelta) pass.

## User Setup Required

**Manual step required before end-to-end testing:**
Run `schema/migration_01_applied_codes.sql` in the Supabase dashboard SQL editor to add the `applied_codes text[]` column to the `bills` table.

## Next Phase Readiness

- Phase 1 complete — draft create, edit, stock management, and status badges all implemented and verified by human
- All 6 verification steps approved: new draft save, stock decrement, edit pre-population, draft update with stock reconciliation, BillTable Draft badge, out-of-stock error toast
- Phase 2 (Form Polish & Schema Additions) can begin: fix dropdown opacity, complete manual items, add salesperson support

## Self-Check: PASSED

- `src/admin/components/billing/BillingForm.js` — exists and contains all required patterns
- `src/admin/components/BillTable.js` — exists and contains Badge, paymentstatus
- Commits 0a0619b, c1f8604, 53ea491, a495eea all exist in git log
- Human verification approved all 6 end-to-end criteria

---
*Phase: 01-draft-stock-management*
*Completed: 2026-04-04*
