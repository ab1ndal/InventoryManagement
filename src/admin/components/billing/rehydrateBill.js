// Rebuild a finalized bill's printable numbers from what was persisted.
//
// A finalized bill is a record, not a calculation. Re-deriving its totals from the
// item rows cannot reproduce them: bill_items stores each line's discount as a rupee
// amount, so back-calculating a percentage and re-pricing drifts (paisa when no codes
// were applied, hundreds of rupees when they were, because the code discount is baked
// into discount_total and then applied a second time).
//
// So reprints read the stored values instead. The only thing not recoverable from the
// rows is the *breakdown* of the discount — bill_items folds item, code and waiver
// discounts into one discount_total — so the breakdown is best-effort and any part that
// cannot be attributed to a code is shown as a single "Other Discount" line, which
// keeps the printed totals reconciling exactly.

import { round2, valueOfDiscount } from "./billUtils";

/**
 * @param {object} billRow - bills row: totalamount, gst_total, discount_total,
 *   taxable_total, applied_codes, document_type
 * @param {Array} billItems - bill_items rows for that bill, in display order
 * @param {Array} allDiscounts - discounts rows matching billRow.applied_codes (breakdown only)
 * @param {Array} [displayItems] - same order as billItems, carrying the presentation
 *   fields the stored rows lack (productid, size, color, unit_type). Falls back to the
 *   raw rows when omitted.
 * @returns {{ computed: object, lines: Array, discountLines: Array }}
 */
export function rehydrateBillTotals(billRow, billItems, allDiscounts = [], displayItems = null) {
  const docType = billRow?.document_type || "bos";
  const isBos = docType === "bos";
  const rows = billItems || [];

  const itemsSubtotal = round2(
    rows.reduce(
      (s, bi) =>
        s +
        Number(bi.mrp || 0) * Number(bi.quantity || 0) +
        Number(bi.alteration_charge || 0),
      0,
    ),
  );

  const grandTotal = round2(Number(billRow?.totalamount ?? 0));
  const gstTotal = isBos ? 0 : round2(Number(billRow?.gst_total ?? 0));
  const discountTotal = round2(Number(billRow?.discount_total ?? 0));

  // Per-line numbers, straight from the stored row. `total` is the authoritative
  // line amount — it is what the customer was charged for that line.
  const lines = rows.map((bi, idx) => {
    const gstAmount = isBos ? 0 : round2(Number(bi.gst_amount || 0));
    const half = round2(gstAmount / 2);
    return {
      item: displayItems?.[idx] ?? bi,
      idx,
      mrp: Number(bi.mrp || 0),
      qty: Number(bi.quantity || 0),
      gstRate: isBos ? 0 : Number(bi.gst_rate ?? 0),
      disc: round2(Number(bi.discount_total || 0)),
      alteration: Number(bi.alteration_charge || 0),
      lineGross: round2(Number(bi.total || 0)),
      taxable: round2(Number(bi.subtotal || 0)),
      // gst_amount is stored as one figure; CGST and SGST are each half of it.
      // An odd-paisa figure puts the extra paisa on SGST so the two still sum exactly.
      cgst: half,
      sgst: round2(gstAmount - half),
      bosAmount: round2(Number(bi.total || 0)),
    };
  });

  // Best-effort discount breakdown. Code amounts are re-evaluated for display only;
  // whatever they do not account for becomes one reconciling line.
  const codes = billRow?.applied_codes || [];
  const formItems = rows.map((bi) => ({
    quantity: Number(bi.quantity || 0),
    mrp: Number(bi.mrp || 0),
    alteration_charge: Number(bi.alteration_charge || 0),
    quickDiscountPct: 0,
    gstRate: bi.gst_rate ?? 18,
    stitchType: bi.stitch_type || "unstitched",
    category: bi.category || null,
    unit_type: bi.unit_type || "piece",
  }));

  const codeLines = codes
    .map((code) => {
      const d = (allDiscounts || []).find((x) => x.code === code);
      if (!d) return null;
      const amount = round2(valueOfDiscount(d, formItems));
      if (amount <= 0) return null;
      return { label: code, amount };
    })
    .filter(Boolean);

  const attributed = round2(codeLines.reduce((s, l) => s + l.amount, 0));
  const remainder = round2(discountTotal - attributed);

  const discountLines = [...codeLines];
  if (remainder > 0.005) {
    discountLines.push({
      label: codeLines.length > 0 ? "Other Discount" : "Discount",
      amount: remainder,
    });
  } else if (remainder < -0.005) {
    // Codes claim more than the bill recorded — trust the bill, drop the breakdown.
    discountLines.length = 0;
    if (discountTotal > 0.005) {
      discountLines.push({ label: "Discount", amount: discountTotal });
    }
  }

  const computed = {
    itemsSubtotal,
    itemLevelDiscountTotal: 0, // not separable from stored rows; see discountLines
    overallDiscount: 0,
    balanceDiscount: 0,
    voucherPreTax: 0,
    preOverallTaxable: itemsSubtotal,
    taxableTotal: round2(Number(billRow?.taxable_total ?? 0)),
    gstTotal,
    grandTotal,
    discountTotal,
    rehydrated: true,
  };

  return { computed, lines, discountLines };
}
