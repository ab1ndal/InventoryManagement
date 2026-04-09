# Phase 3: Finalize with Payment + PDF Invoice - Research

**Researched:** 2026-04-08
**Domain:** React PDF generation (html2canvas + jsPDF), Supabase Storage, Indian GST invoice layout, bill finalization flow
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use **jsPDF** (or html2canvas + jsPDF) to generate a PDF blob from an `InvoiceView` React component. Upload the blob to Supabase Storage bucket (`invoices`). Store a **permanent public URL** in `bills.pdf_url` via `supabase.storage.from('invoices').getPublicUrl()`.
- **D-02:** After successful upload and `pdf_url` save, immediately **open the PDF in a new tab** (or trigger browser print). Staff gets the invoice in front of them right away after finalizing.
- **D-03:** `pdf_url` is a permanent public URL — not a signed/expiring URL.
- **D-04:** Store details are hardcoded as constants in the `InvoiceView` component (no DB lookup):
  - Store name: **BINDAL'S CREATION**
  - Tagline: **A COMPLETE RANGE OF FAMILY WEAR**
  - Address: **58 Sihani Gate Market, Ghaziabad 201001**
  - Phone: **+91 9810873280 | +91 9810121438**
  - GSTIN: **09ABVPB4203A1Z4**
- **D-05:** Invoice layout follows **Indian GST invoice standards** — include GSTIN prominently, itemized GST breakdown (CGST + SGST or IGST), taxable value per line. Reference `src/assets/sample_bill.jpg` for existing store bill style.
- **D-06:** **Finalize is blocked if no customer is selected.** Show validation error: "Customer required to finalize."
- **D-07:** CUST-01 (update `customers.total_spend` and `last_purchased_at`) is always performed on finalize (no conditional skip).
- **D-08:** Payment fields stay **inline in BillingForm**. Clicking "Finalize":
  1. Validates inline (customer present, payment method + amount filled, amount within ₹100 of grandTotal)
  2. Opens a **confirmation dialog** showing bill total, payment method, amount received, and "Confirm & Finalize" button
  3. On confirm: execute the full finalize sequence (DB update → customer update → discount_usage → PDF generate → upload → open PDF)

### Claude's Discretion

- jsPDF vs html2canvas+jsPDF: choose whichever produces a cleaner result for the invoice layout — html2canvas captures the rendered React component as-is, jsPDF requires building the layout programmatically
- Supabase Storage bucket: use `invoices` bucket; file path `bill-{billid}.pdf`
- InvoiceView component: render off-screen (hidden div) during PDF capture; follow Indian GST invoice layout with reference to `src/assets/sample_bill.jpg` proportions
- Confirmation dialog: use existing Shadcn `Dialog` component (already imported in BillingForm)
- Error handling if PDF upload fails: show destructive toast with error, do not mark bill as unfinalized — bill DB state is already committed, PDF can be regenerated via BillTable reprint

### Deferred Ideas (OUT OF SCOPE)

- **Phase 4:** "Cancelled" watermark stamp on existing invoice PDF when bill is cancelled
- **Future Milestone:** Send PDF link to customer's phone via SMS/WhatsApp. Requires SMS/messaging API (Twilio, MSG91). Not Phase 3 scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BILL-04 | User can Finalize a draft bill (requires payment info, sets `finalized=true`, `paymentstatus='finalized'`, records discount usage) | handleFinalize stub exists in BillingForm.js ~line 377; need to implement full sequence |
| CUST-01 | Finalizing a bill updates `customers.total_spend` (+= grandTotal) and `customers.last_purchased_at` (= today) | customers table has both columns; UPDATE via Supabase client |
| PRINT-01 | PDF invoice shows: store header, bill ID, date, customer, salespersons, itemized table, overall discounts, GST total, grand total, payment method | InvoiceView component to be created; html2canvas + jsPDF pipeline |
| PRINT-02 | PDF invoice is saved to Supabase Storage; `bills.pdf_url` is updated | Supabase Storage `invoices` bucket; `upload()` + `getPublicUrl()` pattern |
| PRINT-03 | User can view/reprint saved PDF invoice from BillTable (opens pdf_url) | FileText icon in BillTable already present but disabled; wire to `window.open(pdf_url, '_blank')` |
| PRINT-04 | Invoice layout is A4-optimized with print-specific CSS (navbar/buttons hidden on print) | InvoiceView styled for A4; `position: fixed; top: -9999px` off-screen rendering during capture |
</phase_requirements>

