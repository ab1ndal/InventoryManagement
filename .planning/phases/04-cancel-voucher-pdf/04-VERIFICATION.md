---
phase: 04-cancel-voucher-pdf
verified: 2026-04-11T18:00:00Z
status: gaps_found
score: 3/5 roadmap success criteria verified
overrides_applied: 0
gaps:
  - truth: "If customer is set on bill: a voucher is inserted into vouchers table (value = grandTotal, expiry = 1 year from today, source='exchange')"
    status: failed
    reason: "ROADMAP SC-3 requires inserting a row into the vouchers table on cancel+issue-store-credit. The implementation (D-14 decision) stores credit directly in customers.store_credit and does NOT insert into vouchers. No voucher_id, expiry_date, or source='exchange' row is ever created."
    artifacts:
      - path: "src/admin/components/BillTable.js"
        issue: "handleResolveIssueStoreCredit increments customers.store_credit only (line 198-202). No supabase.from('vouchers').insert() call exists anywhere in this file."
    missing:
      - "Insert row into vouchers table with voucher_id (UUID/ULID), value=grandTotal, expiry_date = 1 year from today, source='exchange', customerid, issue_date"
      - "Alternatively: formally retire ROADMAP SC-3 by updating ROADMAP.md to reflect the D-14 design decision (customers.store_credit approach)"

  - truth: "Voucher PDF is generated and displayed for printing (voucher code, value, expiry, store name/branding)"
    status: failed
    reason: "ROADMAP SC-4 requires a voucher PDF with voucher code, value, expiry, and branding. The implementation generates a Return Receipt PDF (ReturnReceiptView) which shows a 'STORE CREDIT RECEIPT' with bill details and credit amount — but no voucher_id code or expiry_date, because no voucher row is created (see SC-3 gap). The PDF is functionally a store credit acknowledgement, not a redeemable voucher."
    artifacts:
      - path: "src/admin/components/billing/ReturnReceiptView.js"
        issue: "Renders 'STORE CREDIT RECEIPT' with billId, customerName, items, creditAmount, issueDate — no voucher_id field, no expiry_date field. Correct for the D-14 design but does not satisfy ROADMAP SC-4 which expects a voucher artifact."
    missing:
      - "If SC-3 is to be satisfied: add VoucherView component displaying voucher_id, value, expiry_date, store branding"
      - "Alternatively: formally retire ROADMAP SC-4 by updating ROADMAP.md to reflect that a Return Receipt PDF replaces a Voucher PDF"
---

# Phase 04: Cancel & Voucher PDF — Verification Report

**Phase Goal:** Cancelling a bill restores inventory and issues a store credit voucher.
**Verified:** 2026-04-11T18:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Context: ROADMAP vs CONTEXT Decision Divergence

Before the plan was executed, the CONTEXT phase made an explicit design decision (D-14): "The `vouchers` table is NOT used for store credit. Store credit lives entirely in `customers.store_credit`." This contradicts ROADMAP Success Criteria 3 and 4 which require inserting into the `vouchers` table and generating a voucher PDF with a code.

The PLAN frontmatter `must_haves` reflects the D-14 decision (no voucher insert), and the implementation matches those plan must-haves exactly. However, the ROADMAP contract (the source of truth for milestone delivery) was never formally updated. This creates a gap between what was planned/built and what the milestone originally required.

**Developer action needed:** Decide whether to:
- **Accept D-14 as final** — update ROADMAP.md SC-3 and SC-4 to reflect the customers.store_credit approach, and the return receipt PDF replaces the voucher PDF
- **Reinstate voucher insert** — implement `vouchers` table insert on cancel + issue-store-credit, and add a VoucherView PDF with code/expiry

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Cancel button shows confirmation dialog before proceeding | ✓ VERIFIED | `openCancelFlow()` sets `confirmOpen=true`; Dialog renders with bill details and "Continue"/"Cancel Draft" buttons (BillTable.js:491–530) |
| 2 | Cancelled bill: `paymentstatus='cancelled'`, stock restored, BillTable shows "Cancelled" badge | ✓ VERIFIED | All cancel paths call `restoreStockForBill()` and `.update({ paymentstatus: 'cancelled' })`; Badge renders with `variant="destructive"` and text "Cancelled" (lines 398–403) |
| 3 | If customer is set: voucher inserted into `vouchers` table (value=grandTotal, expiry=1yr, source='exchange') | ✗ FAILED | No `vouchers` insert exists. Instead, `customers.store_credit` is incremented by `totalamount`. Design decision D-14 explicitly disallows voucher table usage for store credit — but this contradicts ROADMAP SC-3. |
| 4 | Voucher PDF generated and displayed (voucher code, value, expiry, store name/branding) | ✗ FAILED | `ReturnReceiptView` generates a "STORE CREDIT RECEIPT" PDF (no voucher_id, no expiry_date). Satisfies D-11/D-12 but not ROADMAP SC-4 which requires a voucher code artifact. |
| 5 | If no customer: stock restored, no voucher issued, staff informed | ✓ VERIFIED | `handleCancelFinalizedNoCustomer()` restores stock, deletes discount_usage, sets cancelled, and toasts "No customer on record" (lines 111–133) |

