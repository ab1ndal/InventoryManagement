---
phase: 04-cancel-voucher-pdf
verified: 2026-04-11T23:45:00Z
status: gaps_found
score: 3/5 roadmap success criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/5
  gaps_closed:
    - "Return payment reverses net_amount (not gross totalamount)"
    - "Cancelled bills refund bills.store_credit_used back to customers.store_credit"
    - "CustomerTable shows Store Credit column; total_spend/last_purchased_at derived live from bills"
    - "Store credit receipt PDF prints as A5 (half-A4)"
    - "Re-apply store credit button in Summary when balance > 0 and applied === 0"
    - "Dialog 2 (resolution) has max-h-[90vh] overflow-y-auto"
  gaps_remaining:
    - "SC-3: No vouchers table insert on cancel+issue-store-credit (D-14 vs ROADMAP)"
    - "SC-4: No voucher PDF with voucher_id/expiry_date (D-14 vs ROADMAP)"
  regressions: []
gaps:
  - truth: "If customer is set on bill: a voucher is inserted into vouchers table (value = grandTotal, expiry = 1 year from today, source='exchange')"
    status: failed
    reason: "ROADMAP SC-3 still requires inserting a row into the vouchers table on cancel+issue-store-credit. The D-14 design decision (store credit via customers.store_credit) was not reversed and ROADMAP.md was not updated to reflect the deviation. No vouchers.insert() call exists anywhere in the codebase."
    artifacts:
      - path: "src/admin/components/BillTable.js"
        issue: "handleResolveIssueStoreCredit increments customers.store_credit only (line ~230). No supabase.from('vouchers').insert() call exists anywhere in BillTable.js or BillingForm.js."
    missing:
      - "Either: insert row into vouchers table (voucher_id, value=grandTotal, expiry_date=+1yr, source='exchange', customerid) in handleResolveIssueStoreCredit"
      - "Or: formally update ROADMAP.md SC-3 and SC-4 to reflect the D-14 customers.store_credit approach"

  - truth: "Voucher PDF is generated and displayed for printing (voucher code, value, expiry, store name/branding)"
    status: failed
    reason: "ROADMAP SC-4 still requires a voucher PDF with a redeemable code and expiry date. ReturnReceiptView generates a 'STORE CREDIT RECEIPT' — correct per D-14 but does not satisfy SC-4 which expects a voucher_id code and expiry_date field. ROADMAP.md was not updated."
    artifacts:
      - path: "src/admin/components/billing/ReturnReceiptView.js"
        issue: "Renders STORE CREDIT RECEIPT with billId/customerName/items/creditAmount/issueDate. No voucher_id, no expiry_date. Correct per D-14 but not per ROADMAP SC-4."
    missing:
      - "If SC-4 is to be satisfied: add VoucherView component with voucher_id, value, expiry_date, store branding"
      - "Or: update ROADMAP.md SC-4 to formally retire the voucher-code PDF requirement in favor of the Return Receipt PDF"
human_verification:
  - test: "Open BillTable, click Ban icon on a Finalized bill with a customer, choose Issue store credit. Verify PDF opens and customer store_credit balance increases."
    expected: "A5 PDF receipt opens in new tab; customers.store_credit incremented by the bill's net amount."
    why_human: "PDF capture (html2canvas + jsPDF) and new-tab open require a browser with live Supabase connection."
  - test: "Open New Bill, select a customer with store credit. Remove the auto-applied credit, then click the re-apply button in Summary."
    expected: "Green deduction row disappears on remove; 'Apply store credit (₹X)' button appears; clicking it restores the deduction and reduces grand total."
    why_human: "UI visual state requires browser interaction to verify."
  - test: "Cancel a Finalized bill that had store_credit_used > 0. Verify customers.store_credit increases by the refunded amount."
    expected: "customers.store_credit += bills.store_credit_used for that bill."
    why_human: "Requires live Supabase to verify DB state after cancel."
---

# Phase 04: Cancel & Voucher PDF — Re-Verification Report

**Phase Goal:** Cancelling a bill restores inventory and issues a store credit voucher.
**Verified:** 2026-04-11T23:45:00Z
**Status:** gaps_found
**Re-verification:** Yes — after Plan 03 gap closure (6 UAT gaps fixed)

---

## Re-Verification Context

Plan 03 closed all 6 UAT gaps diagnosed after Plans 01 and 02. All 6 closures are confirmed in code. The two ROADMAP gaps (SC-3 and SC-4) identified in the initial verification remain — they were not addressed by Plan 03 and are not covered by any later milestone phase (Phase 04 is the final phase).