---

## Summary

Phase 3 wires the complete finalize flow: a confirmation dialog, four sequential DB operations (bill update, customer update, discount_usage inserts), PDF generation, and Supabase Storage upload. The `handleFinalize` stub in BillingForm.js already has the validation shell; the bulk of work is implementing the body and building the `InvoiceView` component.

**PDF generation approach:** Use **html2canvas + jsPDF**. html2canvas renders the `InvoiceView` React component (rendered off-screen in a hidden fixed div) to a canvas, which is then embedded as an image into a jsPDF A4 document and output as a Blob. This approach is preferable here because it captures the exact CSS-styled layout (Tailwind, Indian column structure) without needing to rebuild layout logic in jsPDF's programmatic API. The tradeoff is that PDF text is non-selectable (rasterized), which is acceptable for a retail invoice.

**Supabase Storage:** The `invoices` bucket must be set to public in the Supabase dashboard. Upload uses `supabase.storage.from('invoices').upload('bill-{billid}.pdf', blob, { contentType: 'application/pdf', upsert: true })`. Then `getPublicUrl('bill-{billid}.pdf')` returns a permanent `data.publicUrl` string — no expiry.

**Primary recommendation:** Build `InvoiceView` as a standalone component with hardcoded store constants and a fixed A4 width (794px at 96dpi / 210mm). Capture it with html2canvas at `scale: 2` for print quality. Use `upsert: true` on upload to allow re-print regeneration. Keep DB commit and PDF upload as separate try/catch blocks so a PDF failure does not roll back the finalized bill state.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsPDF | 4.2.1 (npm latest) | PDF document creation from JavaScript | Widely adopted; supports `output('blob')` for Supabase upload |
| html2canvas | 1.4.1 (npm latest) | Renders DOM element to canvas for jsPDF embedding | Captures CSS-styled layout without programmatic rebuild |
| @supabase/supabase-js | 2.50.0 (installed) | Storage upload + getPublicUrl | Already in project; handles Blob upload natively |

**Neither jsPDF nor html2canvas is installed yet** — both need to be added.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.516.0 (installed) | FileText icon for BillTable Print button | Already used for Pencil/Trash2 icons |
| Shadcn Dialog | already installed | Confirmation dialog before finalize | Already imported in BillingForm.js |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| html2canvas + jsPDF | jsPDF programmatic API only | jsPDF-only gives selectable text but requires rebuilding full layout in JS coordinates — high maintenance |
| html2canvas + jsPDF | react-pdf / @react-pdf/renderer | react-pdf gives selectable text and smaller files but requires a completely different JSX render model; not worth switching for a single invoice |
| html2canvas + jsPDF | html2pdf.js (wrapper) | html2pdf.js wraps both but adds another dependency; using libraries directly gives more control |

**Installation:**
```bash
npm install jspdf html2canvas
```

**Version verification (confirmed 2026-04-08):**
- `jspdf`: 4.2.1
- `html2canvas`: 1.4.1

---

## Architecture Patterns

### Recommended File Structure

```
src/
├── admin/
│   ├── components/
│   │   ├── billing/
│   │   │   ├── BillingForm.js          # handleFinalize — extend (EXISTING)
│   │   │   ├── InvoiceView.js          # NEW: off-screen invoice layout
│   │   │   ├── generateInvoicePdf.js   # NEW: html2canvas+jsPDF async util
│   │   │   └── __tests__/
│   │   │       └── billUtils.test.js   # EXISTING; add GST split unit tests
│   │   └── BillTable.js               # Wire FileText icon (EXISTING)
```

### Pattern 1: Off-Screen Component Capture

The `InvoiceView` component is rendered into a `div` that is visually hidden but still present in the DOM (not `display:none`, which would prevent html2canvas from measuring layout). The standard approach is `position: fixed; top: -9999px; left: -9999px`.

