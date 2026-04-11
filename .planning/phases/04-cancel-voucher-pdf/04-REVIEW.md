---
phase: 04-cancel-voucher-pdf
reviewed: 2026-04-11T17:06:10Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/admin/components/billing/ReturnReceiptView.js
  - src/admin/components/BillTable.js
  - src/admin/components/billing/Summary.js
  - src/admin/components/billing/BillingForm.js
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-11T17:06:10Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 04 introduces bill cancellation (soft-cancel with stock restore, two-step dialog, return receipt PDF) and store-credit / promotional-voucher redemption in the billing flow. The logic is generally sound and the two-step cancel dialog with resolution choices is well-structured. However, there are two critical issues: (1) the cancel flow restores stock using a non-atomic read-then-write pattern without any database-level guard, which means concurrent activity can corrupt stock counts; (2) `total_spend` is inflated on finalize because it adds `computed.grandTotal` (pre-deduction) rather than the actual net amount the customer paid after voucher and store-credit deductions. There are also several warnings around race conditions in the PDF capture flow, unsafe loose equality in voucher validation, and missing error propagation in several Supabase calls.

---

## Critical Issues

### CR-01: `total_spend` records pre-deduction amount, not amount customer actually paid

**File:** `src/admin/components/billing/BillingForm.js:649`
**Issue:** `handleConfirmFinalize` adds `computed.grandTotal` to the customer's `total_spend`. `computed.grandTotal` is the pre-voucher, pre-store-credit subtotal. The voucher and store-credit deductions are applied separately afterwards (lines 682–701) but never subtracted from what is recorded in `total_spend`. A customer who has ₹500 store credit and buys ₹1000 worth of goods will have ₹1000 added to their spend rather than ₹500.

This also means the reversal in `handleResolveReturnPayment` (which subtracts `totalamount`, also the pre-deduction value) will over-deduct when the customer originally used voucher/store-credit, potentially driving `total_spend` negative (floored at 0 but still wrong).

**Fix:**
```js
// Compute the net amount the customer actually paid (same clamping as Summary)
const vAmt = Math.min(Number(appliedVoucher?.value ?? 0), computed.grandTotal);
const postV = Math.max(0, computed.grandTotal - vAmt);
const scConsumed = Math.min(Number(appliedStoreCredit || 0), postV);
const amountPaidByCustomer = Math.max(0, postV - scConsumed);

const newTotal = Number(custRow?.total_spend ?? 0) + amountPaidByCustomer;
```
Store `amountPaidByCustomer` in a new `bills` column (e.g., `net_amount`) so the cancel flow can reverse the correct value. Use `net_amount` in `handleResolveReturnPayment` instead of `totalamount`.

---

### CR-02: Stock restore uses non-atomic read-modify-write — concurrent requests can corrupt stock

**File:** `src/admin/components/BillTable.js:67-86`
**Issue:** `restoreStockForBill` reads each variant's current stock and then writes `stock + bi.quantity` in two separate round trips, with no locking or optimistic-concurrency guard. If another bill is finalized between the read and write, the stock count silently ends up wrong. The same pattern is present in `handleDelete` (lines 282–295) and in `BillingForm.js` during draft save/finalize.

```js
// Reads stock (snapshot A)
const { data: variant } = await supabase
  .from("productsizecolors")
  .select("stock")
  .eq("variantid", bi.variantid)
  .single();
// ... possibly concurrent write happens here ...
// Writes A.stock + quantity (silently overwrites concurrent change)
await supabase
  .from("productsizecolors")
  .update({ stock: variant.stock + bi.quantity })
  .eq("variantid", bi.variantid);
```

**Fix:** Use a Supabase RPC (PostgreSQL function) that performs an atomic `UPDATE productsizecolors SET stock = stock + $delta WHERE variantid = $id`. This is the standard pattern for concurrent inventory counters and eliminates the race without client-side locking.

