# Phase 4: Cancel & Voucher PDF — Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase has two connected scopes:

**1. Bill Cancellation flow:** Cancel or Delete a bill (Draft or Finalized) — restore inventory, then for Finalized bills offer "Return payment" or "Issue store credit". Generate a return receipt PDF if store credit is issued.

**2. Billing form — voucher & store credit application:** When billing a customer, auto-detect and apply any stored store credit. Also allow staff to apply 1 promotional voucher code per bill.

**Key distinction (user-confirmed):**
- **Store Credit** = balance tied to a customer's account (`customers.store_credit`). Generated when a finalized bill is cancelled with "Issue store credit". Auto-applies to next bill.
- **Promotional Vouchers** = one-time codes stored in the `vouchers` table. Custom discounts issued to specific customers. Staff enters a code manually in BillingForm. Separate from store credit and from the existing `discounts` / `selectedCodes` system.

This phase does NOT include: "Cancelled" watermark on invoice PDF (deferred), salesperson commission (future milestone), voucher management UI (future milestone).

</domain>

<decisions>
## Implementation Decisions

### Cancel Entry Point
- **D-01:** Cancel button lives in **BillTable** action column — new 4th action alongside Edit / PDF / Delete. Applies to both Draft and Finalized rows.
- **D-02:** Keep the existing **Delete** button in BillTable (permanent removal for accidental/test bills). Cancel = soft-cancel: sets `paymentstatus='cancelled'`, preserves the record for audit.
- **D-03:** The "Cancel" button in BillingForm closes the modal — do NOT add a bill-cancel action inside BillingForm to avoid naming collision.

### Cancellation Flow — Draft Bills
- **D-04:** For **Draft bills** (no payment received): Cancel/Delete restores stock and closes/deletes the bill **silently** — no "return payment or store credit" dialog. Toast: "Bill #X cancelled. Stock restored."

### Cancellation Flow — Finalized Bills
- **D-05:** For **Finalized bills**, after confirming cancellation (confirmation dialog with bill details), show a second dialog: **"How would you like to resolve this?"**
  - Option A: **"Return payment"** — stock restored, discount_usage deleted, `total_spend` and `last_purchased_at` reversed on customer, no store credit, no PDF.
  - Option B: **"Issue store credit"** — stock restored, discount_usage deleted, `customers.store_credit += grandTotal` (do NOT reverse `total_spend` or `last_purchased_at`), generate return receipt PDF.
- **D-06:** If the finalized bill has **no customer**: no "return payment vs store credit" dialog — just restore stock, delete discount_usage, set `paymentstatus='cancelled'`. Toast: "Bill #X cancelled. Stock restored. No customer on record."

### Stock Restore (shared logic for all cancellations)
- **D-07:** Stock restore: fetch `bill_items` for the bill, `UPDATE productsizecolors SET stock = stock + qty` for each row with a non-null `variantid`. Same pattern as `handleDelete` in BillTable.js.

### Customer Stats — "Return Payment" Path
- **D-08:** Reverse `customers.total_spend` (subtract grandTotal, floor at 0) and recalculate `customers.last_purchased_at` from the next-most-recent finalized bill for that customer. Mirrors existing `handleDelete` logic exactly.

### Customer Stats — "Issue Store Credit" Path
- **D-09:** `customers.total_spend` and `customers.last_purchased_at` are **NOT reversed**. The purchase happened — the store credit is a future benefit.
- **D-10:** `customers.store_credit += grandTotal`. The `customers.store_credit` field already exists (double precision, default 0, check >= 0). No schema migration needed.

### Return Receipt PDF
- **D-11:** When "Issue store credit" is chosen: generate a **return receipt PDF** using html2canvas + jsPDF (same `generateInvoicePdf.js` pattern). Create a `ReturnReceiptView` component (not `VoucherView` — this is a receipt, not a promotional voucher).
- **D-12:** `ReturnReceiptView` content:
  - Store name + branding (same STORE constants as InvoiceView)
  - "STORE CREDIT RECEIPT" header
  - Bill #, original bill date
  - Customer name
  - Items cancelled (itemized list from bill_items — name, qty, MRP)
  - Store credit amount issued: ₹X
  - Issue date
  - Note: "Store credit has been added to your account and will be automatically applied on your next purchase."