```jsx
// In BillingForm.js JSX (simplified)
<div
  ref={invoiceRef}
  style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '794px' }}
>
  <InvoiceView bill={billData} items={items} computed={computed} />
</div>
```

html2canvas then captures `invoiceRef.current`:

```javascript
// Source: html2canvas.hertzen.com/configuration + nutrient.io guide
const canvas = await html2canvas(invoiceRef.current, {
  scale: 2,            // 2x for print clarity; default is devicePixelRatio (~1-2)
  useCORS: true,       // allow cross-origin images if any store logo added later
  backgroundColor: '#ffffff',
  logging: false,
});
const imgData = canvas.toDataURL('image/png');
```

### Pattern 2: jsPDF A4 Blob Output

```javascript
// Source: jsPDF docs + nutrient.io guide
import jsPDF from 'jspdf';

const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
const pageWidth  = pdf.internal.pageSize.getWidth();
const pageHeight = (canvas.height * pageWidth) / canvas.width;
pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
const blob = pdf.output('blob');   // Returns Blob, not a download
```

**Important:** `unit: 'px'` aligns with the 794px DOM width. `unit: 'mm'` with `format: 'a4'` also works but requires scaling math.

### Pattern 3: Supabase Storage Upload

```javascript
// Source: supabase.com/docs/reference/javascript/storage-from-upload
const filePath = `bill-${billId}.pdf`;
const { error: uploadErr } = await supabase.storage
  .from('invoices')
  .upload(filePath, blob, {
    contentType: 'application/pdf',
    upsert: true,   // overwrite if re-printing/regenerating
  });
if (uploadErr) throw new Error('PDF upload failed: ' + uploadErr.message);

const { data: urlData } = supabase.storage
  .from('invoices')
  .getPublicUrl(filePath);
const pdfUrl = urlData.publicUrl;  // permanent, non-expiring
```

**Prerequisite:** The `invoices` bucket must be created and marked **public** in the Supabase dashboard (Storage → New Bucket → toggle "Public"). `getPublicUrl` does not verify bucket publicity; it will always return a URL, but downloads will fail if the bucket is private.

### Pattern 4: Finalize Sequence (handleFinalize implementation)

The complete finalize sequence, keeping DB commit and PDF as separate try/catch:

```javascript
// Phase A — validate
if (!selectedCustomerId) {
  toast({ title: "Customer required to finalize.", variant: "destructive" });
  return;
}
if (!paymentMethod || !paymentAmount) { /* existing validation */ }
if (Math.abs(paidAmt - grandTotal) > 100) { /* existing tolerance check */ }

// Phase B — open confirmation dialog (set state to show dialog)
setShowConfirmDialog(true);

// Phase C — on confirm:
setIsSaving(true);
try {
  // Step 1: Update bills
  await supabase.from('bills').update({
    finalized: true,
    paymentstatus: 'finalized',
    payment_method: paymentMethod,
    payment_amount: Number(paymentAmount),
  }).eq('billid', billId);

  // Step 2: Update customer
  await supabase.from('customers').update({
    total_spend: supabase.rpc('...') // or use raw increment below
    last_purchased_at: new Date().toISOString().split('T')[0],
  }).eq('customerid', selectedCustomerId);
  // NOTE: use SQL increment pattern (see Pitfall 2)

  // Step 3: Insert discount_usage rows
  if (selectedCodes.length > 0) {
    await supabase.from('discount_usage').insert(
      selectedCodes.map(code => ({
        customerid: selectedCustomerId,
        code,
        billid: billId,
      }))
    );
  }

  toast({ title: `Bill #${billId} finalized` });
  onOpenChange?.(false);
  onSubmit?.();
} catch (e) {
  toast({ title: "Finalize failed", description: e.message, variant: "destructive" });
  setIsSaving(false);
  return;  // stop before PDF generation
} finally { /* pdf step below */ }

