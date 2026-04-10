---
phase: 03-finalize-with-payment-pdf-invoice
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - package.json
  - src/admin/components/billing/BillingForm.js
  - src/admin/components/billing/InvoiceView.js
  - src/admin/components/billing/generateInvoicePdf.js
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-04-10
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The four files implement the finalize-with-payment and PDF-invoice feature: a billing form (`BillingForm.js`), a print-ready invoice component (`InvoiceView.js`), a PDF capture utility (`generateInvoicePdf.js`), and `package.json` for the new `html2canvas` / `jspdf` dependencies. The overall architecture is sound and the save/finalize/stock-reconciliation flow is well-structured with good error handling throughout.

One critical bug was found: the invoice line-item rendering in `InvoiceView.js` silently omits `alteration_charge` from all per-line amounts and the GST back-calculation, producing invoices with incorrect figures for any item that carries an alteration fee. Three warnings cover a stock-update gap after finalization, a nested-Dialog Radix UI issue, and a wrong bill date in the invoice for the edit flow. Three info-level items cover minor type-coercion fragility, swallowed salesperson errors, and the PDF-fail-silent behavior.

---

## Critical Issues

### CR-01: InvoiceView ignores `alteration_charge`, producing wrong line amounts and GST

**File:** `src/admin/components/billing/InvoiceView.js:24-29`

**Issue:** The per-line computation in `InvoiceView` calculates `lineGross` as `(mrp * qty) - disc` and derives `taxable` from that value. It never adds `alteration_charge` to `lineGross`. In `billUtils.js` (`priceItem`), the taxable base is `afterDisc + alteration`, and GST is levied on that combined figure. The invoice therefore under-reports every line amount and CGST/SGST total for bills with alteration charges. The "Amount" column, the "Grand Total", and the tax summary will all be wrong on the generated PDF.

```js
// Current (wrong — omits alteration)
const lineGross = (mrp * qty) - disc;                              // line 25
const taxable   = gstRate > 0 ? lineGross / (1 + gstRate / 100) : lineGross;  // line 26

// Fix — mirror priceItem() from billUtils.js
const alteration = Number(item.alteration_charge || item.stitching_charge || 0);
const afterDisc  = (mrp * qty) - disc;
const withCharges = afterDisc + alteration;                        // taxable base (GST-exclusive)
const lineGross  = gstRate > 0
  ? withCharges * (1 + gstRate / 100)                             // GST-inclusive line total
  : withCharges;
const taxable    = withCharges;
const cgst = taxable * (gstRate / 2) / 100;
const sgst = taxable * (gstRate / 2) / 100;
```

Also update line 29 to remove the now-redundant local `cgst`/`sgst` fields (they are already correct once `taxable` is fixed), and display `withCharges` as the "Taxable" column value rather than the current back-calculated figure.

---

## Warnings

### WR-01: Invoice shows wrong date for edit-bill flow

**File:** `src/admin/components/billing/BillingForm.js:649`

**Issue:** `billDate={new Date()}` always passes the current timestamp to `InvoiceView`. For an existing bill being edited, the generated PDF will carry today's date rather than the original bill creation date. A customer who receives a re-printed invoice will see a different date from the original.

```jsx
// Current
<InvoiceView
  billDate={new Date()}   // always today — wrong for edit flow
  ...
/>

// Fix — load bill created_at during loadBill() and store in state
const [billDate, setBillDate] = useState(null);

// Inside loadBill(), after fetching the bill row:
setBillDate(bill.created_at ? new Date(bill.created_at) : new Date());

// Then pass it:
<InvoiceView
  billDate={billDate ?? new Date()}
  ...
/>
```

The `bills` table select on line 115 should also include `created_at` in the column list.

### WR-02: Stock update failures after finalization are silently swallowed

**File:** `src/admin/components/billing/BillingForm.js:284-293`