**Score: 3/5 ROADMAP success criteria verified**

---

### PLAN must_haves Verification (04-01)

| Truth | Status | Evidence |
| ----- | ------ | -------- |
| Cancel on Draft bill opens dialog; confirming restores stock + sets cancelled | ✓ VERIFIED | `handleCancelDraft` (line 88): calls `restoreStockForBill`, updates `paymentstatus='cancelled'`, local state update |
| Cancel on Finalized bill (with customer) shows resolution dialog | ✓ VERIFIED | `handleStep1Continue` routes finalized+customer to `setResolveOpen(true)` (line 262) |
| "Return payment" restores stock, reverses total_spend, recalculates last_purchased_at, deletes discount_usage | ✓ VERIFIED | `handleResolveReturnPayment` (lines 135–181): all four operations present |
| "Issue store credit" restores stock, increments store_credit, deletes discount_usage, generates return receipt PDF | ✓ VERIFIED | `handleResolveIssueStoreCredit` (lines 183–252): all operations present; `generateInvoicePdf(receiptRef.current)` called; PDF opened in new tab |
| Finalized bill with no customer: restored stock, cancelled, no resolution dialog | ✓ VERIFIED | `handleCancelFinalizedNoCustomer` (line 111) |
| Cancel button hidden on already-cancelled rows | ✓ VERIFIED | `{b.paymentstatus !== 'cancelled' && (<Button onClick={openCancelFlow}>` (line 426) |
| Cancelled bills show "Cancelled" destructive badge | ✓ VERIFIED | Lines 398–403 |

**Score: 7/7 Plan 01 must-haves verified**

### PLAN must_haves Verification (04-02)

| Truth | Status | Evidence |
| ----- | ------ | -------- |
| Customer selection auto-applies store_credit balance | ✓ VERIFIED | `useEffect` on `selectedCustomerId` queries `customers.store_credit` and calls `setAppliedStoreCredit(balance)` (BillingForm.js:221–244) |
| Staff can remove store credit via ✕ on badge | ✓ VERIFIED | Summary.js renders remove button with `aria-label="Remove store credit"`; `onRemoveStoreCredit={() => setAppliedStoreCredit(0)}` passed from BillingForm |
| Store credit resets on customer change | ✓ VERIFIED | `useEffect` on `selectedCustomerId` — if null, sets both to 0; on change, re-queries and resets (line 222–244) |
| Staff can enter voucher code and click Apply Voucher; valid codes show blue badge and deduct from grandTotal | ✓ VERIFIED | Voucher UI section at lines 834–870; `handleApplyVoucher` validates and sets `appliedVoucher`; Summary recomputes `effectiveGrandTotal` |
| Voucher lookup validates: not-found, not redeemed, not expired, optional customer match | ✓ VERIFIED | Lines 272, 276, 280, 284 — all four validation paths present with correct error strings |
| Summary deduction order: Subtotal → Item Disc → Code Disc → Voucher → Store Credit → GST → Total (floor 0) | ✓ VERIFIED | Summary.js lines 21–96 render in exact D-24 order; `effectiveGrandTotal = Math.max(0, ...)` present |
| On Finalize: voucher marked redeemed=true + redeemed_at + redeemed_billid; store_credit decremented | ✓ VERIFIED | BillingForm.js lines 669–701: both Supabase UPDATE calls present in `handleConfirmFinalize` |
| Save Draft does NOT mark voucher redeemed or deduct store credit | ✓ VERIFIED | Grep confirms no `redeemed: true` or `store_credit` update in `handleSaveDraft` block |

