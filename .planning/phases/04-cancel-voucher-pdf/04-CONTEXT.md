# Phase 4: Cancel & Voucher PDF — Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Cancelling a bill (Draft or Finalized) — restore inventory, optionally insert a voucher record if a customer is on the bill, generate a voucher PDF, upload it to Supabase Storage, and open it for printing.

This phase does NOT include: "Cancelled" watermark on existing invoice PDF (deferred), salesperson commission reports (future milestone), loyalty/spend portal (future milestone).

</domain>

<decisions>
## Implementation Decisions

### Cancel Entry Point
- **D-01:** Cancel button lives in **BillTable** action column — new 4th action alongside Edit / PDF / Delete. Applies to both Draft and Finalized rows (per ROADMAP success criteria).
- **D-02:** The existing "Cancel" button in BillingForm closes the modal (not the bill) — do NOT add a bill-cancel action inside BillingForm to avoid naming collision.
- **D-03:** Keep the existing **Delete** button in BillTable. Delete = permanent removal (staff use case: accidental/test bills). Cancel = soft-cancel, keeps the record with `paymentstatus='cancelled'` for audit.

### Cancellation Flow
- **D-04:** Cancel button in BillTable shows a **confirmation dialog** before proceeding. Dialog content:
  - If customer present: "Cancel Bill #X? Stock will be restored. A voucher of ₹[grandTotal] will be issued to [Customer Name]."
  - If no customer: "Cancel Bill #X? Stock will be restored. No voucher will be issued (no customer on this bill)."
- **D-05:** Cancellation sequence (all in a single try/catch handler):
  1. Restore stock: fetch `bill_items`, `UPDATE productsizecolors SET stock = stock + qty` for each row with a `variantid`
  2. Update `bills`: `SET paymentstatus='cancelled'`
  3. If finalized + customer: delete `discount_usage` rows for this billid; reverse `customers.total_spend` (subtract grandTotal); recalculate `customers.last_purchased_at` from remaining finalized bills
  4. If customer present: insert voucher into `vouchers` table (see D-07), generate + upload voucher PDF (see D-08 / D-09)
- **D-06:** `handleDelete` in BillTable.js already implements stock restore + customer reversal for the Delete flow. The Cancel handler mirrors that logic but sets `paymentstatus='cancelled'` instead of deleting the bill record. Reuse the same stock/customer patterns — do not DRY them into a shared helper unless it's clean.

### Voucher Record
- **D-07:** Voucher insertion into `vouchers` table:
  - `voucher_id`: generated via `crypto.randomUUID()` (no extra library needed)
  - `customerid`: from the bill's `customerid`
  - `issue_date`: today (Supabase default `CURRENT_DATE`)
  - `expiry_date`: 1 year from today
  - `value`: grandTotal of the bill
  - `source`: `'exchange'`
  - `note`: `'Cancellation of Bill #[billid]'`

### Voucher PDF — Storage + Print
- **D-08:** Voucher PDF uses the same **html2canvas + jsPDF** approach as `generateInvoicePdf.js`. Create a `VoucherView` React component (off-screen hidden div) rendered with the voucher data, captured via `generateInvoicePdf`-style function (can reuse `generateInvoicePdf.js` directly).
- **D-09:** Upload the voucher PDF blob to Supabase Storage **`vouchers` bucket** (separate from `invoices`). File path: `voucher-{voucher_id}.pdf`. Store a **permanent public URL** in `vouchers.pdf_url` (requires schema migration — see D-10).
- **D-10:** Schema migration needed: `ALTER TABLE vouchers ADD COLUMN pdf_url text;` — provide as `schema/migration_04_voucher_pdf_url.sql`.
- **D-11:** After successful upload and `pdf_url` save, **open the voucher PDF in a new tab** (same as invoice behavior in Phase 3). Staff gets the voucher in front of them immediately.

### VoucherView Component
- **D-12:** `VoucherView` component content:
  - Store name + branding (same STORE constants as InvoiceView — reuse)
  - Voucher code (voucher_id)
  - Value (₹X.XX)
  - Issue date + Expiry date
  - Customer name
  - Source label: "Store Credit Voucher — Cancellation"
  - Note text: "Cancellation of Bill #[billid]"
- **D-13:** Voucher layout is a single compact card (not full A4 page). Keep it receipt-sized and printable. No GST breakdown needed — it's a store credit receipt, not a tax invoice.

### Customer Spend Reversal on Cancel
- **D-14:** When cancelling a **finalized** bill with a customer, **always reverse**:
  - `customers.total_spend` -= grandTotal (floor at 0)
  - `customers.last_purchased_at` = date of next-most-recent finalized bill for this customer (recalculated from remaining finalized bills), or `null` if no others
