---
phase: 02-form-polish-schema-additions
plan: 02
subsystem: billing-ui
tags: [billing, salesperson, bill-table, multi-select, lucide-icons]
dependency_graph:
  requires: []
  provides: [SalespersonSelector, BillTable-polish]
  affects: [BillingForm.js]
tech_stack:
  added: []
  patterns: [multi-select-combobox-with-chips, lucide-icon-action-buttons, supabase-relation-join]
key_files:
  created:
    - src/admin/components/billing/SalespersonSelector.js
  modified:
    - src/admin/components/BillTable.js
decisions:
  - Checkbox onClick stopPropagation added to prevent double-toggle when clicking the checkbox itself (the parent div already calls toggleSalesperson)
  - Disabled buttons use disabled prop (shadcn handles opacity-50) plus explicit opacity-40 cursor-not-allowed for stronger visual signal per UI-SPEC
metrics:
  duration: ~6 minutes
  completed: 2026-04-05T03:43:39Z
  tasks_completed: 2
  files_changed: 2
---

# Phase 02 Plan 02: SalespersonSelector + BillTable Polish Summary

Multi-select salesperson combobox with dismissible chips, plus BillTable updated with customer name JOIN, icon action buttons (edit active, PDF/delete disabled), and monetary formatting already in place.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Create SalespersonSelector multi-select combobox | a73709f | Done |
| 2 | Polish BillTable with customer JOIN, icon actions | 3eca045 | Done |

## What Was Built

### SalespersonSelector.js
- New component at `src/admin/components/billing/SalespersonSelector.js`
- Props: `{ selectedIds, setSelectedIds }` — array of salesperson_id integers
- Fetches all active salespersons from `salespersons` table on mount
- Searchable dropdown with Checkbox per row and `bg-secondary` chip dismissibles
- Click-outside (mousedown listener) and Escape key close dropdown
- Error toast on load failure with spec-exact copy

### BillTable.js
- Supabase select query updated to include `customers(first_name, last_name)` relation JOIN
- Customer column now renders full name with "—" fallback (no customerid shown)
- Action column replaced: Pencil (active edit), FileText (disabled, "Available after finalize"), Trash2 (disabled, "Available in Phase 4")
- All three icon buttons use `size="icon" variant="ghost"` with `h-4 w-4` icons
- Monetary values already used `.toFixed(2)` — confirmed and preserved

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] Added onClick stopPropagation to Checkbox in SalespersonSelector**
- **Found during:** Task 1 implementation
- **Issue:** Parent div and Checkbox both call toggleSalesperson — clicking the Checkbox would double-toggle the selection
- **Fix:** Added `onClick={(e) => e.stopPropagation()}` to Checkbox element; parent div remains the primary click target
- **Files modified:** src/admin/components/billing/SalespersonSelector.js
- **Commit:** a73709f

No other deviations — plan executed as written.

## Verification

- Build: `npm run build` — Compiled successfully
- `grep "customers(first_name" src/admin/components/BillTable.js` — matches
- `grep "Pencil" src/admin/components/BillTable.js` — matches
- `grep "selectedIds" src/admin/components/billing/SalespersonSelector.js` — matches
- `grep "Checkbox" src/admin/components/billing/SalespersonSelector.js` — matches

## Known Stubs

None. SalespersonSelector is a complete component ready to be wired into BillingForm in Plan 03. BillTable displays live data from Supabase JOIN.

## Self-Check: PASSED

- SalespersonSelector.js: FOUND at src/admin/components/billing/SalespersonSelector.js
- BillTable.js modified: FOUND with customers JOIN and icon buttons
- Commit a73709f: FOUND
- Commit 3eca045: FOUND
- Build: PASSED
