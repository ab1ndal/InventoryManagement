# Bill of Supply — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the billing flow issue a GST-free **Bill of Supply** (default for new bills) alongside the existing Tax Invoice, each with its own consecutive number series.

**Architecture:** A per-bill `document_type` discriminator (`'invoice' | 'bos'`, default `'bos'`) drives everything. The DB trigger picks the number series by type. `billUtils`/`stockHelpers` gain a `docType` argument that zeroes tax and counts alteration at full value for `bos`. `Summary`, `InvoiceView`, and `BillTable` render conditionally on `docType`/`document_type`. `BillingForm` holds a `docType` toggle (default `bos`) and threads it into computation, persistence, and rendering. The Tax Invoice path is unchanged when `docType === 'invoice'` (the default of every function argument), so existing behavior is preserved for the future regular-GST company.

**Tech Stack:** React 19 (CRA), Supabase (PostgreSQL), jsPDF + html2canvas, Jest + @testing-library/react.

## Global Constraints

- **Number series (exact):** BoS → `FY{YY}-{6-digit}` e.g. `FY26-000217` (existing series continues). Tax invoice → `FY{YY}-SG{4-digit}` e.g. `FY26-SG0001`.
- **BoS pricing:** no GST. Grand total = goods-after-discount + **full** alteration. Item GST dropped entirely; `gst_total = 0`; per item `gst_rate = null`, `gst_amount = 0`.
- **Alteration:** always a visible line, shown at its actual entered amount.
- **`document_type` default is `'bos'`** at the DB column and in the form.
- **Composition declaration (verbatim):** `Composition taxable person, not eligible to collect tax on supplies.`
- **Seller GSTIN** stays shown on both document types (`09ABVPB4203A1Z4`, already in `InvoiceView` `STORE.gstin`).
- Migrations live in `schema/migration_*.sql`; never edit existing table `.sql` files. Live-DB apply and any deploy steps are run in the main session, not delegated.
- Fetch live schema as ground truth before DB work (see `CLAUDE.md`).

---

### Task 1: Database migration — `document_type`, series split, trigger, drop dead function

**Files:**
- Create: `schema/migration_bill_of_supply.sql`

**Interfaces:**
- Produces: `bills.document_type text NOT NULL DEFAULT 'bos'`; `bill_sequences` PK `(financial_year, document_type)`; rewritten `set_bill_number()` trigger fn that formats by `NEW.document_type`.

- [ ] **Step 1: Write the migration file**

Create `schema/migration_bill_of_supply.sql`:

```sql
-- Bill of Supply (Phase 1): per-bill document type + independent number series.
-- BoS keeps the existing FY{YY}-NNNNNN series; tax invoices get FY{YY}-SGNNNN.

BEGIN;

-- 1. Discriminator on bills. Default 'bos' — new bills are Bills of Supply.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'bos'
  CHECK (document_type IN ('invoice', 'bos'));

-- 2. Sequence table keyed by (financial_year, document_type).
--    Existing rows are the BoS series (all historical bills are BoS).
ALTER TABLE public.bill_sequences
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'bos';

ALTER TABLE public.bill_sequences
  DROP CONSTRAINT IF EXISTS bill_sequences_pkey;
ALTER TABLE public.bill_sequences
  ADD CONSTRAINT bill_sequences_pkey PRIMARY KEY (financial_year, document_type);

-- 3. Rewrite the number-assignment trigger to branch on document_type.
CREATE OR REPLACE FUNCTION public.set_bill_number()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_date DATE;
  v_fy   TEXT;
  v_seq  INTEGER;
  v_type TEXT;
BEGIN
  IF NEW.bill_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(NEW.document_type, 'bos');
  v_date := COALESCE(NEW.orderdate::DATE, CURRENT_DATE);

  -- Indian FY: Apr–Mar → label by start year (Apr 2026–Mar 2027 = "26")
  IF EXTRACT(MONTH FROM v_date) >= 4 THEN
    v_fy := TO_CHAR(v_date, 'YY');
  ELSE
    v_fy := TO_CHAR(v_date - INTERVAL '1 year', 'YY');
  END IF;

  INSERT INTO bill_sequences (financial_year, document_type, last_value)
  VALUES (v_fy, v_type, 1)
  ON CONFLICT (financial_year, document_type) DO UPDATE
    SET last_value = bill_sequences.last_value + 1
  RETURNING last_value INTO v_seq;

  IF v_type = 'invoice' THEN
    NEW.bill_number := 'FY' || v_fy || '-SG' || LPAD(v_seq::TEXT, 4, '0');
  ELSE
    NEW.bill_number := 'FY' || v_fy || '-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Drop the dead, un-namespaced legacy numbering function (collision hazard).
DROP FUNCTION IF EXISTS public.generate_bill_number();

COMMIT;
```

