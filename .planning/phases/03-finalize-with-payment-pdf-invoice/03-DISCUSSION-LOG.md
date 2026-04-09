# Phase 3: Finalize with Payment + PDF Invoice - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 03-finalize-with-payment-pdf-invoice
**Areas discussed:** PDF storage, Invoice store header, Finalize without customer, Finalize confirmation UX

---

## PDF Storage

| Option | Description | Selected |
|--------|-------------|----------|
| jsPDF upload to Storage | Generate PDF blob, upload to Supabase Storage, save permanent public URL to bills.pdf_url | ✓ |
| window.print() only, no storage | Trigger browser print dialog on finalize, set pdf_url = null, add Reprint button | |

**User's choice:** jsPDF upload to Supabase Storage

---

| Option | Description | Selected |
|--------|-------------|----------|
| Upload + open/print immediately | Upload, then open PDF in new tab or trigger print | ✓ |
| Upload silently | Upload only; staff prints later from BillTable | |

**User's choice:** Upload and open/print immediately after finalize

---

| Option | Description | Selected |
|--------|-------------|----------|
| Signed URL, 15-day expiry | createSignedUrl() with 15-day TTL | |
| Permanent public URL | Public bucket, permanent link | ✓ |

**User's choice:** Permanent public URL
**Notes:** User initially mentioned sending PDF to customer's phone with a 15-day expiry link — noted as deferred (requires SMS/WhatsApp API, out of Phase 3 scope)

---

## Invoice Store Header

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded in component | Store details as constants in InvoiceView | ✓ |
| Config table in Supabase | store_settings table, fetched on render | |

**User's choice:** Hardcoded in InvoiceView component

**Store details confirmed:**
- Name: BINDAL'S CREATION
- Tagline: A COMPLETE RANGE OF FAMILY WEAR
- Address: 58 Sihani Gate Market, Ghaziabad 201001
- Phone: +91 9810873280 | +91 9810121438
- GSTIN: 09ABVPB4203A1Z4

**Notes:** User referenced `src/assets/sample_bill.jpg` as existing bill style reference. User confirmed readiness to follow Indian retail GST invoice standards.

---

## Finalize Without Customer

| Option | Description | Selected |
|--------|-------------|----------|
| Block finalize if no customer | Validation error: "Customer required to finalize" | ✓ |
| Allow finalize, skip discount tracking | Skip discount_usage inserts if no customer | |

**User's choice:** Always block finalize without customer

---

| Option | Description | Selected |
|--------|-------------|----------|
| Required — always block finalize without customer | All finalized bills require a customer | ✓ |
| CUST-01 only when customer present | Skip total_spend update if no customer | |

**User's choice:** Always block — all finalized bills require a customer

---

## Finalize Confirmation UX

| Option | Description | Selected |
|--------|-------------|----------|
| Validate inline, show confirmation dialog | Payment stays inline; Finalize opens confirmation dialog with totals summary | ✓ |
| Validate inline, proceed immediately | If payment valid, finalize proceeds directly with no extra step | |

**User's choice:** Confirmation dialog before committing

---

## Claude's Discretion

- jsPDF vs html2canvas+jsPDF: choose based on what produces cleanest layout
- Supabase Storage bucket: `invoices`, file path `bill-{billid}.pdf`
- InvoiceView off-screen rendering approach
- Error handling if PDF upload fails post-DB commit

## Deferred Ideas

- Send PDF link to customer's phone via SMS/WhatsApp (requires messaging API — future milestone)
- "Cancelled" stamp on existing PDFs (Phase 4)
