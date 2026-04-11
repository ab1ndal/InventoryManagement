---
status: diagnosed
phase: 04-cancel-voucher-pdf
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md]
started: 2026-04-11T00:00:00Z
updated: 2026-04-11T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cancel button visibility
expected: Ban icon (circle-with-line) appears in action column for active bills, hidden for cancelled bills
result: pass

### 2. Cancel draft bill
expected: Click the Ban icon on a Draft bill. A confirmation dialog appears showing the bill details with "Keep Bill" and "Cancel Draft" buttons. Clicking "Cancel Draft" immediately marks the bill cancelled — no second dialog, no resolution step.
result: pass

### 3. Cancel finalized bill (no customer)
expected: Click the Ban icon on a Finalized bill that has no customer attached. A confirmation dialog appears. Clicking Continue cancels it directly without showing a resolution step.
result: skipped
reason: All finalized bills in this system always have a customer attached — no way to create a finalized bill without one.

### 4. Cancel finalized bill with customer — step 2 resolution dialog
expected: Click the Ban icon on a Finalized bill with a customer. Step 1 dialog shows bill details with "Keep Bill" and "Continue". After clicking Continue, a second dialog appears offering "Return payment to customer" and "Issue store credit" buttons, plus a "Go Back" option.
result: issue
reported: "works but the second dialog is shorter than the messages been shown on the dialog"
severity: cosmetic

### 5. Return payment resolution
expected: In step 2, click "Return payment to customer". The bill is marked cancelled, stock is restored, and the customer's total_spend is reversed (and last_purchased_at is corrected). No PDF is generated.
result: issue
reported: "The total spend should actually be real payment by the customer not the bill total. Rest is ok."
severity: major

### 6. Issue store credit resolution — PDF receipt
expected: In step 2, click "Issue store credit". The bill is cancelled, stock is restored, the customer's store_credit balance increases, and a PDF receipt opens in a new browser tab. The receipt shows store header, "STORE CREDIT RECEIPT" label, bill details, items table, and the credit amount.
result: issue
reported: "I see this. Make this half A4 page document. that I can print directly"
severity: minor

### 7. Stock restoration after cancellation
expected: After cancelling any bill (draft, finalized-no-customer, or finalized-with-resolution), go to the Inventory page and confirm the items from that bill have their stock quantities restored to what they were before the bill was created.
result: issue
reported: "The amount is restocked but I am not noting 'Store Credit' that is applied in the bill."
severity: major

### 8. Store credit auto-applies on customer select
expected: Open a new bill in BillingForm. Select a customer who has a store credit balance. The Summary panel should automatically show a green store credit deduction row for the full balance — no manual entry required.
result: issue
reported: "This is applied but If I cancel, there is no way to add it back."
severity: minor

### 9. Store credit removal
expected: With store credit auto-applied in the billing form, click the remove (×) button on the green store credit row in the Summary. The row disappears and the grand total returns to its pre-credit value.
result: pass

### 10. Voucher code — valid apply
expected: In BillingForm, enter a valid, unexpired, unredeeemed voucher code in the Voucher input and click "Apply Voucher". A blue badge appears showing the voucher is applied and the Summary shows a voucher deduction row reducing the total.
result: skipped
reason: Vouchers not yet implemented — will be tested in a future phase.

### 11. Voucher code — validation errors
expected: Try applying an invalid code (does not exist) → error message shown. Try an already-redeemed code → error shown. Try an expired code → "This voucher has expired." shown. Try a code assigned to a different customer → "This voucher is assigned to a different customer." shown.
result: skipped
reason: Vouchers not yet implemented — will be tested in a future phase.

### 12. Voucher removal
expected: With a voucher applied (blue badge visible), click the remove button on the badge. The voucher is removed, the blue deduction row disappears from Summary, and the grand total goes back up.
result: skipped
reason: Vouchers not yet implemented — will be tested in a future phase.