// Phase D — PDF (separate try, bill is already finalized)
try {
  const blob = await generateInvoicePdf(invoiceRef.current);
  const filePath = `bill-${billId}.pdf`;
  await supabase.storage.from('invoices').upload(filePath, blob, {
    contentType: 'application/pdf', upsert: true,
  });
  const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(filePath);
  await supabase.from('bills').update({ pdf_url: urlData.publicUrl }).eq('billid', billId);
  window.open(urlData.publicUrl, '_blank');
} catch (e) {
  toast({ title: "PDF upload failed — bill is finalized but PDF was not saved.", description: e.message, variant: "destructive" });
} finally {
  setIsSaving(false);
}
```

### Pattern 5: Customer total_spend Increment (avoiding race condition)

Do NOT read then write `total_spend`. Use Supabase RPC or a raw SQL update via `rpc`:

```javascript
// Option A: Supabase RPC (requires creating a DB function — adds schema migration)
// Option B: Direct increment using Postgres expression via .rpc('increment_spend', {...})
// Option C: Simplest — fetch current value then add (acceptable for single-staff retail, low concurrency)
const { data: cust } = await supabase
  .from('customers')
  .select('total_spend')
  .eq('customerid', selectedCustomerId)
  .single();
const newSpend = (Number(cust.total_spend) || 0) + grandTotal;
await supabase.from('customers').update({
  total_spend: newSpend,
  last_purchased_at: new Date().toISOString().split('T')[0],
}).eq('customerid', selectedCustomerId);
```

**Recommendation:** Use Option C (fetch + add). This is a single-staff retail POS — concurrent finalization of two bills for the same customer simultaneously is not a real risk. Keeps the plan simple (no new RPC needed).

### Pattern 6: InvoiceView GST Layout (Indian standard)

For intra-state supply (Ghaziabad, UP → customer in UP): show **CGST + SGST** split (50/50 of the GST rate).

```jsx
// GST split calculation — each item contributes its proportional share
// CGST = gstAmount / 2, SGST = gstAmount / 2
// Display as separate columns in the line items table
```

**Indian GST mandatory fields on invoice:**
- Supplier GSTIN (09ABVPB4203A1Z4)
- Invoice number and date
- Customer name (GSTIN only if customer is registered — B2C retail: not required)
- HSN/SAC codes — for B2C invoices under ₹50,000 threshold, HSN is optional but recommended for compliance
- Description, quantity, unit
- Taxable value per line
- GST rate per line + CGST / SGST amounts
- Total taxable value, total CGST, total SGST, grand total
- "Auth. Signature" field (can be a printed line, per sample_bill.jpg)

**Sample bill analysis (`src/assets/sample_bill.jpg`):**
The physical bill shows: store name + logo top-center, tagline, address, phones, GSTIN on header. Body has columns: S.No. | Particulars | Qty | Rate | Amount. Footer: Net Amount, space for Auth Signature. The layout is simple columnar — no multi-column GST breakdown at line level; GST totals appear at the bottom. The digital invoice should follow this structure but add CGST/SGST split at the footer for compliance.

### Anti-Patterns to Avoid

- **`display: none` for InvoiceView:** html2canvas cannot measure hidden elements — use `position: fixed; top: -9999px` instead.
- **Uploading without `upsert: true`:** Re-printing will fail with a "duplicate object" error.
- **Reading `pdf_url` from `bills` before Phase 3 migration runs:** Columns `payment_method` and `payment_amount` were added in Phase 2 migrations; `pdf_url` already exists in `initial_schema.sql`.
- **Updating customer spend inside the PDF try/catch:** If PDF fails, the customer spend rollback would be wrong. Keep DB commits separate from PDF generation (as shown in Pattern 4).
- **Opening PDF before uploading:** Always wait for `upload()` + `getPublicUrl()` to complete before calling `window.open()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DOM-to-PDF conversion | Custom canvas drawing API | html2canvas + jsPDF | Cross-browser CSS capture; handles Tailwind, flexbox, etc. |
| PDF Blob creation | Manual binary encoding | `jsPDF.output('blob')` | jsPDF handles PDF spec compliance |
| File storage + CDN | Express upload endpoint | Supabase Storage | Already in project; handles auth, CDN, public URLs |
| Multi-page PDF handling | Manual page-split math | jsPDF addPage + canvas segmentation | jsPDF calculates page boundaries; for a single-page A4 invoice this is rarely needed |

