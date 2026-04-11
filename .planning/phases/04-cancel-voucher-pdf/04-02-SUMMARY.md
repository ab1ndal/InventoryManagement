---
phase: 04-cancel-voucher-pdf
plan: 02
subsystem: billing
tags: [store-credit, voucher, billing-form, summary, finalize]
dependency_graph:
  requires: []
  provides: [VOUCH-01, VOUCH-02]
  affects: [src/admin/components/billing/BillingForm.js, src/admin/components/billing/Summary.js]
tech_stack:
  added: []
  patterns: [supabase-direct-query, react-useeffect-on-customer, clamped-deduction-order]
key_files:
  created: []
  modified:
    - src/admin/components/billing/Summary.js
    - src/admin/components/billing/BillingForm.js
decisions:
  - "D-16: Store credit auto-applies on customer select via useEffect querying customers.store_credit"
  - "D-17: Store credit reduces grandTotal post-computation; clamped so balance never goes negative"
  - "D-18: appliedStoreCredit tracked in local state; only deducted from DB on Finalize, not Save Draft"
  - "D-19: computeBillTotals in billUtils.js unchanged; deductions applied in BillingForm/Summary"
  - "D-20: appliedVoucher is a separate state slot from selectedCodes (discount system)"
  - "D-21: Voucher lookup validates redeemed=false, expiry_date >= today, optional customerid match"
  - "D-22: Voucher value deducts from grandTotal after discounts; clamps at 0 (no cashback)"
  - "D-23: On Finalize, vouchers UPDATE redeemed=true, redeemed_at, redeemed_billid; NOT on Save Draft"
  - "D-24: Deduction order: item discounts -> code discounts -> promo voucher -> store credit, all floor at 0"
  - "D-25: One voucher per bill; simple text input + Apply button; no autocomplete"
  - "D-26: Finalize sequence extended with voucher redemption and store credit decrement after discount_usage insert"
metrics:
  duration: ~25 min
  completed: 2026-04-11
  tasks_completed: 2
  files_modified: 2
---

# Phase 04 Plan 02: Store Credit + Voucher Billing — Summary

**One-liner:** Auto-applies customer store credit and staff-entered promotional voucher codes in BillingForm, with D-24 deduction order (voucher → store credit, floor at 0) rendered in Summary and persisted to DB only on Finalize.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update Summary.js to render voucher + store credit deduction rows | 0e67992 | src/admin/components/billing/Summary.js |
| 2 | Wire store credit + voucher into BillingForm state, UI, and finalize | 448357a | src/admin/components/billing/BillingForm.js |

## What Was Built

### Task 1 — Summary.js

- Default export now accepts: `{ computed, appliedStoreCredit, appliedVoucher, onRemoveStoreCredit, onRemoveVoucher }`
- Computes `effectiveGrandTotal` locally using D-24 deduction order:
  - `voucherApplied = Math.min(voucherAmount, preVoucherTotal)` → floors at 0
  - `storeCreditApplied = Math.min(appliedStoreCredit, postVoucherTotal)` → floors at 0
  - `effectiveGrandTotal = Math.max(0, postVoucherTotal - storeCreditApplied)`
- Blue `bg-blue-50` voucher row renders when `appliedVoucher && voucherApplied > 0`; includes `aria-label="Remove voucher"` button
- Green `bg-green-50` store credit row renders when `storeCreditApplied > 0`; includes `aria-label="Remove store credit"` button
- Total row uses `effectiveGrandTotal`; "(You save ...)" line includes voucher + store credit amounts
- Exact deduction order: Subtotal → Item Discounts → Code Discounts → Promo Voucher → Store Credit → GST → Grand Total

### Task 2 — BillingForm.js

**State added (Step A):**
- `appliedStoreCredit` (number, default 0)
- `customerStoreCreditBalance` (number, default 0)
- `voucherCode` (string)
- `appliedVoucher` (null | `{ voucher_id, value }`)
- `voucherError` (string)
- `voucherLoading` (boolean)

**Reset on dialog close (Step B):** All 6 new slots reset in the `!open` useEffect.

**Store credit auto-apply (Step C / D-16):** New `useEffect` on `selectedCustomerId` queries `customers.store_credit` and calls `setAppliedStoreCredit(balance)`. Clears to 0 when customer deselected.

**`handleApplyVoucher` (Step D / D-21,22):** Validates:
- Code exists in `vouchers` table via `.maybeSingle()`
- `redeemed === false` (unified error: "Voucher code not found or already redeemed.")
- `expiry_date >= today` ("This voucher has expired.")
- `customerid` matches selected customer if set ("This voucher is assigned to a different customer.")

**Payment validation (Step E):** `openFinalizeConfirm` now computes `effectiveGrandTotal` (voucher + store credit clamped) and validates `paidAmt` against it, not raw `computed.grandTotal`.

**Finalize persistence (Step F / D-23,26):**
- After discount_usage insert: `UPDATE vouchers SET redeemed=true, redeemed_at, redeemed_billid` if `appliedVoucher` set
- Then: fetch current `customers.store_credit`, compute `consumed = Math.min(appliedStoreCredit, postV)`, `UPDATE customers SET store_credit = Math.max(0, currentBalance - consumed)`
- Neither block runs in `handleSaveDraft`

**Voucher UI (Step G):** Section inserted between DiscountSelector and Notes. Shows text input + "Apply Voucher" button (disabled when empty/loading) when no voucher applied; shows blue badge with remove button when voucher applied; shows `text-destructive` error text on validation failure.

**Summary prop pass-through (Step H):** `<Summary>` now receives `appliedStoreCredit`, `appliedVoucher`, `onRemoveStoreCredit={() => setAppliedStoreCredit(0)}`, `onRemoveVoucher={() => setAppliedVoucher(null)}`.

**Finalize confirm dialog (Step I):** Shows "Voucher Applied", "Store Credit Applied", and "Net Total" lines when applicable.

## Deviations from Plan

None — plan executed exactly as written. All steps A–I implemented per spec. Threat mitigations T-04-09 through T-04-15 all present in implementation.

## Known Stubs

None. All data flows are wired to live Supabase queries.

## Threat Flags

No new network endpoints or auth paths introduced beyond those in the plan's threat model.

## Self-Check

### Files exist:
- src/admin/components/billing/Summary.js — FOUND
- src/admin/components/billing/BillingForm.js — FOUND

### Commits exist:
- 0e67992 (Task 1 — Summary.js) — FOUND
- 448357a (Task 2 — BillingForm.js) — FOUND

### Build: PASSED (npm run build succeeded with no errors)

## Self-Check: PASSED