- **D-13:** Return receipt PDF is printed immediately (open in new tab). It does NOT need to be saved to Supabase Storage — it's a one-time receipt for the customer. No `pdf_url` column needed on any table.
- **D-14:** `vouchers` table is **not used** for store credit. Store credit lives entirely in `customers.store_credit`.
- **D-15:** No schema migration needed for Phase 4 cancellation flow — all required columns already exist.

### BillingForm — Store Credit Auto-Apply
- **D-16:** When a customer is selected in BillingForm: query `customers.store_credit` for that customer. If `store_credit > 0`, **automatically apply** it to the bill and show a badge: "₹X store credit applied". Staff can remove it via an ✕ button on the badge.
- **D-17:** Store credit reduces `grandTotal` directly (after all other discounts). It is NOT a discount code — it comes off the final total. If store credit > grandTotal, apply only grandTotal (no cashback — credit balance reduces by grandTotal only).
- **D-18:** Store credit application is tracked in local state (`appliedStoreCredit`). On **Finalize**: `UPDATE customers SET store_credit = store_credit - appliedStoreCredit`. Only deduct on finalize — not on save-as-draft.
- **D-19:** `computeBillTotals` in `billUtils.js` does not need to change — store credit is a post-computation deduction applied to `grandTotal` in the BillingForm component.

### BillingForm — Promotional Voucher Code
- **D-20:** BillingForm allows entering **1 promotional voucher code** per bill. This is a separate input from the existing `selectedCodes` (discount codes from `discounts` table). A new `appliedVoucher` state slot.
- **D-21:** Voucher lookup: staff enters a code → system queries `vouchers` table for a row where `voucher_id = code AND redeemed = false AND expiry_date >= today`. Optionally, if `customerid` is set on the voucher, validate it matches the selected customer.
- **D-22:** If valid: show voucher details badge — "Voucher #ABC: ₹Y applied". The voucher `value` deducts from `grandTotal` (after discounts, alongside store credit). If voucher value > remaining total, apply only remaining total (no cashback).
- **D-23:** On **Finalize**: `UPDATE vouchers SET redeemed=true, redeemed_at=now(), redeemed_billid=billid` for the applied voucher. Do NOT mark redeemed on Save Draft.
- **D-24:** Order of deductions from grandTotal: item discounts → overall discount codes → promotional voucher → store credit. All floor at 0 (never negative).
- **D-25:** At most 1 promotional voucher per bill. The input is a simple text field with a "Apply" button. No autocomplete needed — staff has the code.

### Finalize Sequence Update
- **D-26:** Updated finalize sequence in `handleFinalize` (BillingForm.js):
  1. Existing: validate, open confirm dialog, on confirm → update bills, update customer total_spend + last_purchased_at, insert discount_usage, generate invoice PDF, upload, open
  2. **New additions:**
     - If `appliedVoucher`: `UPDATE vouchers SET redeemed=true, redeemed_at=now(), redeemed_billid=billid`
     - If `appliedStoreCredit > 0`: `UPDATE customers SET store_credit = store_credit - appliedStoreCredit`
  3. Both added after the existing customer update step.

### Claude's Discretion
- Confirmation dialog for Cancel: use Shadcn `Dialog` — may need to add Dialog import to BillTable.js
- "Return payment vs store credit" dialog: second Dialog, opens after the first confirm is accepted
- Error handling: if receipt PDF generation fails, show toast but do NOT rollback the cancellation
- BillingForm store credit badge: render inline in the Summary/totals area below the existing discount codes section
- Voucher input placement: below DiscountSelector, above the payment method fields
- `appliedStoreCredit` and `appliedVoucher` states: reset when customer changes or bill reloads

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation Files
- `src/admin/components/BillTable.js` — Add Cancel button + handler; `handleDelete` (line ~50) has the stock restore + customer reversal pattern to mirror
- `src/admin/components/billing/BillingForm.js` — Add `appliedStoreCredit` + `appliedVoucher` state; update `handleFinalize`; add store credit badge + voucher input UI
- `src/admin/components/billing/billUtils.js` — `computeBillTotals()` returns grandTotal; store credit and voucher deductions applied on top in BillingForm component
- `src/admin/components/billing/Summary.js` — Likely where store credit badge + voucher deduction display will be added (shows totals breakdown)
- `src/admin/components/billing/generateInvoicePdf.js` — Reuse for return receipt PDF capture
- `src/admin/components/billing/InvoiceView.js` — Pattern for `ReturnReceiptView` component (STORE constants, off-screen render)