- [ ] **Step 2: Apply the migration to the linked DB** (main session)

Run:
```bash
supabase db query --linked "$(cat schema/migration_bill_of_supply.sql)"
```
Expected: no error (COMMIT succeeds).

- [ ] **Step 3: Verify the schema changed**

Run:
```bash
supabase db query --linked "
select column_name, column_default, is_nullable from information_schema.columns
where table_name='bills' and column_name='document_type';
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.bill_sequences'::regclass and contype='p';
select to_regprocedure('public.generate_bill_number()') as dead_fn;"
```
Expected: `document_type` default `'bos'::text`, NOT NULL; PK def is `PRIMARY KEY (financial_year, document_type)`; `dead_fn` is `null` (dropped).

- [ ] **Step 4: Verify both series format correctly (rollback test)**

Run (wrapped in a rollback so no test rows persist):
```bash
supabase db query --linked "
BEGIN;
INSERT INTO bills (orderdate, totalamount, document_type) VALUES (CURRENT_DATE, 1, 'bos') RETURNING bill_number;
INSERT INTO bills (orderdate, totalamount, document_type) VALUES (CURRENT_DATE, 1, 'invoice') RETURNING bill_number;
INSERT INTO bills (orderdate, totalamount, document_type) VALUES (CURRENT_DATE, 1, 'invoice') RETURNING bill_number;
ROLLBACK;"
```
Expected: first row `FY26-0002xx` (BoS, continues existing counter), then `FY26-SG0001`, then `FY26-SG0002` (fresh invoice counter, 4-digit).

- [ ] **Step 5: Commit**

```bash
git add schema/migration_bill_of_supply.sql
git commit -m "feat(db): add bill document_type + BoS/invoice number series

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `billUtils` — zero-tax totals for BoS

**Files:**
- Modify: `src/admin/components/billing/billUtils.js` (`computeBillTotals`, `computePreTaxBalanceDiscount`)
- Test: `src/admin/components/billing/__tests__/billUtils.test.js`

**Interfaces:**
- Consumes: existing `priceItem` (unchanged), `round2`.
- Produces: `computeBillTotals(items, selectedCodes, allDiscounts, extraPreTaxDiscount = 0, voucherPreTax = 0, docType = 'invoice')`. For `docType === 'bos'`: `gstTotal = 0`, `grandTotal = round2(taxableTotal + Σ priceItem.alterGst)` (item GST dropped, alteration counted at full entered value). `computePreTaxBalanceDiscount(..., docType = 'invoice')` passes `docType` through to its internal `computeBillTotals` calls.

- [ ] **Step 1: Write the failing test**

Add to `src/admin/components/billing/__tests__/billUtils.test.js`:

```javascript
import { computeBillTotals } from "../billUtils";

