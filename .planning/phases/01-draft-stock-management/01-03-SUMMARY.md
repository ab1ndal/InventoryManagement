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
duration: 15min
completed: 2026-04-03
---

# Phase 01 Plan 03: Draft Stock Management — Edit & Status Badge Summary

**Draft bill edit with stock reconciliation: load-for-edit populates BillingForm, stock delta computed via computeStockDelta, and BillTable shows Draft/Finalized/Cancelled badges via paymentstatus**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-03
- **Completed:** 2026-04-03
- **Tasks:** 2 of 3 (Task 3 = human-verify checkpoint, pending)
- **Files modified:** 2

## Accomplishments

- BillingForm now loads existing bill data (customer, items with back-calculated discounts, notes, applied codes) when opened in edit mode
- Draft update path reconciles stock: fetches old bill_items, computes delta with computeStockDelta, validates available stock, deletes old rows, inserts new rows, applies deltas to productsizecolors
- BillTable replaces the `finalized` text display with a shadcn Badge component driven by `paymentstatus` (Draft = secondary, Finalized = default, Cancelled = destructive)

## Task Commits

1. **Task 1: Draft update with stock reconciliation + Load-for-edit** - `0a0619b` (feat)
2. **Task 2: BillTable status badge and paymentstatus query** - `c1f8604` (feat)

## Files Created/Modified

- `src/admin/components/billing/BillingForm.js` — Added load-for-edit useEffect, full draft-update path with computeStockDelta
- `src/admin/components/BillTable.js` — Badge import, paymentstatus in select query, Badge status cell

## Decisions Made

- Delete-and-reinsert pattern for bill_items update (avoids partial update drift)
- applied_codes from DB overrides auto-apply discount codes when editing a draft

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failure: `src/App.test.js` fails with "Cannot find module 'react-router-dom'" — this is unrelated to our changes, pre-existed before this plan, and is out of scope per deviation rules. All 17 business-logic tests (billUtils + stockDelta) pass.

## User Setup Required

**Manual step required before end-to-end testing:**
Run `schema/migration_01_applied_codes.sql` in the Supabase dashboard SQL editor to add the `applied_codes text[]` column to the `bills` table.

## Next Phase Readiness

- Phase 1 automated implementation complete — draft create, edit, stock management, and status badges all implemented
- Pending: Task 3 human-verify checkpoint confirms end-to-end behavior in production Supabase
- After Task 3 verification, Phase 1 is complete and Phase 2 (finalize/cancel/PDF) can begin

## Self-Check: PASSED

- `src/admin/components/billing/BillingForm.js` — exists and contains all required patterns
- `src/admin/components/BillTable.js` — exists and contains Badge, paymentstatus
- Commits 0a0619b and c1f8604 exist in git log

---
*Phase: 01-draft-stock-management*
*Completed: 2026-04-03*
