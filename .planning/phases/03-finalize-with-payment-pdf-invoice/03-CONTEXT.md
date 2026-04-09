# Phase 3: Finalize with Payment + PDF Invoice - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire up the Finalize flow: validate payment, mark bill as finalized in Supabase, insert discount_usage rows, update customer total_spend, generate a PDF invoice via jsPDF, upload it to Supabase Storage, and enable reprint from BillTable.

This phase does NOT include: cancel/voucher flow (Phase 4), SMS/WhatsApp delivery of invoice links (future milestone).

</domain>

<decisions>
## Implementation Decisions

### PDF Generation & Storage
- **D-01:** Use **jsPDF** (or html2canvas + jsPDF) to generate a PDF blob from an `InvoiceView` React component. Upload the blob to Supabase Storage bucket (`invoices`). Store a **permanent public URL** in `bills.pdf_url` via `supabase.storage.from('invoices').getPublicUrl()`.
- **D-02:** After successful upload and `pdf_url` save, immediately **open the PDF in a new tab** (or trigger browser print). Staff gets the invoice in front of them right away after finalizing.
- **D-03:** `pdf_url` is a permanent public URL — not a signed/expiring URL.

### Invoice Store Header (hardcoded constants in InvoiceView)
- **D-04:** Store details are hardcoded as constants in the `InvoiceView` component (no DB lookup):
  - Store name: **BINDAL'S CREATION**
  - Tagline: **A COMPLETE RANGE OF FAMILY WEAR**
  - Address: **58 Sihani Gate Market, Ghaziabad 201001**
  - Phone: **+91 9810873280 | +91 9810121438**
  - GSTIN: **09ABVPB4203A1Z4**
- **D-05:** Invoice layout follows **Indian GST invoice standards** — include GSTIN prominently, itemized GST breakdown (CGST + SGST or IGST), taxable value per line. Reference `src/assets/sample_bill.jpg` for existing store bill style.

### Finalize Validation
- **D-06:** **Finalize is blocked if no customer is selected.** Show validation error: "Customer required to finalize." Staff must add a customer before finalizing. This rule is absolute — no finalized bills without a customer.
- **D-07:** Because all finalized bills require a customer: CUST-01 (update `customers.total_spend` and `last_purchased_at`) is always performed on finalize (no conditional skip needed).

### Finalize Confirmation UX
- **D-08:** Payment fields (method + amount) stay **inline in BillingForm**. Clicking the "Finalize" button:
  1. Validates inline (customer present, payment method + amount filled, amount within ₹100 of grandTotal — existing validation already in `handleFinalize`)
  2. Opens a **confirmation dialog** showing: bill total, payment method, amount received, and a "Confirm & Finalize" button
  3. On confirm: execute the full finalize sequence (DB update → customer update → discount_usage → PDF generate → upload → open PDF)

### Claude's Discretion
- jsPDF vs html2canvas+jsPDF: choose whichever produces a cleaner result for the invoice layout — html2canvas captures the rendered React component as-is, jsPDF requires building the layout programmatically
- Supabase Storage bucket: use `invoices` bucket; file path `bill-{billid}.pdf`
- InvoiceView component: render off-screen (hidden div) during PDF capture; follow Indian GST invoice layout with reference to `src/assets/sample_bill.jpg` proportions
- Confirmation dialog: use existing Shadcn `Dialog` component (already imported in BillingForm)
- Error handling if PDF upload fails: show destructive toast with error, do not mark bill as unfinalized — bill DB state is already committed, PDF can be regenerated via BillTable reprint

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation Files
- `src/admin/components/billing/BillingForm.js` — Main form; `handleFinalize` stub at line ~377; payment state (`paymentMethod`, `paymentAmount`) already wired; Dialog already imported
- `src/admin/components/billing/billUtils.js` — `computeBillTotals()` provides grandTotal, gstTotal, itemLevelDiscountTotal, overallDiscount for invoice
- `src/admin/components/BillTable.js` — Needs Print icon on finalized rows; placeholder print icon already present (Phase 2); wire to open `pdf_url`

### Schema
- `schema/initial_schema.sql` — `bills` table (finalized, paymentstatus, pdf_url, payment_method, payment_amount), `bill_items`, `discount_usage` (customerid NOT NULL), `customers` (total_spend, last_purchased_at)

### Sample Bill
- `src/assets/sample_bill.jpg` — Existing physical bill format; use as reference for InvoiceView layout proportions and field ordering

### Requirements
- `.planning/REQUIREMENTS.md` — BILL-04, CUST-01, PRINT-01 through PRINT-04 acceptance criteria

### Planning
- `.planning/ROADMAP.md` — Phase 3 section: success criteria, key implementation notes (PDF approach options, Supabase Storage pattern)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleFinalize` in BillingForm.js (~line 377) — validation stub already checks payment method, payment amount, and ₹100 tolerance; extend with actual DB logic
- `computeBillTotals(items, selectedCodes, allDiscounts)` — returns all totals needed for both DB insert and PDF rendering
- `buildBillItemsPayload(items)` — returns normalized bill_items array; use to get variantid/qty for PDF line items
- Shadcn `Dialog` component — already imported in BillingForm; reuse for confirmation dialog
- `supabase` client — already imported in BillingForm

### Established Patterns
- Direct Supabase calls from component handlers (no API layer)
- `setIsSaving(true)` / `finally { setIsSaving(false) }` pattern in handleSaveDraft — repeat in handleFinalize
- Toast: `{ title, description, variant: "destructive" }` for errors, plain `{ title }` for success
- `onSubmit?.()` after completion to trigger BillTable refresh
- `onOpenChange?.(false)` to close dialog after success

### Integration Points
- BillingForm → Supabase: `UPDATE bills SET finalized=true, paymentstatus='finalized', pdf_url=...` where billid matches
- BillingForm → Supabase: `INSERT INTO discount_usage (customerid, code, billid)` for each applied code (requires `selectedCustomerId` and `selectedCodes`)
- BillingForm → Supabase: `UPDATE customers SET total_spend = total_spend + grandTotal, last_purchased_at = today` where customerid matches
- BillTable: Print icon (currently disabled placeholder from Phase 2) wires to `window.open(pdf_url, '_blank')` for finalized rows

</code_context>

<specifics>
## Specific Ideas

- Store GSTIN: **09ABVPB4203A1Z4** — must appear on invoice for GST compliance
- Store address: **58 Sihani Gate Market, Ghaziabad 201001**
- Store phones: **+91 9810873280 | +91 9810121438**
- Sample bill (`src/assets/sample_bill.jpg`): shows existing bill style — store name at top, tabular line items with S.No./Particulars/Qty/Rate/Amount columns, Net Amount at bottom, Auth Signature
- Indian GST invoice should show CGST + SGST split (for intra-state) or IGST (inter-state) — since Ghaziabad (UP) is likely intra-state for most customers, default to CGST + SGST split
- Confirmation dialog content: show Bill #, Customer name, Grand Total (₹), Payment Method, Amount Received (₹)

</specifics>

<deferred>
## Deferred Ideas

### Future Milestone
- **Send PDF link to customer's phone:** After finalizing, send the invoice PDF URL to the customer's registered phone number via SMS/WhatsApp. Requires SMS/messaging API integration (e.g., Twilio, MSG91). Noted from user discussion — not Phase 3 scope.

### Phase 4
- "Cancelled" watermark stamp on existing invoice PDF when bill is cancelled (noted from Phase 2 context)

</deferred>

---

*Phase: 03-finalize-with-payment-pdf-invoice*
*Context gathered: 2026-04-08*