**Key insight:** The entire PDF generation pipeline (DOM capture → canvas → PDF → blob → upload → URL) is 25-30 lines of code using these libraries. Any custom implementation would need to solve CSS rendering, PDF binary format, and storage separately.

---

## Common Pitfalls

### Pitfall 1: Off-Screen Element Not Rendered by html2canvas
**What goes wrong:** `InvoiceView` rendered with `display: none` or inside a modal that isn't mounted produces a blank PDF.
**Why it happens:** html2canvas requires the element to be in the DOM and have computed layout.
**How to avoid:** Render InvoiceView with `position: fixed; top: -9999px; left: -9999px; width: 794px` — visually invisible but DOM-rendered.
**Warning signs:** Canvas width/height is 0; resulting PDF is blank.

### Pitfall 2: Supabase Storage Bucket Not Public
**What goes wrong:** `getPublicUrl()` returns a URL, but accessing it returns a 403 / "Invalid URL" error.
**Why it happens:** `getPublicUrl` always returns a formatted URL regardless of bucket visibility; access fails at CDN layer if bucket is private.
**How to avoid:** Explicitly create `invoices` bucket as public in Supabase dashboard before testing. Include a Wave 0 task to verify bucket exists and is public.
**Warning signs:** PDF URL is formed correctly (`*.supabase.co/storage/v1/object/public/invoices/...`) but returns 403.

### Pitfall 3: Missing Phase 2 Migrations Break Finalize
**What goes wrong:** `UPDATE bills SET payment_method=...` throws a column-not-found error if migrations haven't been run.
**Why it happens:** `payment_method` and `payment_amount` columns were added in `migration_02_payment_fields.sql` which requires manual execution in Supabase dashboard.
**How to avoid:** STATE.md lists four pending migrations as todos. Wave 0 must verify migrations are applied or include them as a prerequisite.
**Warning signs:** Supabase error "column payment_method does not exist".

### Pitfall 4: html2canvas scale=2 Doubles Canvas Dimensions
**What goes wrong:** With `scale: 2`, canvas.width = 1588px (not 794px). jsPDF `addImage` with wrong width/height distorts the PDF.
**Why it happens:** scale multiplies both canvas dimensions. jsPDF pageWidth must be used for image placement, not canvas.width.
**How to avoid:** Always calculate proportional height: `const pageHeight = (canvas.height * pageWidth) / canvas.width;`. Never use canvas.width/height directly as jsPDF dimensions.
**Warning signs:** PDF image is half-size or squeezed.

### Pitfall 5: Confirmation Dialog Uses Same `isSaving` State
**What goes wrong:** "Confirm & Finalize" button is disabled immediately when the confirmation dialog opens (because `isSaving` was set before dialog opened).
**Why it happens:** `setIsSaving(true)` called before `setShowConfirmDialog(true)`.
**How to avoid:** Open the dialog first (state-only, no async work), then set `isSaving(true)` only when the user clicks "Confirm & Finalize" inside the dialog.

### Pitfall 6: discount_usage customerid NOT NULL Constraint
**What goes wrong:** `INSERT INTO discount_usage` fails if `selectedCustomerId` is null.
**Why it happens:** `discount_usage.customerid` is defined `NOT NULL` in `initial_schema.sql`. D-06 blocks finalize without a customer, which prevents this — but only if the customer validation runs before the discount_usage insert.
**How to avoid:** Ensure customer validation (D-06) executes before any DB writes in handleFinalize. The confirmation dialog flow naturally enforces this.

### Pitfall 7: `getPublicUrl` Returns Object Not String
**What goes wrong:** Code stores the entire object (`{ data: { publicUrl: '...' } }`) as `pdf_url` instead of the URL string.
**Why it happens:** `getPublicUrl()` returns `{ data: { publicUrl: string } }`, not a bare string. It does NOT return an error object (unlike `upload()`).
**How to avoid:** Always extract: `const pdfUrl = supabase.storage.from('invoices').getPublicUrl(path).data.publicUrl;`
**Warning signs:** `bills.pdf_url` column contains `[object Object]`.