The root cause remains the same: CONTEXT-phase decision D-14 ("vouchers table NOT used for store credit; credit lives in customers.store_credit") contradicts ROADMAP SC-3 and SC-4 which require inserting into the vouchers table and generating a voucher PDF with a code. The implementation matches D-14 exactly, but ROADMAP.md was never updated to reflect this decision.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cancel button shows confirmation dialog before proceeding | ✓ VERIFIED | `openCancelFlow()` → `confirmOpen=true`; Dialog renders with bill details and "Continue"/"Cancel Draft" buttons |
| 2 | Cancelled bill: `paymentstatus='cancelled'`, stock restored, "Cancelled" badge | ✓ VERIFIED | All cancel paths call `restoreStockForBill()` and `.update({ paymentstatus: 'cancelled' })`; Badge at lines 398–403 |
| 3 | If customer is set: voucher inserted into `vouchers` table (value=grandTotal, expiry=1yr, source='exchange') | ✗ FAILED | No `vouchers` insert exists. D-14 uses `customers.store_credit` increment. ROADMAP not updated. |
| 4 | Voucher PDF generated and displayed (voucher code, value, expiry, store name/branding) | ✗ FAILED | ReturnReceiptView renders a store credit receipt (no voucher_id, no expiry_date). ROADMAP not updated. |
| 5 | If no customer: stock restored, no voucher issued, staff informed | ✓ VERIFIED | `handleCancelFinalizedNoCustomer()` + toast "No customer on record" |

**Score: 3/5 ROADMAP success criteria verified**

---

## Plan 03 Gap Closure Verification

All 6 UAT gaps from `04-UAT.md` confirmed closed:

| Gap | Severity | Status | Code Evidence |
|-----|----------|--------|---------------|
| 1 — Return payment reverses gross instead of net | major | ✓ CLOSED | `handleResolveReturnPayment` fetches `net_amount` (BillTable.js:222–229); `total_spend` mutations removed from all cancel handlers |
| 2 — Store credit not refunded on cancel | major | ✓ CLOSED | `refundStoreCreditForBill` helper at line 98; called at 5 sites (lines 125, 164, 191, 221, 339); `store_credit_used` written by BillingForm on Finalize (lines 607, 650) |
| 3 — CustomerTable missing Store Credit column; derived totals | major | ✓ CLOSED | `aggByCustomer` derivation from finalized non-cancelled bills (CustomerTable.js:54–76); Store Credit cell at line 261; `colSpan={11}` at line 204 |
| 4 — Store credit receipt PDF is full A4, should be A5 | minor | ✓ CLOSED | `generateInvoicePdf(node, format='a4')` param at line 10; ReturnReceiptView width 559px at line 21; BillTable calls with `'a5'` at line 266 |
| 5 — No way to re-apply store credit after removing it | minor | ✓ CLOSED | Summary.js: `Apply store credit` button when `storeCreditApplied===0 && customerStoreCreditBalance>0` (lines 86–94); BillingForm wires `onApplyStoreCredit` at line 910 |
| 6 — Dialog 2 clips content | cosmetic | ✓ CLOSED | `DialogContent className="bg-white max-w-md max-h-[90vh] overflow-y-auto"` at BillTable.js:553 |

---

## Plan 03 Must-Haves Verification

| Truth | Status | Code Evidence |
|-------|--------|---------------|
| Return payment uses net_amount not gross | ✓ VERIFIED | BillTable.js line 226: `.select("net_amount")`; line 229: `net_amount ?? totalamount ?? 0` |
| Cancelled bills with store_credit_used get refund | ✓ VERIFIED | `refundStoreCreditForBill` reads `store_credit_used`, adds back to `customers.store_credit`; migration file exists |
| CustomerTable: Store Credit column; derived total_spend/last_purchased_at | ✓ VERIFIED | `aggByCustomer` + `.neq("paymentstatus","cancelled")` + Store Credit `<td>` |
| Store credit receipt PDF is A5 format | ✓ VERIFIED | `generateInvoicePdf(receiptRef.current, 'a5')`; 559px container |
| Re-apply store credit button in Summary | ✓ VERIFIED | `Apply store credit (₹X)` button conditional on `storeCreditApplied===0 && customerStoreCreditBalance>0` |
| Dialog 2 scrolls content instead of overflowing | ✓ VERIFIED | `max-h-[90vh] overflow-y-auto` on DialogContent |
| schema/migration_04_store_credit_used.sql exists | ✓ VERIFIED | File exists; contains `ADD COLUMN store_credit_used numeric(10,2) NOT NULL DEFAULT 0` |
| BillingForm no longer mutates customers.total_spend | ✓ VERIFIED | No `total_spend.*newTotal` or `total_spend:.*new` matches in BillingForm.js |

**Score: 8/8 Plan 03 must-haves verified**

---

## Required Artifacts (All Plans)

