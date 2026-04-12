---
status: testing
phase: 03-finalize-with-payment-pdf-invoice
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md]
started: 2026-04-10T00:00:00Z
updated: 2026-04-10T01:00:00Z
---

## Current Test

number: 1
name: Customer Validation on Finalize
expected: |
  Open a bill in BillingForm with no customer selected. Click the Finalize button.
  Validation should block the action — an error toast appears saying a customer must be
  selected before finalizing. The confirmation dialog should NOT open.
awaiting: user response

## Tests

### 1. Customer Validation on Finalize
expected: Open a bill in BillingForm with no customer selected. Click the Finalize button. Validation should block the action — an error toast appears saying a customer must be selected before finalizing. The confirmation dialog should NOT open.
result: issue
reported: "No error shown, nothing happens"
severity: major

### 2. Edit Bill Details Load
expected: Click Edit on an existing bill. The form opens and populates with the bill's customer, items, salesperson, payment method/amount, and discount codes.
result: issue
reported: "Bill details not visible in form, console error shown"
severity: major

### 3. Finalize Confirmation Dialog
expected: Open a bill with a customer selected, payment method and amount filled in (within ₹100 of grand total). Click Finalize. A confirmation dialog appears showing: Bill #, Customer, Grand Total, Payment Method, Amount Received. Two buttons visible: "Keep Editing" and "Confirm & Finalize".
result: [pending]

### 4. DB Finalize Sequence
expected: In the confirmation dialog, click "Confirm & Finalize". The bill should update to finalized=true with payment info saved. A success toast shows "Bill #{id} finalized". The form closes and the Bill Table refreshes. In Supabase: bills row has finalized=true, customer's total_spend incremented by the grand total, discount_usage rows inserted (if discount codes were applied).
result: [pending]

### 5. PDF Invoice Layout
expected: After finalizing, a PDF opens in a new browser tab. The invoice shows: store header (BINDAL'S CREATION, GSTIN 09ABVPB4203A1Z4, address, phone), bill metadata (Bill No, Date, Customer name, Salesperson name), line items table with S.No./Particulars/Size/Color/Qty/Rate/Disc/GST%/Taxable/CGST/SGST/Amount columns, totals section (subtotal, discount if applied, grand total), payment footer, and signature line.
result: [pending]

### 6. PDF Opens in New Tab
expected: After finalizing, the generated PDF automatically opens in a new browser tab. The pdf_url is also saved to the bill row in Supabase (bills.pdf_url is not null).
result: [pending]

### 7. PDF Failure Isolation
expected: If PDF generation fails (e.g., simulate by checking behavior when Storage is unavailable), the bill is still marked as finalized in the database. A destructive toast appears saying something like "PDF generation failed" and "Bill is finalized. You can reprint from the Bill List." — the finalize action is NOT rolled back.
result: [pending]

## Summary

total: 7
passed: 0
issues: 2
pending: 5
skipped: 0
blocked: 0

## Gaps

- truth: "Clicking Finalize without a customer shows a validation error toast"
  status: failed
  reason: "User reported: No error shown, nothing happens"
  severity: major
  test: 1
  root_cause: "BillingForm used shadcn useToast() but App.js only mounts Sonner's <Toaster>. All toasts in BillingForm were silently dropped. Fixed by switching to import { toast } from 'sonner'."
  artifacts:
    - path: "src/admin/components/billing/BillingForm.js"
      issue: "Wrong toast system — useToast() from shadcn with no shadcn Toaster in tree"
  missing:
    - "Switch all toast calls to sonner (done)"
  debug_session: ""

- truth: "Editing an existing bill populates the form with the bill's saved data"
  status: failed
  reason: "User reported: Bill details not visible in form, console error shown"
  severity: major
  test: 2
  root_cause: "loadBill error was caught and passed to shadcn toast (invisible). Root cause of the DB error unknown until toast fix is deployed and user can see actual error message."
  artifacts:
    - path: "src/admin/components/billing/BillingForm.js"
      issue: "Error handling showed invisible toast — real error was masked"
  missing:
    - "Deploy toast fix and re-test to surface actual error message"
  debug_session: ""