```sql
-- migration: create_rpc_adjust_stock.sql
CREATE OR REPLACE FUNCTION adjust_stock(p_variantid uuid, p_delta integer)
RETURNS void LANGUAGE sql AS $$
  UPDATE productsizecolors SET stock = stock + p_delta WHERE variantid = p_variantid;
$$;
```

```js
// Client call:
await supabase.rpc('adjust_stock', { p_variantid: bi.variantid, p_delta: bi.quantity });
```

---

## Warnings

### WR-01: PDF capture relies on a 100ms `setTimeout` — race condition with React rendering

**File:** `src/admin/components/BillTable.js:223`
**Issue:** After setting `receiptBill` state, the code `await new Promise((r) => setTimeout(r, 100))` to wait for React to render the off-screen `ReturnReceiptView` before calling `generateInvoicePdf(receiptRef.current)`. This is fragile — slow machines, heavy renders, or future React batching changes can cause the DOM to not be ready in time, producing a blank or partially-rendered PDF. The pattern is also used inconsistently (the main `BillingForm` uses `flushSync` for its invoice render, which is the correct approach).

**Fix:** Use `flushSync` to synchronously flush the state update before capturing the ref, consistent with how `BillingForm` handles the same problem:

```js
import { flushSync } from "react-dom";

// Replace setState + setTimeout with:
flushSync(() => {
  setReceiptBill({ billId, originalBillDate: orderdate, ... });
});
// receiptRef.current is now populated synchronously
if (receiptRef.current) {
  const blob = await generateInvoicePdf(receiptRef.current);
  ...
}
```

---

### WR-02: Voucher customer ownership check uses loose `!=` equality

**File:** `src/admin/components/billing/BillingForm.js:283`
**Issue:** The voucher ownership guard uses `!=` instead of `!==`:
```js
if (data.customerid != null && selectedCustomerId != null && data.customerid !== selectedCustomerId) {
```
The outer null checks use `!=` (loose), which will coerce `0` to falsy and also treat `null == undefined` as truthy. If `customerid` is stored as an integer in Postgres (e.g., `1`) and `selectedCustomerId` is a string `"1"` from the UI, the inner strict `!==` will pass the ownership check when it should block it. Conversely, the outer `!= null` check is the JS loose pattern that works correctly for null/undefined, but is inconsistent with the rest of the codebase that uses strict equality.

**Fix:** Confirm the types of `data.customerid` and `selectedCustomerId` are always the same type (both UUID strings or both integers) and use strict equality throughout:
```js
if (data.customerid !== null && data.customerid !== undefined &&
    selectedCustomerId !== null && selectedCustomerId !== undefined &&
    String(data.customerid) !== String(selectedCustomerId)) {
  setVoucherError("This voucher is assigned to a different customer.");
  return;
}
```

---

### WR-03: Cancel flow does not delete voucher redemption — cancelled bill leaves voucher marked as redeemed

**File:** `src/admin/components/BillTable.js:111-133, 135-181`
**Issue:** Both `handleCancelFinalizedNoCustomer` and `handleResolveReturnPayment` delete `discount_usage` rows (line 116, 164) but neither un-redeems an applied voucher. If the original bill used a promotional voucher (`vouchers.redeemed = true`), cancelling the bill leaves the voucher permanently consumed. The customer cannot reuse it even though the bill was cancelled and their money returned.

**Fix:** After deleting `discount_usage`, also reset the voucher if one was used for that bill. The `bills` table would need to persist the `applied_voucher_id` (or it can be fetched from `vouchers` via `redeemed_billid`):

```js
// Reset voucher if one was applied to this bill
const { data: voucherRow } = await supabase
  .from('vouchers')
  .select('voucher_id')
  .eq('redeemed_billid', billId)
  .maybeSingle();
if (voucherRow) {
  await supabase
    .from('vouchers')
    .update({ redeemed: false, redeemed_at: null, redeemed_billid: null })
    .eq('voucher_id', voucherRow.voucher_id);
}
```

