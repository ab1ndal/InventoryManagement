---
phase: 03-finalize-with-payment-pdf-invoice
plan: "02"
subsystem: billing
tags: [pdf-invoice, html2canvas, jspdf, supabase-storage, gst, invoice-layout]
dependency_graph:
  requires: [03-01]
  provides: [invoice-pdf-generation, supabase-storage-upload, pdf-url-persistence]
  affects: [BillingForm, InvoiceView, generateInvoicePdf]
tech_stack:
  added: []
  patterns: [html2canvas-capture, jspdf-blob, supabase-storage-upload, off-screen-render, error-isolation]
key_files:
  created:
    - src/admin/components/billing/InvoiceView.js
    - src/admin/components/billing/generateInvoicePdf.js
  modified:
    - src/admin/components/billing/BillingForm.js
decisions:
  - "InvoiceView uses inline styles only (no Tailwind/CSS classes) for reliable html2canvas bitmap capture"
  - "PDF failure wrapped in its own try/catch — DB finalize already committed, PDF can be reprinted from BillTable"
  - "Off-screen InvoiceView rendered at fixed top:-9999px so html2canvas can access DOM without user visibility"
  - "Customer and salesperson names resolved via useEffect + Supabase fetch for accurate invoice display"
metrics:
  duration_minutes: 20
  completed_date: "2026-04-10"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
requirements: [PRINT-01, PRINT-02]
---

# Phase 03 Plan 02: PDF Invoice Generation + Supabase Storage Summary

**One-liner:** Built InvoiceView A4 layout (BINDAL'S CREATION, GSTIN, CGST/SGST per-line) + generateInvoicePdf util (html2canvas → jsPDF blob) wired into handleConfirmFinalize with Storage upload, pdf_url persistence, and error-isolated PDF failure path.

---

## What Was Built

### Task 1: InvoiceView component (commit 95d893c)

Created `src/admin/components/billing/InvoiceView.js` as a `forwardRef` React component that renders a complete A4-proportioned Indian GST invoice layout for html2canvas capture.

Sections rendered (top to bottom):
1. **Store Header** — BINDAL'S CREATION (20px/600), tagline, address, phone, GSTIN 09ABVPB4203A1Z4
2. **Bill Metadata** — two-column flex: Bill No + Date (left), Customer + Salesperson(s) (right)
3. **Line Items Table** — 12 columns: S.No., Particulars, Size, Color, Qty, Rate, Disc, GST%, Taxable, CGST, SGST, Amount
4. **Totals Section** — Item Subtotal, Overall Discount (if codes applied), Grand Total (14px/600), Total CGST/SGST
5. **Payment Footer** — Payment Method + Amount Received
6. **Notes Footer** — "Goods once sold cannot be taken back." (left) + "Auth Signature" (right)

Per-line GST computation: `taxable = lineGross / (1 + gstRate/100)`, `cgst = sgst = taxable * (gstRate/2) / 100`.

All styles inline only — no CSS classes — for reliable html2canvas capture.

**Files:** `src/admin/components/billing/InvoiceView.js` (155 lines)

### Task 2: generateInvoicePdf utility (commit 0232afe)

Created `src/admin/components/billing/generateInvoicePdf.js` — a 45-line async named export utility.

- html2canvas captures the DOM node at scale 2 with white background and CORS enabled
- jsPDF creates A4 portrait (pt units, 595×842pt)
- Scales canvas to page width preserving aspect ratio
- Multi-page: iterates page-height chunks for tall invoices
- Returns `pdf.output("blob")`

**Files:** `src/admin/components/billing/generateInvoicePdf.js` (45 lines)

### Task 3: Wire into BillingForm (commit 96a4995)

Extended `BillingForm.js` with three sets of changes:

**Imports:** Added `useRef`, `InvoiceView`, `generateInvoicePdf`.

**State + refs:**
- `invoiceRef` — ref passed to off-screen InvoiceView for html2canvas
- `customerName` — resolved via useEffect on `selectedCustomerId` → `customers.name`
- `salespersonNames` — resolved via useEffect on `selectedSalespersonIds` → `salespersons.name`

**handleConfirmFinalize extension** (after existing DB sequence from Plan 01):
1. Generate PDF blob via `generateInvoicePdf(invoiceRef.current)`
2. Upload to `supabase.storage.from('invoices').upload('bill-{id}.pdf', blob, { upsert: true })`
3. Get public URL via `getPublicUrl`
4. UPDATE `bills SET pdf_url = publicUrl`
5. `window.open(pdfUrl, '_blank')` — opens invoice in new tab
6. PDF steps wrapped in own try/catch — failure shows destructive toast "PDF generation failed" / "Bill is finalized. You can reprint from the Bill List." without undoing DB finalize

**JSX:** Off-screen `<InvoiceView>` rendered at `fixed top:-9999px left:-9999px` with all required props wired.

**Files:** `src/admin/components/billing/BillingForm.js`

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] node_modules missing in worktree**
- **Found during:** Task 3 verification (npm run build)
- **Issue:** Worktree had an empty `node_modules/` directory — `html2canvas` and `jspdf` were not installed despite being in `package.json`
- **Fix:** Ran `npm install` in worktree directory
- **Files modified:** `node_modules/` (not committed — gitignored)

---

## Known Stubs

None. All functionality is wired end-to-end: InvoiceView renders complete invoice data, generateInvoicePdf produces a real PDF blob, BillingForm uploads to Storage and persists `pdf_url`.

---

## Threat Flags

None. No new network endpoints or auth paths introduced. Supabase Storage calls use existing anon key behind `RequireAdminAuth` guard. `pdf_url` is a public read URL for a PDF — no sensitive data exposure beyond what's already in the bill.

---

## Self-Check

| Item | Status |
|------|--------|
| src/admin/components/billing/InvoiceView.js | FOUND |
| src/admin/components/billing/generateInvoicePdf.js | FOUND |
| src/admin/components/billing/BillingForm.js (modified) | FOUND |
| commit 95d893c (InvoiceView) | FOUND |
| commit 0232afe (generateInvoicePdf) | FOUND |
| commit 96a4995 (BillingForm wiring) | FOUND |
| npm run build | PASSED |

## Self-Check: PASSED