**Score: 8/8 Plan 02 must-haves verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/admin/components/billing/ReturnReceiptView.js` | Off-screen forwardRef, "STORE CREDIT RECEIPT" header, 60+ lines | ✓ VERIFIED | 207 lines; `forwardRef`; renders "STORE CREDIT RECEIPT"; all 9 sections from D-12 present |
| `src/admin/components/BillTable.js` | Cancel button + handleCancel + dialogs | ✓ VERIFIED | All handlers, both dialogs, off-screen ReturnReceiptView mount present |
| `src/admin/components/billing/Summary.js` | Voucher + store credit deduction rows, effectiveGrandTotal | ✓ VERIFIED | Both rows (blue bg-blue-50 and green bg-green-50), removal buttons, effectiveGrandTotal, D-24 clamp logic |
| `src/admin/components/billing/BillingForm.js` | 6 new state slots, handleApplyVoucher, finalize extensions, Summary prop pass-through | ✓ VERIFIED | All state slots (lines 61–66), handler (line 258), finalize blocks (lines 669–701), prop pass-through (lines 907–910) |

---

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| BillTable.js | `bills.update({ paymentstatus: 'cancelled' })` | handleCancelDraft/handleCancelFinalizedNoCustomer/handleResolveReturnPayment/handleResolveIssueStoreCredit | ✓ WIRED | Pattern present in all four cancel paths |
| BillTable.js | `customers.update({ store_credit })` | handleResolveIssueStoreCredit | ✓ WIRED | Lines 199–202 |
| BillTable.js | `generateInvoicePdf` | PDF capture for return receipt | ✓ WIRED | Import line 11; called at line 226 |
| BillTable.js | `ReturnReceiptView` | off-screen forwardRef render | ✓ WIRED | Import line 10; rendered at lines 581–591 with receiptRef |
| BillingForm.js | `customers.select('store_credit')` | useEffect on selectedCustomerId | ✓ WIRED | Lines 228–243 |
| BillingForm.js | `vouchers.select` | handleApplyVoucher | ✓ WIRED | Lines 265–269 |
| BillingForm.js | `vouchers.update({ redeemed: true })` | handleConfirmFinalize | ✓ WIRED | Lines 669–679 |
| BillingForm.js | `customers.update({ store_credit })` | handleConfirmFinalize store credit decrement | ✓ WIRED | Lines 682–701 |
| BillingForm.js | Summary.js | appliedStoreCredit + appliedVoucher props | ✓ WIRED | Lines 905–910 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Summary.js | `appliedStoreCredit` | BillingForm state ← `customers.store_credit` DB query | Yes — live Supabase query per customer select | ✓ FLOWING |
| Summary.js | `appliedVoucher` | BillingForm state ← `vouchers` DB query via handleApplyVoucher | Yes — live Supabase query on Apply | ✓ FLOWING |
| ReturnReceiptView | `items` | `bill_items` Supabase query in handleResolveIssueStoreCredit | Yes — queried at cancel time (lines 211–213) | ✓ FLOWING |
| ReturnReceiptView | `creditAmount` | `totalamount` from cancelBill state | Yes — from bills row loaded on BillTable mount | ✓ FLOWING (but see WR-04: uses pre-deduction totalamount) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| BILL-05 | 04-01 | Bill cancellation (soft-cancel, stock restore) | ✓ SATISFIED | All cancel handlers implemented with paymentstatus='cancelled' + restoreStockForBill |
| STOCK-03 | 04-01 | Stock restore on cancel | ✓ SATISFIED | restoreStockForBill fetches bill_items and increments productsizecolors.stock per variantid |
| VOUCH-01 | 04-01, 04-02 | Store credit issuance + auto-apply on next bill | ✓ SATISFIED | issuance via customers.store_credit increment; auto-apply via useEffect in BillingForm |
| VOUCH-02 | 04-01, 04-02 | Promotional voucher redemption on billing | ✓ SATISFIED | handleApplyVoucher with full validation; marks redeemed on Finalize |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| BillTable.js | 67–86 | Non-atomic read-modify-write for stock restore (CR-02) | ⚠️ Warning | Race condition under concurrent use; stock counts can drift |
| BillingForm.js | 649 | `total_spend` records `computed.grandTotal` (pre-deduction), not net amount paid (CR-01) | ⚠️ Warning | Customer loyalty spend inflated when voucher/store-credit used; cancel reversal also incorrect |
| BillTable.js | 111–181 | Cancel does not reset `vouchers.redeemed=false` for bills that used a promo voucher (WR-03) | ⚠️ Warning | Cancelled bill leaves promo voucher permanently consumed |
| BillTable.js | 198 | `handleResolveIssueStoreCredit` credits `totalamount` (pre-deduction) not net paid (WR-04) | ⚠️ Warning | Over-credits customer if original bill used voucher/store-credit |
| BillTable.js | 223 | `setTimeout(r, 100)` for PDF render race instead of `flushSync` (WR-01) | ℹ️ Info | May produce blank PDF on slow machines |
| BillingForm.js | 283 | Loose `!=` in voucher customer ownership check (WR-02) | ℹ️ Info | Type coercion edge case if customerid is integer vs string |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without live Supabase connection and browser environment — all behaviors require database + React render).

---

### Human Verification Required

#### 1. Cancel Dialog — Confirmation and Resolution Flow

**Test:** Open BillTable. Click the Ban icon on a Draft bill. Confirm cancellation. Verify stock is restored and bill shows "Cancelled" badge.
**Expected:** Dialog opens with bill details, confirms, badge turns red with "Cancelled" text, no resolution dialog appears.
**Why human:** Dialog rendering and badge visual state require browser.

#### 2. Issue Store Credit — Return Receipt PDF

**Test:** Cancel a Finalized bill with a customer. Choose "Issue store credit". Verify PDF opens in new tab.
**Expected:** PDF renders as "STORE CREDIT RECEIPT" with store header, bill items, credit amount, and auto-apply note.
**Why human:** PDF capture (html2canvas + jsPDF) and new-tab open require browser.

#### 3. BillingForm — Store Credit Auto-Apply

**Test:** Select a customer who has `store_credit > 0` in Supabase. Open New Bill in BillingForm. Verify green "Store credit applied" row appears in Summary with correct amount, and grand total decreases.
**Expected:** Store credit deducted from total; ✕ button removes it; changing customer resets credit.
**Why human:** UI visual state + Supabase data dependency.

#### 4. BillingForm — Promotional Voucher Apply and Finalize

**Test:** Insert test row into `vouchers` table (`voucher_id='TEST100', value=100, expiry_date='2027-01-01', redeemed=false`). Apply it in BillingForm. Finalize bill. Verify `vouchers.redeemed=true` and `redeemed_billid` set.
**Expected:** Blue badge shows voucher; Finalize dialog shows "Voucher Applied" line; DB row updated.
**Why human:** Requires live Supabase + browser interaction to verify DB write.

---

### Gaps Summary

**Two gaps blocking full ROADMAP goal achievement:**

Both gaps stem from the same root cause: the CONTEXT phase made decision D-14 ("vouchers table NOT used for store credit") which contradicts ROADMAP SC-3 and SC-4. The PLAN was written to reflect D-14, the implementation matches the plan exactly, but the ROADMAP was never updated.

**Gap 1 — ROADMAP SC-3 (voucher row insert):** The cancel + "Issue store credit" path does not insert a row into the `vouchers` table. Instead it increments `customers.store_credit`. This means the store credit has no code, no expiry, and is not tracked via the vouchers system.

**Gap 2 — ROADMAP SC-4 (voucher PDF):** The PDF generated is a return receipt (store credit acknowledgement) not a voucher PDF with a redeemable code and expiry date. This is consistent with D-14 but does not satisfy the ROADMAP contract.

**Additional issues from code review (not blocking milestone delivery but need addressing):**
- CR-01: `total_spend` and store credit refund both use pre-deduction `grandTotal` — net amount paid is not correctly tracked
- CR-02: Stock restore is non-atomic (existing pattern, pre-dates this phase)
- WR-03: Cancelled bills do not reset `vouchers.redeemed=false` for promo vouchers used on the original bill

**Recommended developer action:** If the D-14 approach (customers.store_credit) is the intended final design, update ROADMAP.md SC-3 and SC-4 to reflect this and close the gap as an intentional scope change. If the voucher-insert behavior is still required, it needs to be planned as a new sub-task.

---

_Verified: 2026-04-11T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