---

### WR-04: `handleResolveIssueStoreCredit` credits `totalamount` (pre-deduction) rather than net amount paid

**File:** `src/admin/components/BillTable.js:198`
**Issue:** When issuing a store credit refund, the code adds `Number(totalamount ?? 0)` to the customer's store credit. `totalamount` is saved as `computed.grandTotal`, which is the pre-voucher, pre-store-credit total (see CR-01). A customer who paid ₹500 cash after using a ₹500 voucher would receive ₹1000 store credit instead of ₹500.

```js
const newCredit = Number(custRow.store_credit ?? 0) + Number(totalamount ?? 0);
```

**Fix:** The `bills` table should persist the net amount the customer actually paid (as described in CR-01 fix). Use that net amount for the store credit refund:

```js
// Use net_amount (amount customer actually paid) from the bills row
const { data: billRow } = await supabase
  .from('bills')
  .select('net_amount')
  .eq('billid', billId)
  .single();
const refundAmount = Number(billRow?.net_amount ?? totalamount ?? 0);
const newCredit = Number(custRow.store_credit ?? 0) + refundAmount;
```

---

### WR-05: Unhandled promise rejection when loading bill in edit mode — error not surfaced if `payment_method` column missing

**File:** `src/admin/components/billing/BillingForm.js:124-129`
**Issue:** `loadBill` fetches `payment_method, payment_amount` in the same query as `customerid, notes`. If either column is missing from the table (schema not yet migrated), the whole query throws and the bill fails silently with only a toast. More critically, the `applied_codes` column is fetched in a separate resilient query at line 133 precisely because "column may not exist if migration not yet run" — but `payment_method` and `payment_amount` are in the primary query without the same resiliency guard.

**Fix:** Apply the same defensive separate-query pattern already used for `applied_codes`, or at minimum handle the missing-column error distinctly from other errors to give the operator a useful message:

```js
const { data: paymentRow } = await supabase
  .from('bills')
  .select('payment_method, payment_amount')
  .eq('billid', billId)
  .single();
setPaymentMethod(paymentRow?.payment_method || "");
setPaymentAmount(paymentRow?.payment_amount ?? "");
```

---

## Info

### IN-01: Commented-out import in BillingForm.js

**File:** `src/admin/components/billing/BillingForm.js:20, 35`
**Issue:** Two import lines are commented out: `//import { Textarea } from "..."` and `//  DialogTrigger,`. Commented-out code adds noise and suggests incomplete cleanup.
**Fix:** Remove the commented-out lines entirely.

---

### IN-02: `billDate` is always set to `new Date()` on bill load, ignoring the actual bill date

**File:** `src/admin/components/billing/BillingForm.js:157`
**Issue:** When loading an existing bill, `setBillDate(new Date())` uses the current time rather than the bill's `orderdate`. The `InvoiceView` receives this as `billDate`, so reprinting an existing bill will show today's date instead of the original bill date.

**Fix:**
```js
setBillDate(bill.orderdate ? new Date(bill.orderdate) : new Date());
```
Requires adding `orderdate` to the bill select query at line 124.

---

### IN-03: Magic `100` tolerance in payment validation is a silent business rule

**File:** `src/admin/components/billing/BillingForm.js:536`
**Issue:** `Math.abs(paidAmt - effectiveGrandTotal) > 100` uses a hardcoded ₹100 tolerance with no named constant or comment explaining the business reason. If this threshold changes or needs review, it is invisible.
**Fix:**
```js
const PAYMENT_TOLERANCE_INR = 100; // Allow rounding difference up to ₹100
if (Math.abs(paidAmt - effectiveGrandTotal) > PAYMENT_TOLERANCE_INR) { ... }
```

---

_Reviewed: 2026-04-11T17:06:10Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
