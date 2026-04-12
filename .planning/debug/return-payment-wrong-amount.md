---
status: diagnosed
trigger: "Return payment to customer reverses total_spend by gross bill total instead of actual amount customer paid"
created: 2026-04-11T00:00:00Z
updated: 2026-04-11T00:00:00Z
---

## Current Focus

hypothesis: handleResolveReturnPayment() destructures `totalamount` from cancelBill (the bill's gross total) and subtracts it from total_spend, but should subtract the actual payment amount the customer paid (payment_amount / net_amount column on the bills table).
test: confirmed by reading the handler at line 161 of BillTable.js
expecting: fix requires fetching bills.payment_amount (or bills.net_amount) in the handler, same pattern as handleResolveIssueStoreCredit which already fetches net_amount (line 219–224)
next_action: none — diagnosis complete

## Symptoms

expected: Cancelling a finalized bill with "Return payment to customer" reverses total_spend by the actual amount the customer paid (net of store credit, vouchers, etc.)
actual: total_spend is reversed by the full gross bill total (totalamount), which overstates the reversal when discounts or store credit were applied
errors: none
reproduction: UAT Test 5 — cancel a finalized bill with customer, choose "Return payment to customer" in step 2 dialog
started: discovered during UAT of phase 04-cancel-voucher-pdf

## Eliminated

- hypothesis: the bug is in a different handler (handleResolveIssueStoreCredit)
  evidence: handleResolveIssueStoreCredit already has the fix pattern — it fetches net_amount from the bills table (lines 219–224) and falls back to totalamount only if net_amount is null. The bug is exclusively in handleResolveReturnPayment.
  timestamp: 2026-04-11T00:00:00Z

## Evidence

- timestamp: 2026-04-11T00:00:00Z
  checked: BillTable.js handleResolveReturnPayment (lines 159–206)
  found: Line 161 — `const { billid: billId, customerid, totalamount } = cancelBill;`. Line 171 — `const newSpend = Math.max(0, Number(custRow.total_spend ?? 0) - Number(totalamount ?? 0));`. The handler takes totalamount directly from the cancelBill state object, which was populated in the initial `loadBills` query (line 36) and holds the gross bill total.
  implication: No fetch of payment_amount or net_amount is performed — the gross total is used unconditionally.

- timestamp: 2026-04-11T00:00:00Z
  checked: BillTable.js handleResolveIssueStoreCredit (lines 208–287)
  found: Lines 219–224 — the store credit handler explicitly fetches `net_amount` from the bills row and falls back to totalamount: `const { data: billRow } = await supabase.from("bills").select("net_amount").eq("billid", billId).single(); const refundAmount = Number(billRow?.net_amount ?? totalamount ?? 0);`
  implication: A consistent fix pattern already exists in the same file. The return-payment handler simply lacks the equivalent fetch.

- timestamp: 2026-04-11T00:00:00Z
  checked: STATE.md schema additions (line 44)
  found: Phase 2 schema addition notes: `bills`: add `payment_method` text, `payment_amount` numeric. migration_02_payment_fields.sql adds these columns. The store credit handler reads the column as `net_amount` — either the migration added it under that name, or both names exist.
  implication: The actual-payment column exists on the bills table (net_amount / payment_amount). The fix is to fetch it in handleResolveReturnPayment the same way handleResolveIssueStoreCredit does.

## Resolution

root_cause: handleResolveReturnPayment() uses the gross totalamount from the already-loaded bill state object to decrement customer.total_spend, rather than fetching the actual payment amount (net_amount) recorded on the bill row. The parallel handler handleResolveIssueStoreCredit already contains the correct pattern — a Supabase fetch for net_amount with a totalamount fallback — but that pattern was never applied to handleResolveReturnPayment.
fix: not applied (diagnose-only mode)
verification: not applied
files_changed: []
