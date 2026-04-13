---
phase: 05-support-different-discount-types-in-billing-percentage-disco
plan: "01"
subsystem: billing
tags: [discounts, auto-apply, once-per-customer, rules-jsonb]
dependency_graph:
  requires: []
  provides: [correct-auto-apply-eligibility, once-per-customer-filtering, rules-jsonb-fetched]
  affects: [BillingForm, DiscountSelector, billUtils]
tech_stack:
  added: []
  patterns: [useMemo-derived-state, useEffect-customer-reactive-query, supabase-direct-query]
key_files:
  modified:
    - src/admin/components/billing/BillingForm.js
decisions:
  - "isAutoApplyEligible checks date, min_total, and buy_x_get_y qty — items are empty on new bill load so min_total/buy_x_get_y conditions correctly prevent pre-selection (per research assumption A2)"
  - "visibleDiscounts derived via useMemo (not mutation of allDiscounts) so computeBillTotals always has full discount data"
  - "discount_usage useEffect depends only on selectedCustomerId to avoid stale closure with eslint-disable comment"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-12"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 1
---

# Phase 05 Plan 01: BillingForm Discount Filtering — Summary

**One-liner:** Fixed auto-apply eligibility checks (date/min_total/buy_x_get_y), added once-per-customer filtering via discount_usage query, and fetched rules JSONB so all discount types have their configuration data.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix auto-apply eligibility and add rules JSONB to discount query | 85f79a7 | BillingForm.js |
| 2 | Add once-per-customer discount filtering on customer select | fc49c7e | BillingForm.js |

## What Was Built

### Task 1: Auto-Apply Eligibility + Rules JSONB

- Added `rules` to the Supabase `discounts` select string — `buy_x_get_y`, `fixed_price`, and `conditional` discounts now have their `rules` JSONB config available in BillingForm
- Imported `priceItem` from `./billUtils` for use in eligibility computation
- Added `isAutoApplyEligible(d, items, today)` helper above the component that checks:
  - Date guards: `start_date` and `end_date` relative to today
  - `min_total` guard: bill total (via `priceItem().withCharges`) must meet threshold
  - `buy_x_get_y` guard: qualifying item count in category must meet `buy_qty + get_qty`
- Fixed auto-apply pre-selection filter from `d.auto_apply` alone to `d.auto_apply && isAutoApplyEligible(d, items, today)`

### Task 2: Once-Per-Customer Filtering

- Added `usedCodeSet` state (`useState(new Set())`) to track codes already used by the selected customer
- Added `visibleDiscounts` useMemo that filters `allDiscounts` by `once_per_customer && usedCodeSet.has(code)` — returns full `allDiscounts` when no customer selected (D-06)
- Added `useEffect` on `selectedCustomerId` that queries `discount_usage` table for the customer's used codes, updates `usedCodeSet`, and deselects any currently-selected codes that are `once_per_customer` and already used
- Changed `<DiscountSelector discounts={...}>` to use `visibleDiscounts` (was `allDiscounts`)
- Verified `computeBillTotals` continues to use `allDiscounts` — totals computation unaffected

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `isAutoApplyEligible` present with date, min_total, and buy_x_get_y checks: confirmed
- `priceItem` imported from `./billUtils`: confirmed
- `rules` column in Supabase select string: confirmed
- `usedCodeSet` state declared: confirmed
- `visibleDiscounts` useMemo filtering `allDiscounts` by `usedCodeSet`: confirmed
- `useEffect` with `[selectedCustomerId]` dependency querying `discount_usage`: confirmed
- `DiscountSelector` receives `visibleDiscounts`: confirmed
- `computeBillTotals` still uses `allDiscounts`: confirmed
- `npm run build` passes without errors: confirmed

## Known Stubs

None.

## Threat Flags

None — threat model mitigations T-05-01 and T-05-02 are implemented as designed. `isAutoApplyEligible` is the client-side UX guard; server-side enforcement via `discount_usage` FK insert at finalize is unchanged.

## Self-Check: PASSED

- File exists: `src/admin/components/billing/BillingForm.js` — modified
- Commit 85f79a7 exists: confirmed (feat(05-01): add rules to discount query and fix auto-apply eligibility)
- Commit fc49c7e exists: confirmed (feat(05-01): add once-per-customer discount filtering on customer select)
- Build passes: confirmed
