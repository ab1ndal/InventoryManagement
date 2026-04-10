---
phase: 03-finalize-with-payment-pdf-invoice
plan: "01"
subsystem: billing
tags: [finalize, confirmation-dialog, customer-spend, discount-usage, pdf-deps]
dependency_graph:
  requires: []
  provides: [finalize-db-sequence, confirmation-dialog, pdf-dependencies]
  affects: [BillingForm, package.json]
tech_stack:
  added: [jspdf@4.2.1, html2canvas@1.4.1]
  patterns: [supabase-direct-update, confirmation-dialog-pattern, setIsSaving-guard]
key_files:
  created: []
  modified:
    - src/admin/components/billing/BillingForm.js
    - package.json
    - package-lock.json
decisions:
  - "Customer validation (D-06) added before payment checks — no finalized bill without a customer"
  - "handleFinalize split into openFinalizeConfirm (validation + open dialog) and handleConfirmFinalize (DB sequence)"
  - "Confirmation dialog shows bill #, customer ID, grand total, payment method, amount received"
  - "DB sequence order: bills UPDATE → customers UPDATE → discount_usage INSERT (guard on billId first)"
  - "total_spend incremented via fetch-then-update (no atomic RPC — per plan spec)"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-10"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
requirements: [BILL-04, CUST-01]
---

# Phase 03 Plan 01: Finalize Confirmation Dialog + DB Sequence Summary

**One-liner:** Wired Finalize confirmation dialog with customer validation and DB sequence (bills update, customer spend increment, discount_usage insert) plus jspdf/html2canvas deps for Plan 02.

---

## What Was Built

### Task 1: Install jspdf@4.2.1 and html2canvas@1.4.1 (commit d953b8e)

Installed both PDF generation libraries via npm. These are prerequisites for Plan 02 (PDF invoice generation) and are not used in this plan. Versions pinned to exact values per UI-SPEC Registry Safety section.

**Files:** `package.json`, `package-lock.json`

### Task 2: Customer validation + confirmation dialog (commit 8f2d702)

Split the old `handleFinalize` function into two:

- **`openFinalizeConfirm`** — runs all validations in order: (1) customer present (D-06), (2) payment method + amount filled, (3) amount within ₹100 of grandTotal. Opens confirmation dialog on success.
- **`handleConfirmFinalize`** — stub (Task 3 fills it in) with correct try/catch/finally shape.

Added `confirmOpen` state and a nested `<Dialog>` at the bottom of the outer `<Dialog>` with:
- Title: "Confirm Finalize"
- Description: "This action cannot be undone."
- Bill summary: Bill #, Customer, Grand Total, Payment Method, Amount Received
- "Keep Editing" (ghost) and "Confirm & Finalize" (primary) buttons

Updated Finalize button in footer to call `openFinalizeConfirm`.

**Files:** `src/admin/components/billing/BillingForm.js`

### Task 3: DB finalize sequence (commit 2afb4a0)

Replaced the `// TODO Task 3` stub in `handleConfirmFinalize` with the full DB sequence:

1. **Guard:** throws if `billId` is null (bill not yet saved as draft)
2. **UPDATE bills:** sets `finalized=true`, `paymentstatus='finalized'`, `payment_method`, `payment_amount`
3. **UPDATE customers:** fetches current `total_spend`, increments by `computed.grandTotal`, sets `last_purchased_at` to today (YYYY-MM-DD)
4. **INSERT discount_usage:** inserts one row per `selectedCodes` entry (skipped if no codes applied)
5. Success: `toast({ title: "Bill #${billId} finalized" })`, close dialog, close form, refresh BillTable

Error path: destructive toast, dialog stays open, `isSaving` reset to false via `finally`.

**Files:** `src/admin/components/billing/BillingForm.js`

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Known Stubs

None. All functionality is wired. PDF generation is intentionally deferred to Plan 02 (not a stub — it is a separate plan's responsibility).

---

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns introduced. All Supabase calls are protected behind existing `RequireAdminAuth` guard.

---

## Self-Check

| Item | Status |
|------|--------|
| src/admin/components/billing/BillingForm.js | FOUND |
| package.json | FOUND |
| commit d953b8e (jspdf/html2canvas install) | FOUND |
| commit 8f2d702 (confirmation dialog) | FOUND |
| commit 2afb4a0 (DB finalize sequence) | FOUND |

## Self-Check: PASSED