**Issue:** During the draft-update path (Step I), stock delta writes to `productsizecolors` on lines 284–293 only `console.error` on failure. The bill has already been committed to the database at this point. If any stock update fails, the bill record is correct but stock counts are permanently wrong, with no user-visible error and no retry mechanism.

The same risk exists in the new-draft path at lines 374–383.

**Fix:** Accumulate any stock update failures and surface them as a warning toast after the success toast, so the operator knows to manually investigate:

```js
const stockFailures = [];
for (const [vid, delta] of Object.entries(deltaMap)) {
  if (delta === 0) continue;
  const currentStock = stockMap[vid]?.stock ?? 0;
  const { error: stockUpdateErr } = await supabase
    .from("productsizecolors")
    .update({ stock: currentStock + delta })
    .eq("variantid", vid);
  if (stockUpdateErr) {
    stockFailures.push(vid);
  }
}

toast({ title: `Draft saved — Bill #${billId}` });
if (stockFailures.length > 0) {
  toast({
    title: "Stock sync warning",
    description: `Stock could not be updated for ${stockFailures.length} variant(s). Please recheck inventory.`,
    variant: "destructive",
  });
}
```

### WR-03: Nested `<Dialog>` inside `<Dialog>` causes Radix UI portal/focus issues

**File:** `src/admin/components/billing/BillingForm.js:512,661`

**Issue:** The Finalize Confirmation Dialog (line 661) is rendered as a child of the outer billing `<Dialog>` (line 512). Radix UI Dialog uses portals, but nesting Dialog inside Dialog causes focus-trap conflicts — when the inner dialog is open, keyboard navigation and screen-reader focus can escape to the outer dialog or become trapped incorrectly. This also causes stacking-context issues with overlays on some browsers.

**Fix:** Render the confirmation dialog as a sibling of (not a child of) the outer Dialog, or render it at the application root using a portal wrapper:

```jsx
// Return both dialogs as siblings wrapped in a fragment
return (
  <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ... billing form content ... */}
    </Dialog>

    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      {/* ... confirm finalize content ... */}
    </Dialog>
  </>
);
```

---

## Info

### IN-01: `diff > 0` operates on a string from `.toFixed(2)`

**File:** `src/admin/components/billing/BillingForm.js:412-414`

**Issue:** `diff` is assigned the result of `(paidAmt - computed.grandTotal).toFixed(2)`, which returns a string (e.g., `"-3.50"`). The subsequent `diff > 0` comparison and `Math.abs(diff)` calls rely on implicit JavaScript type coercion. While this works at runtime, it is fragile and masks the intent.

```js
// Current
const diff = (paidAmt - computed.grandTotal).toFixed(2);  // string
const msg = diff > 0 ? `...` : `...`;                     // string comparison

// Fix — keep numeric, format only for display
const diff = paidAmt - computed.grandTotal;
const msg = diff > 0
  ? `Amount received is ₹${Math.abs(diff).toFixed(2)} more than the total (₹${computed.grandTotal.toFixed(2)}).`
  : `Amount received is ₹${Math.abs(diff).toFixed(2)} short of the total (₹${computed.grandTotal.toFixed(2)}).`;
```

### IN-02: Salesperson save/delete errors are silently swallowed

**File:** `src/admin/components/billing/BillingForm.js:276,280,371`

**Issue:** Errors from `bill_salespersons` insert and delete operations are caught with `console.error` but never surfaced to the user. If salesperson associations fail to save, the operator has no way to know without inspecting browser devtools.

**Fix:** Promote these to user-visible toasts at warning severity, consistent with how other non-fatal errors are handled in the same function.

### IN-03: Commented-out import left in source

**File:** `src/admin/components/billing/BillingForm.js:20`

**Issue:** `//import { Textarea } from "../../../components/ui/textarea";` is commented out. This is dead code that should be removed.

```js
// Remove line 20 entirely
```

---

_Reviewed: 2026-04-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
