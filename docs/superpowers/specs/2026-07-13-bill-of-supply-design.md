# Bill of Supply — Design Spec

**Date:** 2026-07-13
**Status:** Approved design, pre-implementation

## Background & Problem

The business operates under the **GST composition scheme** and therefore may not
collect GST or issue tax invoices — it must issue a **Bill of Supply**.

Reality of the data today:

- Customers were handed **hand-written Bills of Supply** (correct document, no tax).
- The app, however, generated **GST-style invoices for internal records** — showing
  fabricated CGST/SGST that was **never collected and never filed** (no GSTR-4 / CMP-08).
- The **rupee total actually received is correct** in `bills.totalamount`. Only the
  *breakdown* is fiction: the engine auto-added GST, and the operator inflated the
  `discount` field to cancel it back to the intended amount.

There is **no tax-collection or filing exposure** — this is a records-accuracy problem,
not a legal one. (A CA can confirm, but nothing was collected or filed.)

Worked example (operator's own): item MRP 1000, sold for 800, collected 800. Engine
added GST 200 + alteration 100; operator set `discount = 500` so
`1000 + 100 + 200 − 500 = 800`. Truth: value 1000, real discount 200, GST 0,
alteration absorbed.

## Goals

1. **Phase 1 (this spec, build now):** New sales issue proper Bills of Supply by default.
   Preserve the existing Tax Invoice flow for a future regular-GST company.
2. **Phase 2 (separate, later):** Relabel the 212 historical FY26 bills as Bills of
   Supply and correct their breakdown, without changing any received total.

## Out of Scope (YAGNI)

- **Multi-company / entity dimension.** A second company with regular GST is planned
  *later*. Do not build multi-tenant plumbing now. When it lands it is an additive
  column on `bills` + filtering, not a rewrite.
- Phase 2 historical correction is **not** built in this phase — separate plan.

## Data Findings (verified against live DB, 2026-07-13)

- **212 finalized bills**, all in FY26 (2026-04-01 → 2026-07-05). Single financial year.
- Identity holds: `total = Σ(MRP×qty) − discount + alteration + gst`.
- Therefore the robust reconstruction `realDiscount = Σmrp + alteration − total`
  reconciles to cash received **by construction**, independent of the fudged columns.
- Anomalies for Phase 2 manual review: **2 bills** where `total > Σmrp` (paid above MRP,
  need a surcharge line), **6 bills** using store/exchange credit.
- Existing bills already carry `FY26-000NNN` numbers → **no renumbering needed** in
  Phase 2; BoS keeps that same series.

---

## Phase 1 — Forward-looking Bill of Supply

### Schema (`schema/migration_*.sql`)

- Add `bills.document_type text NOT NULL DEFAULT 'bos'` with values `'invoice' | 'bos'`.
  Default `'bos'` → new bills are Bills of Supply unless explicitly toggled.
- Alter `bill_sequences`: add `document_type text`, backfill existing rows to `'bos'`,
  set PK to `(financial_year, document_type)`. The current FY26 counter (~216) becomes
  the **BoS** counter; the `invoice` counter starts fresh at 0.
- Update `set_bill_number()` trigger to key the sequence by `(financial_year,
  document_type)` and format by type:
  - `bos` → `FY{YY}-{LPAD(seq,6,'0')}` — e.g. `FY26-000217` (existing series continues).
  - `invoice` → `FY{YY}-SG{LPAD(seq,4,'0')}` — e.g. `FY26-SG0001`.

### Pricing (BoS)

No GST anywhere. `total = Σ(MRP×qty) + alteration − discount`. Per item
`gst_rate = null`, `gst_amount = 0`; bill `gst_total = 0`, `taxable_total = total`.
Alteration remains a **visible charge line** (not folded into discount).

### Form

`BillingForm` gains a `docType` selection (toggle), **default `bos`**:

- BoS mode: hides all GST UI, forces the zero-tax path in `billUtils`, keeps alteration
  as a visible line. Discount, exchange, store credit, payment, stock deduction — all
  reused unchanged.
- Invoice mode: current behavior, unchanged.

Reuse `BillingForm` with the mode prop rather than forking a slim form — the flow is
identical minus tax, so a mode flag is the minimal, drift-free change. Tax computation
already lives in `billUtils`; gate it on `docType`.

### Render

New `BillOfSupplyView` + PDF generator:

- Title **"Bill of Supply"** (not "Tax Invoice" / "Invoice").
- **No tax columns** (no CGST/SGST/rate/taxable split).
- Line items: value, alteration line, discount, total.
- Mandatory composition declaration:
  *"Composition taxable person, not eligible to collect tax on supplies."*
- Seller GSTIN shown.

### Nav / List

- `BillTable` shows a **Type** column and a filter (Invoice / Bill of Supply).
- Both document types are created from the existing billing page via the toggle
  (doc-type is per-bill, not per-page — no separate route). A dedicated
  `/admin/bill-of-supply` URL is deliberately not added.

### Edge cases

- Exchange / store-credit bills: document value = `total` regardless of tender; unaffected.
- Backdated bills: FY derived from `orderdate` as today (Indian Apr–Mar).
- Toggling doc-type after items are added must recompute totals.

### Testing

- `billUtils` unit tests: BoS path yields `gst = 0`, `total = Σmrp + alteration − discount`.
- Trigger test: BoS insert → `FY26-…`; invoice insert → `FY26-SG…`; counters independent.
- Render test: BoS view/PDF shows declaration, no tax columns, alteration line present.

---

## Phase 2 — Historical relabel (separate plan, later)

Not built now. Recorded here so Phase 1 leaves room for it.

- Core mechanic: **strip the fabricated GST back out of the discount and set GST to 0**,
  keeping the received total unchanged. For a bill with no alteration this is literally
  `newDiscount = oldDiscount − gst`.
- General (alteration-safe) form: `discount = Σmrp + alteration − total`, `gst = 0`,
  **total unchanged**. This is algebraically the same as `oldDiscount − gst` for the 206
  no-alteration bills.
- **Alteration bills need the anchor-to-cash form.** Alteration was entered GST-inclusive,
  so its GST is bundled inside stored `gst_amount`. Removing *all* GST from the discount
  while showing gross alteration would drift the total by that alteration-GST (e.g. bill
  220 drifts 9.52). Using `discount = Σmrp + alteration − total` ties the total back to
  cash and keeps alteration a clean line.
- Alteration stays visible (from stored `alteration_charge`, gross).
- **Immutable backup** of original rows (212 rows — cheap) before any mutation; reversible.
- **No renumbering** — existing `FY26-000NNN` numbers are already the BoS series.
- Regenerate the 212 stored PDFs as Bill of Supply documents.
- Manually review: 2 over-MRP bills (surcharge line), 6 credit bills.

## Open items

- Seller GSTIN + exact declaration wording: confirm final legal text with owner/CA
  before Phase 1 render ships (placeholder acceptable during build).