---

## Code Examples

### Complete generateInvoicePdf Utility

```javascript
// src/admin/components/billing/generateInvoicePdf.js
// Source: nutrient.io jsPDF guide + html2canvas.hertzen.com/configuration
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Captures a DOM element and returns a PDF Blob.
 * @param {HTMLElement} element - The InvoiceView DOM node
 * @returns {Promise<Blob>}
 */
export async function generateInvoicePdf(element) {
  const canvas = await html2canvas(element, {
    scale: 2,               // 2x resolution for print clarity
    useCORS: true,          // handle cross-origin images if store logo is added
    backgroundColor: '#ffffff',
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = (canvas.height * pageWidth) / canvas.width;

  pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
  return pdf.output('blob');
}
```

### InvoiceView Component Skeleton

```jsx
// src/admin/components/billing/InvoiceView.js
// Hardcoded store constants per D-04; Indian GST layout per D-05

const STORE = {
  name: "BINDAL'S CREATION",
  tagline: "A COMPLETE RANGE OF FAMILY WEAR",
  address: "58 Sihani Gate Market, Ghaziabad 201001",
  phone: "+91 9810873280 | +91 9810121438",
  gstin: "09ABVPB4203A1Z4",
};

export default function InvoiceView({ bill, items, computed, customer, salespersons }) {
  // GST split: CGST = gstTotal/2, SGST = gstTotal/2 (intra-state, UP)
  const cgst = computed.gstTotal / 2;
  const sgst = computed.gstTotal / 2;

  return (
    <div style={{ width: '794px', fontFamily: 'serif', padding: '32px', backgroundColor: '#fff' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', borderBottom: '2px solid black', paddingBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 'bold', margin: 0 }}>{STORE.name}</h1>
        <p style={{ margin: 4 }}>{STORE.tagline}</p>
        <p style={{ margin: 2, fontSize: 12 }}>{STORE.address}</p>
        <p style={{ margin: 2, fontSize: 12 }}>Ph: {STORE.phone}</p>
        <p style={{ margin: 2, fontSize: 12 }}>GSTIN: {STORE.gstin}</p>
      </div>

      {/* Bill meta */}
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0' }}>
        <div>Bill No: {bill.billid}</div>
        <div>Date: {new Date(bill.orderdate).toLocaleDateString('en-IN')}</div>
      </div>
      <div>Customer: {customer?.first_name} {customer?.last_name} | {customer?.phone}</div>
      {salespersons?.length > 0 && (
        <div>Staff: {salespersons.map(s => s.name).join(', ')}</div>
      )}

      {/* Line items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid black' }}>
            <th style={{ textAlign: 'left' }}>S.No.</th>
            <th style={{ textAlign: 'left' }}>Particulars</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Rate</th>
            <th style={{ textAlign: 'right' }}>Disc</th>
            <th style={{ textAlign: 'right' }}>Taxable</th>
            <th style={{ textAlign: 'right' }}>GST%</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => { /* per-line rendering */ })}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <div>Taxable Value: ₹{computed.taxableTotal.toFixed(2)}</div>
        <div>CGST: ₹{cgst.toFixed(2)}</div>
        <div>SGST: ₹{sgst.toFixed(2)}</div>
        {(computed.itemLevelDiscountTotal + computed.overallDiscount) > 0 && (
          <div>Discount: ₹{(computed.itemLevelDiscountTotal + computed.overallDiscount).toFixed(2)}</div>
        )}
        <div style={{ fontWeight: 'bold', fontSize: 16 }}>Grand Total: ₹{computed.grandTotal.toFixed(2)}</div>
        <div>Payment: {bill.payment_method?.toUpperCase()} — ₹{bill.payment_amount}</div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10 }}>
          Note: Goods once sold cannot be taken back.
        </div>
        <div>Auth. Signature</div>
      </div>
    </div>
  );
}
```

### BillTable Print Icon Wiring

