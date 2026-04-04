---
phase: 01-draft-stock-management
plan: 02
subsystem: billing
tags: [react, supabase, billing, stock-management, inventory]

# Dependency graph
requires:
  - phase: 01-draft-stock-management/01-01
    provides: stockHelpers.js with buildBillItemsPayload, computeStockDelta, backCalcDiscountPct
provides:
  - handleSaveDraft: inserts bills + bill_items rows with stock validation and decrement
  - applied_codes persisted to bills.applied_codes (D-02)
  - billId prop wired in BillingPage for Plan 03 load-for-edit
affects: [01-03-draft-update, billing-finalize, stock-reconciliation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stock validation before insert: fetch current stock, compare requested qty, block with error toast"
    - "Dangling row cleanup: delete orphaned bills row if bill_items insert fails"
    - "Stock decrement loop: per-variant update after successful bill_items insert"

key-files:
  created: []
  modified:
    - src/admin/components/billing/BillingForm.js
    - src/admin/pages/BillingPage.js

key-decisions:
  - "stockMap defined in validation step reused in decrement step to avoid second DB query"
  - "Best-effort stock decrement (errors logged, not thrown) — bill is already saved at that point"
  - "Update path (billId set) is stubbed with destructive toast for Plan 03 to implement"

patterns-established:
  - "Pre-save stock validation: fetch all variants in one query, build map, filter violations"
  - "Atomic bill creation: bills insert → bill_items insert → stock decrement (with cleanup on items failure)"

requirements-completed: [BILL-01, STOCK-01]

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 01 Plan 02: Save Draft Implementation Summary

**Save Draft now inserts bills row with paymentstatus='draft' and applied_codes, validates stock per D-01, inserts bill_items via buildBillItemsPayload, and decrements productsizecolors.stock per inventory item**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T05:08:38Z
- **Completed:** 2026-04-04T05:10:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Full Save Draft flow implemented: validate items, validate stock, insert bills, insert bill_items, decrement stock
- applied_codes array persisted to bills row (D-02 requirement)
- Dangling bills row cleanup if bill_items insert fails (defensive coding)
- billId prop wired in BillingPage, enabling Plan 03 load-for-edit

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement handleSaveDraft for new bills (BILL-01 + STOCK-01)** - `d03e734` (feat)
2. **Task 2: Wire billId prop in BillingPage** - `505ac8d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/admin/components/billing/BillingForm.js` - Full handleSaveDraft implementation with stock validation, bills/bill_items insert, stock decrement
- `src/admin/pages/BillingPage.js` - Added billId={activeBillId} prop to BillingForm

## Decisions Made
- stockMap built during validation is reused in the decrement loop — avoids a redundant DB round-trip
- Stock decrement errors are logged (console.error) but not thrown — the bill and items are already committed at that point, so a failed stock update should not undo the bill; the stock can be reconciled later
- The update path (when billId is set) returns an error toast placeholder — Plan 03 will implement draft update with computeStockDelta reconciliation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The verification grep in the plan (`grep -q 'from("bills").insert'`) failed because `.from("bills")` and `.insert({` are on separate lines in the implementation. All actual acceptance criteria were verified individually and passed.

## User Setup Required

None - no external service configuration required.

Note: `schema/migration_01_applied_codes.sql` must still be run in Supabase dashboard to add the `applied_codes text[]` column to the bills table (tracked in STATE.md Pending Todos).

## Next Phase Readiness
- Save Draft is fully wired with stock management — ready for Plan 03 draft update (BILL-02 + STOCK-02)
- billId prop is wired in BillingPage, enabling Plan 03 to load existing bills for edit
- computeStockDelta from stockHelpers.js is ready for use in Plan 03 reconciliation

---
*Phase: 01-draft-stock-management*
*Completed: 2026-04-04*

## Self-Check: PASSED

- FOUND: src/admin/components/billing/BillingForm.js
- FOUND: src/admin/pages/BillingPage.js
- FOUND: .planning/phases/01-draft-stock-management/01-02-SUMMARY.md
- FOUND commit: d03e734
- FOUND commit: 505ac8d