### 13. Deduction order in Summary
expected: With both a voucher and store credit applied, the Summary shows rows in this order: Subtotal → Item Discounts (if any) → Code Discounts (if any) → Promo Voucher (blue row) → Store Credit (green row) → GST → Grand Total. Neither deduction can push the total below 0.
result: skipped
reason: Vouchers not yet implemented — will be tested in a future phase.

### 14. Finalize confirm dialog shows applied deductions
expected: Click Finalize on a bill with a voucher and/or store credit applied. The confirmation dialog shows a "Voucher Applied" line, "Store Credit Applied" line, and "Net Total" reflecting the deductions.
result: skipped
reason: Vouchers not yet implemented — will be tested in a future phase.

### 15. Voucher marked redeemed after finalize
expected: After finalizing a bill with a voucher applied, try to use the same voucher code on a new bill. It should show "Voucher code not found or already redeemed." — the code cannot be reused.
result: skipped
reason: Vouchers not yet implemented — will be tested in a future phase.

### 16. Store credit decremented after finalize
expected: After finalizing a bill where store credit was applied, check the customer's profile. Their store_credit balance should be reduced by the amount that was applied (but never below 0).
result: issue
reported: "This works but I need to add this in the Customer Table display. Additionally, total spend and last purchase date should be derived from the bills (Finalized bills but not cancelled bills)"
severity: major

## Summary

total: 16
passed: 3
issues: 6
pending: 0
skipped: 7
blocked: 0

## Gaps

- truth: "Return payment reverses customer total_spend by the actual amount paid by the customer, not the bill's gross total"
  status: failed
  reason: "User reported: The total spend should actually be real payment by the customer not the bill total. Rest is ok."
  severity: major
  test: 5
  root_cause: "handleResolveReturnPayment() uses totalamount (gross total from cached cancelBill state) to reverse total_spend. The sibling handler handleResolveIssueStoreCredit already correctly fetches net_amount from the bills table, but this pattern was not applied to the return-payment handler."
  artifacts:
    - path: "src/admin/components/BillTable.js"
      issue: "Line 171: subtracts totalamount (gross) instead of net_amount (actual paid). handleResolveIssueStoreCredit already has the correct pattern at lines 219-224."
  missing:
    - "Before computing newSpend, fetch net_amount from bills table for billId (same pattern as lines 219-224)"
    - "Use net_amount ?? totalamount as the reversal amount"
  debug_session: ".planning/debug/return-payment-wrong-amount.md"

- truth: "Customer Table displays store_credit balance; total_spend and last_purchase_date are derived from finalized non-cancelled bills"
  status: failed
  reason: "User reported: This works but I need to add this in the Customer Table display. Additionally, total spend and last purchase date should be derived from the bills (Finalized bills but not cancelled bills)"
  severity: major
  test: 16
  root_cause: "CustomerTable.js has no store_credit column (field is fetched via * but never rendered). total_spend/last_purchased_at are stored mutable fields updated on each transaction — amount added on Finalize (net paid) differs from amount subtracted on Cancel (gross total), causing drift."
  artifacts:
    - path: "src/admin/components/CustomerTable.js"
      issue: "Missing <th>Store Credit</th> header and matching <td> cell"
    - path: "src/admin/components/billing/BillingForm.js"
      issue: "Lines 650-668 mutate total_spend/last_purchased_at on Finalize — should be removed in favor of live derivation"
    - path: "src/admin/components/BillTable.js"
      issue: "Lines 159-195 and 330-360 mutate total_spend/last_purchased_at on Cancel — should also be removed"
  missing:
    - "Add Store Credit column to CustomerTable.js"
    - "Replace stored total_spend/last_purchased_at with live derivation from bills (Supabase RPC or view filtering finalized non-cancelled bills)"
  debug_session: ".planning/debug/customer-table-missing-store-credit.md"

