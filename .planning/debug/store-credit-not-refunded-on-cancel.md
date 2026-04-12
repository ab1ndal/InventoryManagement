---
status: diagnosed
trigger: "When cancelling a bill where store credit was applied during billing, the store credit amount is not refunded back to the customer's balance"
created: 2026-04-11T00:00:00Z
updated: 2026-04-11T00:00:00Z
---

## Current Focus

hypothesis: The cancel handlers in BillTable.js have no knowledge of how much store credit was consumed on the original bill, because that amount is never persisted to the bills table. The handlers cannot refund what they cannot read.
test: Confirmed by reading BillingForm.js finalize path and bills schema — no column stores the consumed store credit amount.
expecting: N/A — root cause confirmed
next_action: Fix requires (1) a new column on bills to store the consumed store credit amount, and (2) cancel handlers read that column and add it back to customers.store_credit.

## Symptoms

expected: After cancelling a bill where store credit was applied, the customer's store_credit balance is restored by the amount that was consumed on that bill.
actual: Stock is restored correctly but customer store_credit balance is unchanged after cancel.
errors: None reported
reproduction: Test 7 in 04-UAT.md — create and finalize a bill with store credit applied, then cancel it. Check customer store_credit.
started: Discovered during UAT of phase 04-cancel-voucher-pdf

## Eliminated

- hypothesis: Cancel handlers skip the store-credit restore step due to a code branch error
  evidence: All cancel handlers (handleCancelDraft, handleCancelFinalizedNoCustomer, handleResolveReturnPayment, handleResolveIssueStoreCredit) were read in full. None of them contain any reference to store_credit at all during a draft cancel or "return payment" path. handleResolveIssueStoreCredit adds new store credit (the refund path), but that is a different flow.
  timestamp: 2026-04-11T00:00:00Z

- hypothesis: bills table has a column tracking consumed store credit that the handlers simply forgot to read
  evidence: initial_schema.sql and all migration_*.sql files searched for "applied_store_credit", "store_credit_applied", "credit_used", "net_amount" — none exist. The bills table has no column recording how much store credit was consumed on the bill.
  timestamp: 2026-04-11T00:00:00Z

## Evidence

- timestamp: 2026-04-11T00:00:00Z
  checked: BillingForm.js handleFinalize (lines 694–715)
  found: At finalize time, the code computes `consumed` (the effective store credit deduction, clamped against grandTotal minus voucher amount) and subtracts it from customers.store_credit. This consumed value is ONLY used in-memory to update the customer balance — it is never written to any column on the bills row.
  implication: The consumed store credit amount is ephemeral. Once finalization is complete, there is no record on the bill of how much store credit was used.

- timestamp: 2026-04-11T00:00:00Z
  checked: BillTable.js handleCancelDraft (lines 96–117)
  found: Calls restoreStockForBill(billId), then sets paymentstatus = "cancelled". No store_credit logic at all.
  implication: Draft bills that had store credit applied (edge case — store credit is typically only auto-applied at finalize time, but bills can be saved as draft with a customer) will not have store_credit restored.

- timestamp: 2026-04-11T00:00:00Z
  checked: BillTable.js handleResolveReturnPayment (lines 159–206)
  found: Restores stock, reverses total_spend and last_purchased_at, unRedeems voucher, deletes discount_usage, sets paymentstatus = "cancelled". No store_credit logic.
  implication: When a finalized bill is cancelled via "Return payment", if the original bill used store credit, that credit is never returned to the customer's balance.

- timestamp: 2026-04-11T00:00:00Z
  checked: BillTable.js handleResolveIssueStoreCredit (lines 208–287)
  found: This handler uses `billRow?.net_amount ?? totalamount` as the refund amount. net_amount is not a real column in the bills table (no schema definition found) so it always falls back to totalamount. The handler adds credit for the full bill total — but it does NOT first restore the store credit that was consumed when the bill was finalized. So if store credit of ₹500 was applied on a ₹2000 bill, the customer paid ₹1500 cash. On cancel: the handler adds ₹1500 (net_amount falls back to totalamount=2000, but that's a separate bug WR-04). More importantly, neither path restores the ₹500 store credit originally consumed.
  implication: The "issue store credit" cancel path over-issues credit (adds totalamount instead of net_amount) AND fails to restore the original store credit consumed.

- timestamp: 2026-04-11T00:00:00Z
  checked: bills table schema (initial_schema.sql + all migrations)
  found: bills table columns: billid, customerid, orderdate, totalamount, paymentstatus, saleslocationid, salesmethodid, notes, gst_total, discount_total, taxable_total, pdf_url, finalized, applied_codes, payment_method, payment_amount. No column for store credit consumed.
  implication: There is no persisted record of how much store credit was applied on a bill. Cancel handlers cannot know this value.

## Resolution

root_cause: The bills table has no column recording how much store credit was consumed at finalization time. When BillingForm.js finalizes a bill, it computes the consumed store credit amount in-memory and deducts it from customers.store_credit, but never persists that amount to the bill record. All cancel handlers in BillTable.js therefore have no way to know how much store credit to restore, so none of them do anything with store_credit during cancellation.

fix: (not applied — diagnose-only mode)
  1. Add column `store_credit_used numeric(10,2) default 0` to the bills table (new migration).
  2. In BillingForm.js handleFinalize, write the computed `consumed` value into this new column when saving/updating the bills row.
  3. In each BillTable.js cancel handler, after restoring stock: fetch bills.store_credit_used for the bill; if > 0 and bill has a customer, add that amount back to customers.store_credit.

verification: empty
files_changed: []