```jsx
// In BillTable.js — replace disabled FileText button for finalized rows
<Button
  size="icon"
  variant="ghost"
  disabled={!b.pdf_url}
  onClick={() => b.pdf_url && window.open(b.pdf_url, '_blank')}
  title={b.pdf_url ? "View invoice PDF" : "No PDF yet"}
  className={!b.pdf_url ? "opacity-40 cursor-not-allowed" : ""}
>
  <FileText className="h-4 w-4" />
</Button>
```

BillTable's SELECT query must include `pdf_url` (currently not selected — needs to be added to the query).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| QZ Tray for label printing | window.print() / browser PDF | Phase 2 decision | QZ Tray dependency removed from print flow |
| Signed URLs for storage | Permanent public URLs (D-03) | Phase 3 decision | No URL expiry management needed |
| jsPDF programmatic layout | html2canvas + jsPDF | Phase 3 decision | CSS layout captured as-is; no coordinate math |

**Deprecated/outdated:**
- `qz-tray` package: still in package.json but print flow no longer uses it. Phase 3 does not remove it.

---

## Open Questions

1. **Supabase Storage `invoices` bucket — does it exist?**
   - What we know: D-01 specifies this bucket; it is not in `initial_schema.sql` (Storage buckets are managed via dashboard or Supabase Storage API, not SQL migrations)
   - What's unclear: Whether the bucket has already been created in the project's Supabase instance
   - Recommendation: Wave 0 task — verify bucket exists and is public. Create it via dashboard if missing. The plan should include an explicit "create bucket" step as a manual prerequisite.

2. **BillTable query does not select `pdf_url`**
   - What we know: Current BillTable SELECT query lists specific columns and does not include `pdf_url` or `finalized`
   - What's unclear: Whether there's an existing `finalized` column fetch needed for conditional icon rendering
   - Recommendation: Add `pdf_url, finalized` to the BillTable SELECT columns. This is a code-only change, no migration.

3. **Customer name and salesperson names for InvoiceView — data availability in BillingForm**
   - What we know: `selectedCustomerId` is stored in form state but customer name is only known inside `CustomerSelector` component; salesperson IDs are in `selectedSalespersonIds` but names require a lookup
   - What's unclear: Whether BillingForm should fetch customer name + salesperson names separately for invoice rendering, or pass them through component props
   - Recommendation: At finalize time, fetch customer details (`first_name, last_name, phone`) and salesperson names from Supabase using the IDs already in state. Store results in local variables for InvoiceView props. This is a two-query fetch at finalize time, not a persistent state change.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| jsPDF | PDF generation (PRINT-01, PRINT-02) | ✗ — not installed | — | None; must install |
| html2canvas | DOM-to-canvas capture | ✗ — not installed | — | None; must install |
| @supabase/supabase-js | Storage upload | ✓ | 2.50.0 | — |
| Supabase `invoices` bucket | PDF storage (PRINT-02) | Unknown | — | Must create via dashboard |
| Node.js / npm | Package install | ✓ | — | — |

**Missing dependencies with no fallback:**
- `jspdf` and `html2canvas` — must be installed before any PDF task can execute
- `invoices` Storage bucket — must be created and set to public in Supabase dashboard

**Missing dependencies with fallback:**
- None

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (via react-scripts) + @testing-library/react |
| Config file | package.json (jest config in react-scripts defaults) |
| Quick run command | `npm test -- --watchAll=false --testPathPattern=billing` |
| Full suite command | `npm test -- --watchAll=false` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BILL-04 | handleFinalize validates customer required | unit | `npm test -- --watchAll=false --testPathPattern=BillingForm` | ❌ Wave 0 |
| BILL-04 | handleFinalize validates payment method + amount | unit | `npm test -- --watchAll=false --testPathPattern=BillingForm` | ❌ Wave 0 |
| CUST-01 | Customer spend updated on finalize | unit (mock Supabase) | `npm test -- --watchAll=false --testPathPattern=BillingForm` | ❌ Wave 0 |
| PRINT-01 | InvoiceView renders store header + all required fields | unit | `npm test -- --watchAll=false --testPathPattern=InvoiceView` | ❌ Wave 0 |
| PRINT-01 | GST split: CGST = SGST = gstTotal/2 | unit | `npm test -- --watchAll=false --testPathPattern=InvoiceView` | ❌ Wave 0 |
| PRINT-02 | Supabase upload called with correct path + contentType | unit (mock) | `npm test -- --watchAll=false --testPathPattern=generateInvoicePdf` | ❌ Wave 0 |
| PRINT-03 | BillTable shows enabled FileText icon when pdf_url is set | unit | `npm test -- --watchAll=false --testPathPattern=BillTable` | ❌ Wave 0 |
| PRINT-04 | InvoiceView renders at 794px width | unit | `npm test -- --watchAll=false --testPathPattern=InvoiceView` | ❌ Wave 0 |

