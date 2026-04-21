---
phase: 06-exchange-and-returns-bill-lookup-partial-item-credit-store-c
plan: "03"
subsystem: billing-exchange-handoff
tags: [exchange, returns, billing, store-credit, route-state, post-gst-deduction]
dependency_graph:
  requires:
    - route state contract from ExchangePage (plan 02): { openNewBill, exchangeCredit, prefilledCustomerId }
    - Summary.js deduction row pattern (existing store credit row)
    - BillingForm.js appliedStoreCredit pattern
  provides:
    - BillingPage: route-state consumer — auto-opens BillingForm on exchange arrival
    - BillingForm: exchangeCredit prop + post-GST deduction + customer prefill + finalize notes trace
    - Summary: 3-tier deduction (grandTotal -> storeCreditApplied -> exchangeCreditApplied) + purple row
  affects:
    - src/admin/pages/BillingPage.js
    - src/admin/components/billing/BillingForm.js
    - src/admin/components/billing/Summary.js
tech_stack:
  added: []
  patterns:
    - useLocation + mount-only useEffect for route-state consumption
    - window.history.replaceState({}, '') to clear state after consumption (Pitfall 4)
    - Post-GST deduction chain: storeCreditApplied -> afterStoreCredit -> exchangeCreditApplied -> effectiveGrandTotal (floor 0)
    - exchangeNote appended to bills.notes on finalize for audit trail
key_files:
  created: []
  modified:
    - src/admin/pages/BillingPage.js
    - src/admin/components/billing/BillingForm.js
    - src/admin/components/billing/Summary.js
decisions:
  - "exchangeCredit is pure UI state — not a DB row; trace persisted in bills.notes on finalize"
  - "window.history.replaceState clears route state mount-only (no location dep) to prevent back-nav re-open"
  - "BillingForm key includes exchangeCredit.label to force remount on exchange arrival so state is fresh"
  - "Net payable condition extended to: storeCreditApplied > 0 || exchangeCreditApplied > 0"
metrics:
  duration: "~20 minutes"
  completed: "2026-04-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 3
---

# Phase 06 Plan 03: BillingPage Exchange Handoff Summary

**One-liner:** BillingPage reads ExchangePage route state on mount and auto-opens BillingForm with exchange credit as a post-GST deduction row in Summary, customer pre-selected, and audit note appended to bills.notes on finalize.

## What Was Built

### Summary.js — 3-tier deduction row (Task 1)

`src/admin/components/billing/Summary.js` extended:

- New `exchangeCredit = null` prop (shape `{ amount: number, label: string }`)
- 3-tier deduction chain replacing the old 2-tier:
  ```
  storeCreditApplied = min(appliedStoreCredit, grandTotal)
  afterStoreCredit   = max(0, grandTotal - storeCreditApplied)
  exchangeCreditApplied = min(exchangeCredit.amount, afterStoreCredit)
  effectiveGrandTotal   = max(0, afterStoreCredit - exchangeCreditApplied)
  ```
- Purple deduction row rendered when `exchangeCreditApplied > 0`: `Applied: {label} −₹X`
- `totalSavings` includes `exchangeCreditApplied`
- Net Payable condition: `storeCreditApplied > 0 || exchangeCreditApplied > 0`
- No remove button on exchange credit row (D-16 — set by parent from route state)

### BillingForm.js — exchangeCredit prop + deduction + prefill (Task 2)

`src/admin/components/billing/BillingForm.js` extended:

- Signature: `{ billId, open, onOpenChange, onSubmit, exchangeCredit: exchangeCreditProp = null, prefilledCustomerId = null }`
- Local `exchangeCredit` state (mirrors `appliedStoreCredit` pattern)
- useEffect: syncs `exchangeCreditProp` into state when dialog opens
- useEffect: auto-sets `selectedCustomerId` to `prefilledCustomerId` for new bills on open
- Reset-on-close: `setExchangeCredit(null)` added to the `!open` effect block
- `balanceAdjustedComputed` useMemo: exchange credit now participates in the effective-total calc before pre-tax balance discount calibration; `exchangeCredit` added to deps array
- `<Summary ... exchangeCredit={exchangeCredit} />` pass-through
- `exchangeNote` computed at finalize time and appended to `bills.notes` for audit trail
- Confirm-finalize dialog: shows `Applied: {label}: −₹X` row when exchange credit present