| Artifact | Status | Details |
|----------|--------|---------|
| `src/admin/components/billing/ReturnReceiptView.js` | ✓ VERIFIED | Exists; forwardRef; "STORE CREDIT RECEIPT"; 559px width (A5) |
| `src/admin/components/BillTable.js` | ✓ VERIFIED | Cancel flow, 5 cancel handlers, refundStoreCreditForBill, Dialog 2 sized |
| `src/admin/components/billing/Summary.js` | ✓ VERIFIED | Voucher+store credit rows, effectiveGrandTotal, re-apply button, all props |
| `src/admin/components/billing/BillingForm.js` | ✓ VERIFIED | 6 state slots, handleApplyVoucher, store_credit_used on finalize, no total_spend mutation |
| `src/admin/components/CustomerTable.js` | ✓ VERIFIED | Live-derived totals, Store Credit column, colSpan=11 |
| `src/admin/components/billing/generateInvoicePdf.js` | ✓ VERIFIED | Optional format param, defaults 'a4', accepts 'a5' |
| `schema/migration_04_store_credit_used.sql` | ✓ VERIFIED | ADD COLUMN store_credit_used numeric(10,2) NOT NULL DEFAULT 0 |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| BillTable.js | `bills.update({ paymentstatus: 'cancelled' })` | All cancel handlers | ✓ WIRED |
| BillTable.js | `customers.store_credit` | handleResolveIssueStoreCredit | ✓ WIRED |
| BillTable.js | `bills.store_credit_used` (read) | refundStoreCreditForBill | ✓ WIRED |
| BillTable.js | `customers.store_credit` (refund) | refundStoreCreditForBill | ✓ WIRED |
| BillTable.js | `generateInvoicePdf` with `'a5'` | handleResolveIssueStoreCredit | ✓ WIRED |
| BillingForm.js | `bills.store_credit_used` (write) | handleConfirmFinalize | ✓ WIRED |
| BillingForm.js | `customers.select('store_credit')` | useEffect on selectedCustomerId | ✓ WIRED |
| BillingForm.js | `vouchers.update({ redeemed: true })` | handleConfirmFinalize | ✓ WIRED |
| BillingForm.js | Summary.js | customerStoreCreditBalance + onApplyStoreCredit props | ✓ WIRED |
| CustomerTable.js | `bills` (aggregate) | fetchCustomers two-step query | ✓ WIRED |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without live Supabase connection and browser environment).

---

## Human Verification Required

### 1. Issue Store Credit — A5 Return Receipt PDF

**Test:** Cancel a Finalized bill with a customer. Choose "Issue store credit". Verify PDF opens in new tab as A5 format.
**Expected:** PDF is half-A4 (A5) size; renders "STORE CREDIT RECEIPT" with store header, items, credit amount.
**Why human:** PDF capture (html2canvas + jsPDF) and page dimensions require browser.

### 2. Re-apply Store Credit in BillingForm

**Test:** Select a customer with store credit > 0 in a new bill. Remove auto-applied credit via ✕. Verify "Apply store credit (₹X)" button appears. Click it.
**Expected:** Green deduction row disappears on remove; button appears; clicking restores deduction and reduces grand total.
**Why human:** UI visual state requires browser interaction.

### 3. Store Credit Refund on Cancel

**Test:** Finalize a bill for a customer with store credit applied. Then cancel that bill via "Return payment" or "Issue store credit". Check customers.store_credit in Supabase.
**Expected:** customers.store_credit increased by the store_credit_used amount from that bill.
**Why human:** Requires live Supabase to verify DB state after cancel.

---

## Gaps Summary

**Two gaps remain — same as initial verification — requiring a developer decision:**

Both stem from the CONTEXT-phase design decision D-14 ("vouchers table NOT used for store credit") which contradicts ROADMAP SC-3 and SC-4. Plan 03 did not address this divergence and the final milestone phase has no later phase to defer to.

**Gap 1 — ROADMAP SC-3:** No `vouchers` table insert on cancel+issue-store-credit. Implementation uses `customers.store_credit` increment (D-14). ROADMAP SC-3 still reads "a voucher is inserted into vouchers table (value=grandTotal, expiry=1yr, source='exchange')."

**Gap 2 — ROADMAP SC-4:** No voucher PDF with redeemable code and expiry. ReturnReceiptView generates a "STORE CREDIT RECEIPT" (correct per D-14 but not a voucher PDF with code artifact).

**Developer action required — choose one:**
- **Accept D-14 as final:** Update ROADMAP.md Phase 4 SC-3 and SC-4 to reflect the customers.store_credit approach and the return receipt PDF. This closes both gaps and allows STATE.md to be marked complete.
- **Reinstate voucher insert:** Plan a sub-task to insert into the vouchers table on issue-store-credit and add a VoucherView PDF component.

All 6 UAT gaps are closed. User approved Task 7 human checkpoint. Functional behavior is complete — only the ROADMAP documentation alignment is blocking a clean "passed" status.

---

_Verified: 2026-04-11T23:45:00Z_
_Verifier: Claude (gsd-verifier)_