**Note:** html2canvas and jsPDF involve browser APIs (Canvas, DOM measurement) that do not work in jsdom. `generateInvoicePdf` integration testing should be manual (visual inspection). Unit tests for this layer focus on mocking the utility function and verifying the upload path.

### Sampling Rate
- **Per task commit:** `npm test -- --watchAll=false --testPathPattern=billing`
- **Per wave merge:** `npm test -- --watchAll=false`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/admin/components/billing/__tests__/finalizeFlow.test.js` — covers BILL-04, CUST-01 (mock supabase)
- [ ] `src/admin/components/billing/__tests__/InvoiceView.test.js` — covers PRINT-01, PRINT-04
- [ ] `src/admin/components/__tests__/BillTable.test.js` — covers PRINT-03
- [ ] Install jsPDF + html2canvas: `npm install jspdf html2canvas`

---

## Project Constraints (from CLAUDE.md)

- **No server-side code** — all Supabase calls directly from React components/handlers (PDF generation is client-side, Storage upload goes direct from browser)
- **Supabase client** via `src/lib/supabaseClient.js` (already imported in BillingForm)
- **UI:** Shadcn/ui components; Tailwind CSS; no custom CSS files unless needed for InvoiceView print styles
- **Toast:** `useToast()` hook; `{ title, description, variant: "destructive" }` for errors; plain `{ title }` for success
- **State:** `useState`/`useEffect` only — no Redux/global store
- **Path alias:** `@/*` maps to `src/*` — usable in imports
- **File extensions:** `.js` is acceptable for new components (project mixes `.js` and `.jsx`)
- **Schema migrations** go in `schema/migration_03_*.sql` files (per MEMORY.md: separate files, not inline edits to `initial_schema.sql`)

---

## Sources

### Primary (HIGH confidence)
- html2canvas official docs (html2canvas.hertzen.com/configuration) — all configuration options verified
- nutrient.io jsPDF + html2canvas guide — step-by-step React integration pattern verified
- supabase.com/docs/reference/javascript/storage-from-getpublicurl — `getPublicUrl` API
- jsPDF npm registry — version 4.2.1 confirmed via `npm view jspdf version`
- html2canvas npm registry — version 1.4.1 confirmed via `npm view html2canvas version`
- `initial_schema.sql` — schema verified directly (bills.pdf_url exists; customers.total_spend, last_purchased_at exist; discount_usage.customerid NOT NULL)
- `BillingForm.js` — handleFinalize stub at line 377 verified directly
- `BillTable.js` — FileText icon placeholder at line 131 verified directly

### Secondary (MEDIUM confidence)
- cleartax.in/s/gst-invoice — Indian GST mandatory invoice fields for B2C retail
- captainbiz.com intra-state vs inter-state GST rules — CGST + SGST for intra-state (UP) confirmed
- supabase.com/docs/guides/storage/buckets/fundamentals — public vs private bucket behavior

### Tertiary (LOW confidence)
- WebSearch results on html2canvas off-screen rendering pitfall (GitHub issues #117, #622) — community-reported, not official docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry confirmed versions; @supabase already installed
- Architecture: HIGH — patterns derived from official docs and direct code reading
- Pitfalls: HIGH for buckets/migrations (schema verified); MEDIUM for html2canvas off-screen (community-verified)
- GST layout: MEDIUM — cleartax + captainbiz sources; HSN requirement confirmed as optional for B2C under threshold

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable libraries; Supabase Storage API unlikely to change)