### BillingPage.js — route state consumer (Task 3)

`src/admin/pages/BillingPage.js` fully replaced:

- Imports `useLocation` from `react-router-dom`
- Mount-only `useEffect([])` reads `location.state`; if `openNewBill && exchangeCredit`, opens BillingForm with exchange state and immediately calls `window.history.replaceState({}, '')` (Pitfall 4 guard)
- `exchangeCredit` + `prefilledCustomerId` state declared; cleared on edit/new/submit/close
- `handleOpenChange` clears exchange props when staff close dialog without finalizing (D-18 compatible)
- `BillingForm` key: `` `${activeBillId}-${exchangeCredit?.label || ""}` `` forces remount on exchange arrival

## End-to-End Flow

1. Staff completes exchange on ExchangePage → `navigate('/admin/bills', { state: { openNewBill, exchangeCredit, prefilledCustomerId } })`
2. BillingPage mounts → reads state → opens BillingForm, clears history
3. BillingForm opens with customer pre-selected, exchange credit in state
4. Summary shows: grandTotal → (store credit deduction) → purple "Applied: Return Credit — Bill #X" row → Net Payable
5. Staff finalizes → bills.notes gets `[Exchange credit applied: Return Credit — Bill #X — ₹Y.ZZ]` appended
6. Back-nav: history state cleared → BillingForm does NOT re-open

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 — Summary deduction row | ccc0891 | feat(06-03): Summary — add exchange credit deduction row + 3-tier net payable |
| fix — restore files from reset | 8dfbf1e | fix(06-03): restore files deleted by reset |
| 2 — BillingForm props + deduction | 507e694 | feat(06-03): BillingForm — exchangeCredit prop + state + deduction + finalize note |
| 3 — BillingPage route consumer | a628eaa | feat(06-03): BillingPage — consume exchange route state, auto-open BillingForm, clear history |

## Deviations from Plan

### Auto-fix: git reset --soft restored wrong state

**Found during:** Task 1 commit
**Issue:** `git reset --soft eb841fa` left wave 1+2 files (exchangeHelpers.js, migration_14, ReturnReceiptView wave-2 version, ExchangePage wave-2 version, STATE.md, ROADMAP.md) as staged deletions, which got bundled into the Task 1 commit.
**Fix:** Immediately after Task 1 commit, restored all affected files via `git checkout eb841fa -- <files>` and committed the restoration as a separate fix commit before proceeding.
**Files restored:** exchangeHelpers.js, exchangeHelpers.test.js, migration_14_manual_items_stock.sql, ReturnReceiptView.js, ExchangePage.js, STATE.md, ROADMAP.md

No other deviations — all tasks executed per plan spec.

## Known Stubs

None. All exchange credit wiring is fully implemented end-to-end.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All surfaces covered by T-06-20 through T-06-24 in plan threat model:

- `location.state` consumption is same-origin, cleared immediately after read (T-06-21, T-06-23)
- Exchange credit amount is display-only post-GST deduction; store_credit balance was written by ExchangePage before navigate (T-06-20)
- `exchangeNote` in bills.notes provides audit trail (T-06-22)

## Self-Check: PASSED

- `src/admin/components/billing/Summary.js` — exists, contains `exchangeCredit = null`, `exchangeCreditApplied`, `afterStoreCredit`, purple row JSX, combined net payable condition
- `src/admin/components/billing/BillingForm.js` — exists, contains all 11 grep patterns from plan verification
- `src/admin/pages/BillingPage.js` — exists, contains all 10 grep patterns from plan verification
- Commits ccc0891, 8dfbf1e, 507e694, a628eaa — present in git log
- `npm run build` — succeeded (no errors)
- `npm test --testPathPattern=exchangeHelpers` — 13/13 passed (no regressions)