- **D-15:** When cancelling a **draft** bill: no customer spend reversal needed (draft doesn't update customer stats).

### No-Customer Cancellation
- **D-16:** If the bill has no customer: stock is still restored, `paymentstatus='cancelled'`, no voucher issued. Confirmation dialog says "No voucher will be issued (no customer on this bill)." After success, show toast: "Bill #X cancelled. Stock restored. No voucher issued."
- **D-17:** If the bill has a customer: after success, show toast: "Bill #X cancelled. Voucher ₹[value] issued to [Customer Name]."

### Claude's Discretion
- Cancel confirmation dialog: use existing Shadcn `Dialog` component in BillTable.js (may need to import — check if currently used there, if not import from same path as BillingForm)
- Error handling: if voucher PDF upload fails, show destructive toast but do NOT roll back the cancellation — bill is already cancelled, voucher record is inserted. PDF can be regenerated later if needed.
- Voucher PDF file naming: `voucher-{voucher_id}.pdf` where voucher_id is the UUID
- Supabase Storage bucket for vouchers: `vouchers` — may need to create this bucket in Supabase dashboard (note in migration file)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation Files
- `src/admin/components/BillTable.js` — Add Cancel button + handler here; existing `handleDelete` (line ~50) is the pattern to mirror for stock restore + customer reversal
- `src/admin/components/billing/generateInvoicePdf.js` — Reuse for VoucherView PDF capture
- `src/admin/components/billing/InvoiceView.js` — Pattern for VoucherView component (STORE constants, off-screen render approach)
- `src/admin/components/billing/BillingForm.js` — Reference for Dialog usage pattern and toast patterns

### Schema
- `schema/initial_schema.sql` — `vouchers` table (voucher_id, customerid, issue_date, expiry_date, value, redeemed, note, source); `bills` table (paymentstatus, finalized); `bill_items` (variantid, quantity); `productsizecolors` (stock); `customers` (total_spend, last_purchased_at)

### Requirements
- `.planning/REQUIREMENTS.md` — BILL-05, STOCK-03, VOUCH-01, VOUCH-02 acceptance criteria

### Planning
- `.planning/ROADMAP.md` — Phase 4 section: success criteria, key implementation notes

### Prior Phase Context
- `.planning/phases/03-finalize-with-payment-pdf-invoice/03-CONTEXT.md` — D-01 through D-03: pdf generation approach, D-04: STORE constants

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleDelete` in BillTable.js — stock restore pattern (fetch bill_items → update productsizecolors stock) and customer reversal (recalc total_spend + last_purchased_at) — mirror this in handleCancel
- `generateInvoicePdf(node)` in `generateInvoicePdf.js` — takes a DOM node, returns PDF Blob; reuse directly for VoucherView
- STORE constants in InvoiceView.js — import or duplicate in VoucherView for store branding
- Shadcn `Dialog` — already imported in BillingForm; may need to import in BillTable

### Established Patterns
- Direct Supabase calls from component handlers (no API layer)
- `setLoading(true)` / `finally { setLoading(false) }` pattern
- Toast: `{ title, description, variant: "destructive" }` for errors, `{ title }` for success
- `setBills(prev => prev.map(...))` to update row state locally after mutation
- `crypto.randomUUID()` — available in modern browsers, no library needed

### Integration Points
- BillTable → Supabase: `UPDATE bills SET paymentstatus='cancelled'` where billid matches
- BillTable → Supabase: `UPDATE productsizecolors SET stock = stock + qty` per bill_item with variantid
- BillTable → Supabase: `DELETE FROM discount_usage WHERE billid=X` (finalized bills only)
- BillTable → Supabase: `UPDATE customers SET total_spend=..., last_purchased_at=...` (finalized + customer only)
- BillTable → Supabase: `INSERT INTO vouchers (voucher_id, customerid, expiry_date, value, source, note)` (customer present)
- BillTable → Supabase Storage `vouchers` bucket: upload PDF blob, get public URL, then `UPDATE vouchers SET pdf_url=...`

</code_context>

<specifics>
## Specific Details

- `crypto.randomUUID()` for voucher_id (no extra library)
- Voucher expiry: 1 year from today → `new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)`
- VoucherView branding: same STORE constants as InvoiceView (store name, tagline, address, phone, gstin)
- Storage bucket: `vouchers` (separate from `invoices` bucket used for invoice PDFs)
- Schema migration: `schema/migration_04_voucher_pdf_url.sql` — ADD COLUMN pdf_url text to vouchers; note to create `vouchers` storage bucket in Supabase dashboard

</specifics>

<deferred>
## Deferred Ideas

### Phase 4 noted but out of scope
- **"Cancelled" watermark on existing invoice PDF:** When a bill is cancelled, stamp/overlay "CANCELLED" on the stored invoice PDF. Noted from Phase 2 context and Phase 3 deferred — not in VOUCH requirements, skip for now.

### Future Milestone
- **Send voucher via SMS/WhatsApp:** After cancellation, send the voucher PDF URL to the customer's phone. Same pattern as invoice delivery idea deferred from Phase 3.
- **Voucher redemption tracking:** Wiring the `redeemed`, `redeemed_at`, `redeemed_billid` fields on `vouchers` to actual redemption UX (apply voucher during billing). Out of scope for this milestone.

</deferred>

---

*Phase: 04-cancel-voucher-pdf*
*Context gathered: 2026-04-11*