- truth: "After removing auto-applied store credit, user can re-apply it without re-selecting the customer"
  status: failed
  reason: "User reported: This is applied but If I cancel, there is no way to add it back."
  severity: minor
  test: 8
  root_cause: "onRemoveStoreCredit sets appliedStoreCredit(0) but customerStoreCreditBalance remains intact. Balance is never passed to Summary as a prop and no re-apply UI exists. The auto-apply useEffect only fires on selectedCustomerId changes, not on manual removal."
  artifacts:
    - path: "src/admin/components/billing/BillingForm.js"
      issue: "customerStoreCreditBalance not passed to Summary; no onApplyStoreCredit handler"
    - path: "src/admin/components/billing/Summary.js"
      issue: "Does not receive customerStoreCreditBalance; storeCreditApplied > 0 guard hides all credit UI after removal"
  missing:
    - "Pass customerStoreCreditBalance as prop to Summary"
    - "Render 'Apply store credit (₹X)' button in Summary when storeCreditApplied === 0 && customerStoreCreditBalance > 0"
    - "Add onApplyStoreCredit prop: () => setAppliedStoreCredit(customerStoreCreditBalance)"
  debug_session: ".planning/debug/store-credit-no-reapply.md"

- truth: "When cancelling a bill where store credit was applied, the store credit amount is refunded back to the customer's balance"
  status: failed
  reason: "User reported: The amount is restocked but I am not noting 'Store Credit' that is applied in the bill."
  severity: major
  test: 7
  root_cause: "bills table has no store_credit_used column. BillingForm computes the consumed amount at finalize time but never persists it to the bill record. All cancel handlers in BillTable.js have no way to know how much store credit to restore."
  artifacts:
    - path: "src/admin/components/billing/BillingForm.js"
      issue: "Lines 694-715: computes consumed store credit but does not write it to the bills row"
    - path: "src/admin/components/BillTable.js"
      issue: "All cancel handlers lack store_credit restoration logic"
    - path: "schema/"
      issue: "bills table missing store_credit_used column"
  missing:
    - "Add store_credit_used numeric(10,2) default 0 to bills table via new migration"
    - "Write consumed amount to bills.store_credit_used on Finalize in BillingForm.js"
    - "In each cancel handler: read bills.store_credit_used, add back to customers.store_credit if > 0"
  debug_session: ".planning/debug/store-credit-not-refunded-on-cancel.md"

- truth: "Store credit receipt PDF is formatted as a half A4 page document suitable for direct printing"
  status: failed
  reason: "User reported: I see this. Make this half A4 page document. that I can print directly"
  severity: minor
  test: 6
  root_cause: "ReturnReceiptView.js root container is width:400px. generateInvoicePdf.js hardcodes format:'a4' with no override parameter. BillTable.js calls generateInvoicePdf(receiptRef.current) with no format argument."
  artifacts:
    - path: "src/admin/components/billing/ReturnReceiptView.js"
      issue: "width: 400px — should be ~559px (A5 at 96dpi); no @page { size: A5 } style"
    - path: "src/admin/components/billing/generateInvoicePdf.js"
      issue: "format: 'a4' hardcoded; no optional format parameter"
    - path: "src/admin/components/BillTable.js"
      issue: "Line 261: calls generateInvoicePdf(receiptRef.current) with no format override"
  missing:
    - "Add optional format param to generateInvoicePdf (default 'a4' for backward compat)"
    - "Call with format:'a5' from the store-credit path in BillTable.js"
    - "Update ReturnReceiptView.js root container to width:559px"
  debug_session: ".planning/debug/receipt-pdf-not-half-a4.md"

- truth: "Step 2 resolution dialog is sized to fully contain its content without clipping or overflow"
  status: failed
  reason: "User reported: works but the second dialog is shorter than the messages been shown on the dialog"
  severity: cosmetic
  test: 4
  root_cause: "Dialog 2's DialogContent (BillTable.js line 571) has no max-height or overflow-y:auto. Content is tall (multi-line description + two h-auto py-3 buttons with two-line text + footer + gap-4 grid) and silently overflows the dialog box."
  artifacts:
    - path: "src/admin/components/BillTable.js"
      issue: "Line 571: <DialogContent className='bg-white max-w-md'> missing max-h-[90vh] overflow-y-auto"
  missing:
    - "Add max-h-[90vh] overflow-y-auto to Dialog 2's DialogContent at line 571"
  debug_session: ".planning/debug/resolve-dialog-too-short.md"