describe("computeBillTotals docType", () => {
  const items = [
    { mrp: 1000, quantity: 1, alteration_charge: 105, stitchType: "unstitched" },
  ];

  test("invoice path adds item GST on top (default)", () => {
    const r = computeBillTotals(items, [], []);
    // goods 1000 @5% = 50 GST; alteration 105 gross (100 pre-tax + 5 GST)
    expect(r.gstTotal).toBeCloseTo(55, 2);
    expect(r.grandTotal).toBeCloseTo(1155, 2);
  });

  test("bos path drops item GST, counts full alteration, zero GST", () => {
    const r = computeBillTotals(items, [], [], 0, 0, "bos");
    expect(r.gstTotal).toBe(0);
    // 1000 goods (no GST) + 105 full alteration
    expect(r.grandTotal).toBeCloseTo(1105, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/billUtils.test.js -t "docType"`
Expected: the `bos` test FAILS (`grandTotal` is 1155-style / gstTotal non-zero, since the arg is ignored).

- [ ] **Step 3: Implement the docType branch**

In `src/admin/components/billing/billUtils.js`, change the `computeBillTotals` signature and its return.

Signature (line 87):
```javascript
export function computeBillTotals(items, selectedCodes, allDiscounts, extraPreTaxDiscount = 0, voucherPreTax = 0, docType = 'invoice') {
```

Replace the tail of the function (the `const gstTotal = rawGst;` / `const grandTotal = ...` / `return {...}` block, lines 135-149) with:

```javascript
  const alterGstTotal = round2(pricedItems.reduce((s, p) => s + p.alterGst, 0));

  // Bill of Supply: no GST on goods, but alteration is charged at its full
  // (entered) amount. grandTotal = goods-after-discount pre-tax + full alteration.
  const gstTotal = docType === 'bos' ? 0 : rawGst;
  const grandTotal = docType === 'bos'
    ? round2(taxableTotal + alterGstTotal)
    : round2(taxableTotal + rawGst);

  return {
    itemsSubtotal,
    itemLevelDiscountTotal,
    preOverallTaxable,
    overallDiscount,
    taxableTotal,
    gstTotal,
    grandTotal,
    gstOffSavings: 0,
    balanceDiscount: round2(extraPreTaxDiscount),
    voucherPreTax: round2(voucherPreTax),
  };
```

Thread `docType` through `computePreTaxBalanceDiscount` (line 60) so balance-discount targeting stays correct in BoS mode:

```javascript
export function computePreTaxBalanceDiscount(computed, targetGrandTotal, items = null, selectedCodes = null, allDiscounts = null, voucherPreTax = 0, docType = 'invoice') {
```
and in its binary-search body (line 77) change the call to:
```javascript
    const trial = computeBillTotals(items, selectedCodes, allDiscounts, mid, voucherPreTax, docType);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/billUtils.test.js`
Expected: PASS (both new tests + existing suite green).

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/billing/billUtils.js src/admin/components/billing/__tests__/billUtils.test.js
git commit -m "feat(billing): zero-tax totals path for Bill of Supply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `buildBillItemsPayload` — zero-tax line items for BoS

**Files:**
- Modify: `src/admin/components/billing/stockHelpers.js` (`buildBillItemsPayload`)
- Test: `src/admin/components/billing/__tests__/stockHelpers.test.js` (create)

**Interfaces:**
- Consumes: `priceItem`, `round2`.
- Produces: `buildBillItemsPayload(billid, items, balanceDiscount = 0, overallDiscount = 0, docType = 'invoice')`. For `bos`: each row gets `gst_rate: null`, `gst_amount: 0`, and `total` = the row value with **full** alteration and no GST.

- [ ] **Step 1: Write the failing test**

Create `src/admin/components/billing/__tests__/stockHelpers.test.js`:

```javascript
import { buildBillItemsPayload } from "../stockHelpers";

describe("buildBillItemsPayload docType", () => {
  const items = [
    { mrp: 1000, quantity: 1, alteration_charge: 105, stitchType: "unstitched", source: "manual", product_code: "X1" },
  ];

  test("invoice path keeps GST fields (default)", () => {
    const [row] = buildBillItemsPayload(1, items);
    expect(row.gst_rate).toBe(5);
    expect(row.gst_amount).toBeGreaterThan(0);
  });

  test("bos path zeroes GST and totals to value + full alteration", () => {
    const [row] = buildBillItemsPayload(1, items, 0, 0, "bos");
    expect(row.gst_rate).toBeNull();
    expect(row.gst_amount).toBe(0);
    expect(row.total).toBeCloseTo(1105, 2); // 1000 goods + 105 full alteration
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/stockHelpers.test.js`
Expected: `bos` test FAILS (gst_rate is 5 / gst_amount > 0; arg ignored).

- [ ] **Step 3: Read the current return block, then implement**

Open `src/admin/components/billing/stockHelpers.js`. Change the signature (line 48):
```javascript
export function buildBillItemsPayload(billid, items, balanceDiscount = 0, overallDiscount = 0, docType = 'invoice') {
```

In the per-item `return {…}` object (around lines 102-118), the current code sets `gst_rate: gstRate` and `gst_amount: adjustedGst` and a `total`. Change those three so BoS zeroes tax and uses the full-alteration value. Locate the `return {` inside the `.map` and set:

```javascript
    const alterFull = Number(it.alteration_charge || it.stitching_charge || 0);
    const alterPreTax = alterFull / 1.05;
    const bosTotal = round2(adjustedItemPreTax + alterFull); // goods pre-tax (post all discounts) + full alteration, no GST

    return {
      // …unchanged fields above (billid, variantid, product_name, quantity, mrp,
      //   alteration_charge, stitching_charge, discount_total, subtotal, category,
      //   stitch_type, salesperson_id, unit_type, product_code, cost_price) …
      gst_rate: docType === 'bos' ? null : gstRate,
      gst_amount: docType === 'bos' ? 0 : adjustedGst,
      total: docType === 'bos' ? bosTotal : round2(adjustedItemPreTax + alterPreTax + adjustedGst),
    };
```

> Note for the implementer: `adjustedItemPreTax` and `adjustedGst` are the existing locals computed just above the return (the post-discount pre-tax garment value and its GST). Keep every other field in the returned object exactly as it is today — only `gst_rate`, `gst_amount`, and `total` become `docType`-conditional. Do not reformat or reorder the untouched fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/stockHelpers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/billing/stockHelpers.js src/admin/components/billing/__tests__/stockHelpers.test.js
git commit -m "feat(billing): zero-tax bill_items payload for Bill of Supply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `Summary` — hide GST row in BoS mode

**Files:**
- Modify: `src/admin/components/billing/Summary.js`
- Test: `src/admin/components/billing/__tests__/Summary.test.js` (create)

**Interfaces:**
- Consumes: `computed` from `computeBillTotals`.
- Produces: `Summary` accepts a new prop `docType = 'invoice'`. When `'bos'`, the `GST` line (lines 86-89) is not rendered. `Subtotal` label becomes `Subtotal (MRP + Alterations)` in both modes (unchanged).

- [ ] **Step 1: Write the failing test**

Create `src/admin/components/billing/__tests__/Summary.test.js`:

```javascript
import { render, screen } from "@testing-library/react";
import Summary from "../Summary";

const computed = {
  itemsSubtotal: 1105, itemLevelDiscountTotal: 0, overallDiscount: 0,
  balanceDiscount: 0, gstTotal: 0, grandTotal: 1105, voucherPreTax: 0,
};

test("invoice mode shows GST line", () => {
  render(<Summary computed={{ ...computed, gstTotal: 55, grandTotal: 1155 }} />);
  expect(screen.getByText("GST")).toBeInTheDocument();
});

test("bos mode hides GST line", () => {
  render(<Summary computed={computed} docType="bos" />);
  expect(screen.queryByText("GST")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/Summary.test.js`
Expected: `bos` test FAILS (GST line always rendered).

- [ ] **Step 3: Implement the conditional**

In `src/admin/components/billing/Summary.js`, add `docType = 'invoice'` to the destructured props (after line 17, inside the `}` param list) — add on its own line before the closing brace:
```javascript
  docType = 'invoice',
```

Wrap the GST block (lines 86-89) in a condition:
```javascript
      {docType !== 'bos' && (
        <div className="flex justify-between text-muted-foreground">
          <span>GST</span>
          <span className="tabular-nums">+{money(computed.gstTotal)}</span>
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/Summary.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/billing/Summary.js src/admin/components/billing/__tests__/Summary.test.js
git commit -m "feat(billing): hide GST line in Summary for Bill of Supply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `InvoiceView` — `docType` render (BoS: no tax columns, declaration, retitle)

**Files:**
- Modify: `src/admin/components/billing/InvoiceView.js`
- Test: `src/admin/components/billing/__tests__/InvoiceView.test.js` (create)

**Interfaces:**
- Consumes: existing props + `computed` (BoS `computed` has `gstTotal = 0`, `grandTotal` = value + full alteration).
- Produces: `InvoiceView` accepts `docType = 'invoice'`. When `'bos'`: document heading label is **"Bill of Supply"**; the line-item table omits `GST%`, `Taxable`, `CGST`, `SGST` columns and the `Amount` column shows the GST-free line value (`mrp*qty − disc + full alteration`); the `CGST | SGST` totals line is hidden; the composition declaration renders above the terms. The `'invoice'` path is byte-for-byte unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/admin/components/billing/__tests__/InvoiceView.test.js`:

```javascript
import { render, screen, within } from "@testing-library/react";
import InvoiceView from "../InvoiceView";

const base = {
  billId: 1, billNumber: "FY26-000217", billDate: "2026-07-13",
  customerName: "Test", salespersonNames: [],
  items: [{ _id: "a", product_name: "Saree", mrp: 1000, quantity: 1, alteration_charge: 105, stitchType: "unstitched" }],
  computed: { itemsSubtotal: 1105, itemLevelDiscountTotal: 0, overallDiscount: 0, balanceDiscount: 0, preOverallTaxable: 1100, gstTotal: 0, grandTotal: 1105, voucherPreTax: 0 },
  paymentMethod: "Cash", paymentAmount: 1105, appliedCodes: [], allDiscounts: [],
};

test("bos: title, declaration, no tax columns", () => {
  render(<InvoiceView {...base} docType="bos" />);
  expect(screen.getByText("Bill of Supply")).toBeInTheDocument();
  expect(screen.getByText(/Composition taxable person, not eligible to collect tax/i)).toBeInTheDocument();
  expect(screen.queryByText("CGST (₹)")).not.toBeInTheDocument();
  expect(screen.queryByText("Taxable (₹)")).not.toBeInTheDocument();
});

test("invoice: keeps tax columns, no declaration", () => {
  render(<InvoiceView {...base} computed={{ ...base.computed, gstTotal: 55, grandTotal: 1155 }} />);
  expect(screen.getByText("CGST (₹)")).toBeInTheDocument();
  expect(screen.queryByText(/Composition taxable person/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/InvoiceView.test.js`
Expected: `bos` test FAILS (no "Bill of Supply" title / declaration; tax columns always present).

- [ ] **Step 3: Add the `docType` prop and derive the BoS line value**

In `src/admin/components/billing/InvoiceView.js`, add `docType = "invoice"` to the destructured props (after `paymentStatus = "finalized",` at line 41):
```javascript
    docType = "invoice",
```

Add a boolean near the top of the component body (after line 44, before the discount math):
```javascript
  const isBos = docType === "bos";
```

Inside the `lineItems.map` return object (after `sgst,` around line 121), add a GST-free line value so the table can show it in BoS mode:
```javascript
      bosAmount: mrp * qty - disc + alteration, // value + full alteration, no GST
```
(`disc` here is the already-aggregated per-line discount computed just above; `alteration` is the full entered amount.)

- [ ] **Step 4: Retitle the metadata heading**

Replace the Bill-No block (lines 271-273) so BoS is labelled:
```javascript
          <div>
            <strong>{isBos ? "Bill of Supply" : "Tax Invoice"}</strong>
          </div>
          <div>
            <strong>Bill No:</strong> {billNumber || billId}
          </div>
```

- [ ] **Step 5: Make the table header conditional**

Replace the `<thead>` row (lines 294-305) with:
```javascript
          <tr style={{ backgroundColor: "#f4f4f5", fontWeight: 600 }}>
            <th style={thLeft}>S.No.</th>
            <th style={thLeft}>Particulars</th>
            <th style={thRight}>Qty</th>
            <th style={thRight}>Rate (₹)</th>
            <th style={thRight}>Disc (₹)</th>
            {!isBos && <th style={thRight}>GST%</th>}
            {!isBos && <th style={thRight}>Taxable (₹)</th>}
            {!isBos && <th style={thRight}>CGST (₹)</th>}
            {!isBos && <th style={thRight}>SGST (₹)</th>}
            <th style={thRight}>Amount (₹)</th>
          </tr>
```

- [ ] **Step 6: Make the table body cells conditional**

In the row body, replace the four tax cells + amount cell (lines 371-375) with:
```javascript
                  {!isBos && <td style={tdRight}>{gstRate}%</td>}
                  {!isBos && <td style={tdRight}>₹{taxable.toFixed(2)}</td>}
                  {!isBos && <td style={tdRight}>₹{cgst.toFixed(2)}</td>}
                  {!isBos && <td style={tdRight}>₹{sgst.toFixed(2)}</td>}
                  <td style={tdRight}>₹{(isBos ? bosAmount : lineGross).toFixed(2)}</td>
```
Add `bosAmount` to the row destructuring at the top of the `.map` callback (the `({ item, idx, mrp, qty, gstRate, disc, alteration, lineGross, taxable, cgst, sgst })` list at lines 309-320) → append `, bosAmount`.

- [ ] **Step 7: Hide the CGST|SGST totals line in BoS**

Wrap the totals `CGST/SGST` line (lines 403-405) in `{!isBos && ( … )}`:
```javascript
        {!isBos && (
          <div style={{ color: "#6b7280", fontSize: "10px", marginTop: 2 }}>
            {`CGST: ₹${totalCgst.toFixed(2)} | SGST: ₹${totalSgst.toFixed(2)}`}
          </div>
        )}
```

- [ ] **Step 8: Render the composition declaration (BoS only)**

Immediately before the `{/* 6. Notes Footer */}` block (line 601), insert:
```javascript
      {isBos && (
        <div
          style={{
            marginTop: "8px",
            padding: "6px 10px",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "10px",
            fontStyle: "italic",
            color: "#374151",
          }}
        >
          Composition taxable person, not eligible to collect tax on supplies.
        </div>
      )}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/InvoiceView.test.js`
Expected: PASS (both tests).

- [ ] **Step 10: Commit**

```bash
git add src/admin/components/billing/InvoiceView.js src/admin/components/billing/__tests__/InvoiceView.test.js
git commit -m "feat(billing): Bill of Supply rendering in InvoiceView (docType)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `BillingForm` — docType toggle (default BoS) threaded end to end

**Files:**
- Modify: `src/admin/components/billing/BillingForm.js`
- Test: `src/admin/components/billing/__tests__/BillingForm.docType.test.js` (create)

**Interfaces:**
- Consumes: Task 2 (`computeBillTotals(..., docType)`), Task 3 (`buildBillItemsPayload(..., docType)`), Task 4 (`Summary docType`), Task 5 (`InvoiceView docType`).
- Produces: a `docType` state (default `'bos'`) with a visible toggle; `document_type: docType` written on every `bills` insert; `docType` passed to every `computeBillTotals`, `computePreTaxBalanceDiscount`, `buildBillItemsPayload`, `<Summary>`, and `<InvoiceView>` call in this file; and `document_type` loaded into `docType` when editing an existing bill.

- [ ] **Step 1: Add the state**

After line 72 (`const [items, setItems] = useState([]);`) add:
```javascript
  const [docType, setDocType] = useState('bos'); // 'bos' (default) | 'invoice'
```

- [ ] **Step 2: Load docType when opening an existing bill**

In the bill-load effect, the select string at line 260 fetches bill columns. Append `document_type` to that select list, and after `setEffectiveBillNumber(bill.bill_number || null);` (line 265) add:
```javascript
        setDocType(bill.document_type || 'bos');
```

- [ ] **Step 3: Thread docType into every computeBillTotals / balance-discount / payload call**

There are `computeBillTotals(` calls at lines 547 and 581, `computePreTaxBalanceDiscount(` usages, and `buildBillItemsPayload(` usages. For each, pass `docType` as the trailing argument:
- `computeBillTotals(items, selectedCodes, allDiscounts, extra, voucher)` → add `, docType`.
- `computePreTaxBalanceDiscount(computed, target, items, selectedCodes, allDiscounts, voucher)` → add `, docType`.
- `buildBillItemsPayload(billid, items, balanceDiscount, overallDiscount)` → add `, docType`.

Run this to enumerate exact call sites before editing:
```bash
grep -n "computeBillTotals(\|computePreTaxBalanceDiscount(\|buildBillItemsPayload(" src/admin/components/billing/BillingForm.js
```
Edit each call to append `docType` as the last argument. (Do not change calls in other files — those are handled by their own tasks or default to `'invoice'`.)

- [ ] **Step 4: Write `document_type` on every bills insert**

The `bills` inserts are at lines ~926, ~1168, ~1550 (draft, finalize, partial). In each `.insert({ … })` object add:
```javascript
            document_type: docType,
```
Run to confirm the three sites:
```bash
grep -n "\.from(\"bills\")" src/admin/components/billing/BillingForm.js
```
Add the field to each `.insert({…})` (not to `.update({…})` / `.select()` calls).

- [ ] **Step 5: Pass docType to Summary and InvoiceView**

At the `<Summary` usage (line 2215) add prop `docType={docType}`.
At the `<InvoiceView` usage (line 2271) add prop `docType={docType}`.

- [ ] **Step 6: Add the toggle UI**

Immediately above the `<Summary` block (line 2215), add a document-type toggle. Match the existing shadcn/Tailwind style already imported in this file:
```javascript
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium">Document:</span>
                <div className="inline-flex rounded-md border overflow-hidden">
                  <button
                    type="button"
                    className={`px-3 py-1 text-sm ${docType === 'bos' ? 'bg-primary text-white' : 'bg-white text-gray-700'}`}
                    onClick={() => setDocType('bos')}
                  >
                    Bill of Supply
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 text-sm ${docType === 'invoice' ? 'bg-primary text-white' : 'bg-white text-gray-700'}`}
                    onClick={() => setDocType('invoice')}
                  >
                    Tax Invoice
                  </button>
                </div>
              </div>
```

- [ ] **Step 7: Write the failing test (default is BoS + toggle switches)**

Create `src/admin/components/billing/__tests__/BillingForm.docType.test.js`. Because `BillingForm` is large and DB-connected, test only the toggle default + switch behavior by mounting it with mocked supabase. Use the existing test mocking pattern in the repo (see `__tests__/billUtils.test.js` neighbors and `src/setupTests.js`). Minimal test:

```javascript
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ limit: () => ({ data: [], error: null }) }) }) }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import BillingForm from "../BillingForm";

test("defaults to Bill of Supply and can switch to Tax Invoice", () => {
  render(<BillingForm open onOpenChange={() => {}} />);
  const bos = screen.getByRole("button", { name: "Bill of Supply" });
  const inv = screen.getByRole("button", { name: "Tax Invoice" });
  // default selected = BoS (primary bg)
  expect(bos.className).toMatch(/bg-primary/);
  fireEvent.click(inv);
  expect(inv.className).toMatch(/bg-primary/);
});
```

> Implementer note: if the component's mount requires more supabase surface than the stub above, extend the mock to return `{ data: [], error: null }` for the specific chained calls the form makes on open (check the load effect). Keep the assertion on the toggle.

- [ ] **Step 8: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/admin/components/billing/__tests__/BillingForm.docType.test.js`
Expected: PASS.

- [ ] **Step 9: Run the full billing test suite**

Run: `CI=true npx react-scripts test src/admin/components/billing`
Expected: all billing tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/admin/components/billing/BillingForm.js src/admin/components/billing/__tests__/BillingForm.docType.test.js
git commit -m "feat(billing): document-type toggle (default Bill of Supply)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `BillTable` — Type column + filter, GST/Total aware of BoS

**Files:**
- Modify: `src/admin/components/BillTable.js`
- Test: `src/admin/components/__tests__/BillTable.test.js` (create)

**Interfaces:**
- Consumes: `bills.document_type`.
- Produces: the list query selects `document_type`; a Type column renders a badge ("Bill of Supply" / "Tax Invoice"); a type filter (`all | bos | invoice`) constrains the query; regen uses `docType` so BoS PDFs regenerate without tax.

- [ ] **Step 1: Write the failing test**

Create `src/admin/components/__tests__/BillTable.test.js`. Mock supabase to return two bills of different types:

```javascript
import { render, screen, waitFor } from "@testing-library/react";

const rows = [
  { billid: 1, bill_number: "FY26-000217", document_type: "bos", customers: null, orderdate: "2026-07-13", totalamount: 1105, gst_total: 0, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
  { billid: 2, bill_number: "FY26-SG0001", document_type: "invoice", customers: null, orderdate: "2026-07-13", totalamount: 1155, gst_total: 55, discount_total: 0, paymentstatus: "finalized", finalized: true, pdf_url: null },
];
jest.mock("../../lib/supabaseClient", () => ({
  supabase: { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) },
}));

import BillTable from "../BillTable";

test("renders document type badges", async () => {
  render(<BillTable onEdit={() => {}} />);
  await waitFor(() => expect(screen.getByText("Bill of Supply")).toBeInTheDocument());
  expect(screen.getByText("Tax Invoice")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/admin/components/__tests__/BillTable.test.js`
Expected: FAIL (no type badges rendered).

- [ ] **Step 3: Select `document_type` and add the type filter state**

In `src/admin/components/BillTable.js`, add `document_type` to the list select string (line 307) — append `, document_type` inside the select list.

Add filter state near line 40:
```javascript
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'bos' | 'invoice'
```

In `loadBills` (after the `.range(...)` line 313, before the search block), constrain by type:
```javascript
      if (typeFilter !== "all") query = query.eq("document_type", typeFilter);
```
Add `typeFilter` to the effect dependency array (line 361): `[page, filters, sort, toast, typeFilter]`.

- [ ] **Step 4: Add the filter control + Type column header**

In the filters row (after the search Input, ~line 684), add:
```javascript
        <select
          value={typeFilter}
          onChange={(e) => { setPage(1); setTypeFilter(e.target.value); }}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="all">All types</option>
          <option value="bos">Bill of Supply</option>
          <option value="invoice">Tax Invoice</option>
        </select>
```

Add a `Type` header after the Customer `<th>` (line 706):
```javascript
                <th className="p-2 text-left">Type</th>
```

- [ ] **Step 5: Add the Type cell**

After the Customer `<td>` (line 755) add:
```javascript
                  <td className="p-2">
                    <Badge variant={b.document_type === "invoice" ? "default" : "secondary"}>
                      {b.document_type === "invoice" ? "Tax Invoice" : "Bill of Supply"}
                    </Badge>
                  </td>
```
Update the empty-state `colSpan` (line 887) from `8` to `9`.

- [ ] **Step 6: Make regen respect document type**

In `handleRegenPdf`, the select at line 59 fetches bill columns — append `, document_type`. Pass it to computation and rendering:
- Change `const computed = computeBillTotals(items, appliedCodes, allDiscounts);` (line 161) to `computeBillTotals(items, appliedCodes, allDiscounts, 0, 0, billRow.document_type || 'bos');`.
- In the `setRegenBillData({...})` object add `docType: billRow.document_type || 'bos',`.
- On the off-screen `<InvoiceView>` (line 1066) add prop `docType={regenBillData.docType}`.

- [ ] **Step 7: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/admin/components/__tests__/BillTable.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/components/BillTable.js src/admin/components/__tests__/BillTable.test.js
git commit -m "feat(billing): document-type column, filter, and BoS-aware regen in BillTable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification & docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-bill-of-supply-design.md` (mark Phase 1 status)

- [ ] **Step 1: Full test run**

Run: `CI=true npx react-scripts test`
Expected: all suites PASS.

- [ ] **Step 2: Manual smoke via the running app** (main session)

Run `npm start`, open `/admin/inventory` → Billing:
- New bill defaults to **Bill of Supply**; Summary shows no GST line; total = MRP + full alteration − discount.
- Finalize → bill number is `FY26-0002xx`; PDF has "Bill of Supply" title, no tax columns, the declaration line, alteration shown.
- Switch toggle to **Tax Invoice**, finalize → number `FY26-SG0001`; PDF shows CGST/SGST as before.
- `BillTable` shows Type badges and the type filter works.

Record the two generated bill numbers + a note that both PDFs render correctly in the PR description.

- [ ] **Step 3: Update spec status + commit**

Edit the spec header `Status:` to `Phase 1 implemented`. Commit:
```bash
git add docs/superpowers/specs/2026-07-13-bill-of-supply-design.md
git commit -m "docs(spec): mark Bill of Supply Phase 1 implemented

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes & Deferrals

- **Phase 2 (historical relabel of 212 bills)** is a separate plan — not in scope here.
- **`console.log("gstRate", gstRate)`** at `stockHelpers.js:87` is a pre-existing debug print. Out of scope for this feature; leave untouched (note for a future cleanup).
- **Second-company / GST-entity dimension** deliberately not built (YAGNI). The Tax Invoice path is preserved and ready for it.
- **Seller GSTIN + declaration wording** use the values in Global Constraints; confirm with owner/CA before the store goes live but they are not blockers for the build.