### Schema
- `schema/initial_schema.sql` — `customers` table (store_credit double precision default 0, total_spend, last_purchased_at); `vouchers` table (voucher_id text PK, customerid, expiry_date, value, redeemed boolean, redeemed_at, redeemed_billid, source); `bills` (paymentstatus, finalized); `bill_items` (variantid, quantity); `productsizecolors` (stock); `discount_usage`

### Requirements
- `.planning/REQUIREMENTS.md` — BILL-05, STOCK-03, VOUCH-01, VOUCH-02 acceptance criteria (note: VOUCH-01/02 re-scoped to store credit via `customers.store_credit` + return receipt PDF, not `vouchers` table insert)

### Planning
- `.planning/ROADMAP.md` — Phase 4 section: success criteria, key implementation notes

### Prior Phase Context
- `.planning/phases/03-finalize-with-payment-pdf-invoice/03-CONTEXT.md` — D-01–D-03 (pdf approach), D-04 (STORE constants), handleFinalize sequence to extend

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleDelete` in BillTable.js — stock restore + customer spend reversal pattern. `handleCancel` mirrors this but sets `paymentstatus='cancelled'` instead of deleting, and branches on "return payment" vs "issue store credit" for customer stat handling.
- `generateInvoicePdf(node)` in `generateInvoicePdf.js` — returns PDF Blob from a DOM node. Reuse for `ReturnReceiptView` PDF.
- STORE constants in InvoiceView.js — copy into `ReturnReceiptView` or import.
- `computeBillTotals(items, selectedCodes, allDiscounts)` — returns `grandTotal`. Store credit / voucher deductions are applied to `grandTotal` in BillingForm, not inside `computeBillTotals`.
- `selectedCodes` / `allDiscounts` state in BillingForm — existing discount code system. New `appliedVoucher` and `appliedStoreCredit` are separate state slots, not folded into `selectedCodes`.
- Shadcn `Dialog` — already imported in BillingForm. Need to import in BillTable.js.

### Established Patterns
- Direct Supabase calls from component handlers
- Toast for errors + success
- `setBills(prev => prev.map(...))` for local state updates after BillTable mutations
- `setIsSaving(true)` / `finally { setIsSaving(false) }` loading state pattern

### Integration Points
- BillTable → cancel handler: `UPDATE bills SET paymentstatus='cancelled'`; stock restore; conditional customer stat reversal or store credit add
- BillingForm → on customer select: `SELECT store_credit FROM customers WHERE customerid=X`
- BillingForm → voucher lookup: `SELECT * FROM vouchers WHERE voucher_id=X AND redeemed=false AND expiry_date >= today`
- BillingForm → finalize: `UPDATE vouchers SET redeemed=true, redeemed_at, redeemed_billid` (if voucher applied)
- BillingForm → finalize: `UPDATE customers SET store_credit = store_credit - appliedStoreCredit` (if store credit applied)

</code_context>

<specifics>
## Specific Details

- Store credit field: `customers.store_credit` (double precision, default 0, check >= 0) — already in schema, no migration needed
- "Issue store credit" on cancel: `UPDATE customers SET store_credit = store_credit + grandTotal WHERE customerid=X`
- Store credit deduction on finalize: `UPDATE customers SET store_credit = store_credit - appliedStoreCredit WHERE customerid=X` (never go below 0 — clamp in JS before update)
- Promo voucher lookup: `SELECT * FROM vouchers WHERE voucher_id = $1 AND redeemed = false AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)`
- Deduction order: item discounts → overall discount codes → promo voucher → store credit (all floor grandTotal at 0)
- ReturnReceiptView: compact layout, not full A4. Store header + "STORE CREDIT RECEIPT" + bill details + credit amount + note.

</specifics>

<deferred>
## Deferred Ideas

### Out of scope for Phase 4
- **"Cancelled" watermark on invoice PDF** (from Phase 2/3 context)
- **Voucher management UI** — creating/issuing promo vouchers from an admin screen
- **Store credit history** — audit log of store credit additions/deductions per customer
- **Partial store credit** — applying only part of the store credit balance (Phase 4: apply full balance up to grandTotal)

### Future Milestone
- **Send return receipt via SMS/WhatsApp**
- **Loyalty tier recalculation** after store credit issuance
- **Voucher expiry notifications**

</deferred>

---

*Phase: 04-cancel-voucher-pdf*
*Context gathered: 2026-04-11*
