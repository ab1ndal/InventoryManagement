---
phase: 04-cancel-voucher-pdf
plan: "01"
subsystem: billing-cancel
tags: [cancel, store-credit, receipt-pdf, bill-table]
dependency_graph:
  requires: []
  provides: [ReturnReceiptView, BillTable.handleCancel, cancel-flow]
  affects: [BillTable.js, billing/ReturnReceiptView.js]
tech_stack:
  added: []
  patterns: [forwardRef-pdf-capture, two-step-dialog, optimistic-local-state-update]
key_files:
  created:
    - src/admin/components/billing/ReturnReceiptView.js
  modified:
    - src/admin/components/BillTable.js
decisions:
  - "D-01/D-02: Cancel lives in BillTable as 4th icon (Ban), Delete remains untouched"
  - "D-04: Draft bills cancel silently — no resolution dialog"
  - "D-05/D-06: Finalized bills open step-2 resolution dialog (return payment or store credit); no customer skips step-2"
  - "D-07: restoreStockForBill shared helper mirrors handleDelete stock pattern"
  - "D-08: Return payment reverses total_spend and last_purchased_at"
  - "D-09/D-10: Issue store credit increments store_credit only, does NOT reverse total_spend"
  - "D-11/D-12/D-13: ReturnReceiptView rendered off-screen, PDF opened in new tab via URL.createObjectURL — not uploaded to Storage"
  - "D-14/D-15: vouchers table not used; no schema migration needed"
metrics:
  duration_minutes: 25
  completed_date: "2026-04-11"
  tasks_completed: 2
  files_changed: 2
---

# Phase 04 Plan 01: Cancel Flow + Return Receipt PDF Summary

Bill cancellation lifecycle: soft-cancel (paymentstatus='cancelled') with stock restore, optional customer resolution dialog, and store credit receipt PDF generation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ReturnReceiptView component | 6542d4e | src/admin/components/billing/ReturnReceiptView.js (new) |
| 2 | Add Cancel button + handleCancel + two dialogs to BillTable | f67f3eb | src/admin/components/BillTable.js |

## What Was Built

### Task 1: ReturnReceiptView

New `src/admin/components/billing/ReturnReceiptView.js` — a `forwardRef` component that renders a compact (400px) store credit receipt for PDF capture. Mirrors `InvoiceView.js` structure: same `STORE` constants, same `logo` import, same inline style approach. Sections per UI-SPEC: store header (logo + name/address/phone), "STORE CREDIT RECEIPT" label, bill details (Bill #, Original Date, Customer), items table (Item/Qty/MRP), divider, credit amount, issue date, auto-apply note.

### Task 2: BillTable Cancel Flow

Modified `BillTable.js` with:

**Imports added:** `useRef`, `Ban` (lucide), `Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription` (shadcn), `ReturnReceiptView`, `generateInvoicePdf`

**State added (6 slots):** `cancelBill`, `resolveOpen`, `confirmOpen`, `cancelSaving`, `receiptBill`, `receiptRef`

**Handlers added:**
- `openCancelFlow(bill)` — sets cancelBill + opens step-1 dialog
- `restoreStockForBill(billId)` — shared helper: fetches bill_items, increments productsizecolors.stock per variant
- `handleCancelDraft(bill)` — restores stock, sets paymentstatus='cancelled', local state update
- `handleCancelFinalizedNoCustomer(bill)` — restores stock, deletes discount_usage, sets paymentstatus='cancelled'
- `handleResolveReturnPayment()` — restores stock, reverses customer total_spend + last_purchased_at, deletes discount_usage, sets paymentstatus='cancelled'
- `handleResolveIssueStoreCredit()` — restores stock, increments store_credit, deletes discount_usage, sets paymentstatus='cancelled', fetches bill_items for receipt, generates PDF via ReturnReceiptView + generateInvoicePdf, opens in new tab
- `handleStep1Continue()` — routes: Draft → handleCancelDraft; Finalized+no-customer → handleCancelFinalizedNoCustomer; Finalized+customer → open step-2

**UI added:**
- Cancel icon button (Ban) in action column — hidden when `b.paymentstatus === 'cancelled'`, placed between PDF icon and Delete icon
- Dialog 1 (step-1 confirm): shows bill details, "Keep Bill" / "Continue" (or "Cancel Draft" for drafts)
- Dialog 2 (step-2 resolution): "Return payment to customer" (outline) / "Issue store credit" (primary) / "Go Back"
- Off-screen `ReturnReceiptView` at `position:fixed; top:-9999px` when `receiptBill` is set

**Existing code untouched:** `handleDelete`, Trash2 button, Edit button, PDF button, select query columns.

## Decisions Implemented

D-01 through D-15 all implemented as specified in CONTEXT.md:
- D-01/D-02: BillTable Cancel icon, Delete preserved
- D-04: Draft silent cancel path
- D-05/D-06: Finalized two-step dialog; no-customer bypass
- D-07: restoreStockForBill shared helper
- D-08: Return payment reverses spend
- D-09/D-10: Store credit path does NOT reverse spend — only increments store_credit
- D-11/D-12: ReturnReceiptView off-screen PDF pattern
- D-13: PDF blob opened in new tab, not uploaded to Storage; PDF failure toasts but does NOT rollback cancellation
- D-14: vouchers table not used
- D-15: No schema migration needed

## Threat Mitigations Applied

- T-04-01: Cancel button hidden via `b.paymentstatus !== 'cancelled'` guard; local state updated optimistically
- T-04-02: `cancelSaving` disables buttons during async operations; `restoreStockForBill` called exactly once per handler
- T-04-04: PDF is in-memory Blob only — no Supabase Storage write
- T-04-07: PDF errors caught, toast shown, cancellation NOT rolled back

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all handlers are fully wired to Supabase. ReturnReceiptView receives real data from bill_items query.

## Threat Flags

None — no new network endpoints or auth paths introduced. All Supabase writes are within existing admin RLS scope.

## Self-Check: PASSED

- src/admin/components/billing/ReturnReceiptView.js: EXISTS
- src/admin/components/BillTable.js: MODIFIED (334 lines added)
- Commit 6542d4e: EXISTS (ReturnReceiptView)
- Commit f67f3eb: EXISTS (BillTable cancel flow)
- npm run build: COMPILED WITH NO ERRORS (2 pre-existing ESLint warnings in unrelated files)
