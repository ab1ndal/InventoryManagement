/**
 * BEHAVIOR PROBE — not a permanent test suite.
 *
 * Each test states a billing behavior a shop owner would assert without knowing
 * any code, then checks it against the CURRENT implementation across all paths:
 *   screen   = billUtils.computeBillTotals / priceItem
 *   stored   = stockHelpers.buildBillItemsPayload
 *   printed  = InvoiceView (rendered, real component)
 *   reprint  = BillTable's reconstruct-from-bill_items flow
 *
 * Failures here are the findings, not bugs in the test.
 */
import { render } from "@testing-library/react";
import InvoiceView from "../InvoiceView";
import {
  computeBillTotals,
  computePreTaxBalanceDiscount,
  priceItem,
  round2,
} from "../billUtils";
import { buildBillItemsPayload, backCalcDiscountPct } from "../stockHelpers";
import { generateBillText } from "../generateBillText";

// ---------- fixtures ----------

const CODE_10PCT = {
  code: "SAVE10",
  type: "percentage",
  value: 10,
  exclusive: false,
  rules: {},
};

// item 1: stitched, sits just above the 2500/unit slab boundary after item disc
// item 2: unstitched, carries an alteration charge
const ITEMS = [
  {
    _id: "i1",
    product_name: "Lehenga",
    productid: "BC25001",
    mrp: 2800,
    quantity: 1,
    quickDiscountPct: 0,
    alteration_charge: 0,
    gstRate: 18,
    stitchType: "stitched",
    unit_type: "piece",
  },
  {
    _id: "i2",
    product_name: "Saree",
    productid: "BC25002",
    mrp: 1200,
    quantity: 1,
    quickDiscountPct: 0,
    alteration_charge: 210,
    gstRate: 5,
    stitchType: "unstitched",
    unit_type: "piece",
  },
];

// ---------- path helpers ----------

const num = (s) => Number(String(s).replace(/[₹,%\s]/g, ""));

/** Render InvoiceView and read back what the customer actually sees. */
function printed({ items, computed, docType, appliedCodes = [], allDiscounts = [], appliedVoucher = null }) {
  const { container, unmount } = render(
    <InvoiceView
      billId={1}
      billNumber="FY26-000001"
      billDate="2026-08-20"
      customerName="Probe"
      salespersonNames={[]}
      items={items}
      computed={computed}
      docType={docType}
      paymentMethod="Cash"
      paymentAmount={computed.grandTotal}
      appliedCodes={appliedCodes}
      allDiscounts={allDiscounts}
      appliedVoucher={appliedVoucher}
      appliedStoreCredit={0}
    />,
  );
  const rows = [...container.querySelectorAll("tbody tr")];
  const isBos = docType === "bos";
  const lines = rows.map((tr) => {
    const td = [...tr.querySelectorAll("td")];
    return {
      disc: num(td[4].textContent),
      // invoice: S.No, Particulars, Qty, Rate, Disc, GST%, Taxable, CGST, SGST, Amount
      gstRate: isBos ? 0 : num(td[5].textContent),
      taxable: isBos ? null : num(td[6].textContent),
      cgst: isBos ? 0 : num(td[7].textContent),
      sgst: isBos ? 0 : num(td[8].textContent),
      amount: num(td[isBos ? 5 : 9].textContent),
    };
  });
  const grandText = container.textContent.match(/Grand Total: ₹([\d.,]+)/);
  unmount();
  return { lines, grandTotal: grandText ? num(grandText[1]) : null };
}

/** Reproduce BillTable.js:88-162 — reprint after a reload from the DB. */
function reprintFromDb(payloadRows, appliedCodes, allDiscounts, docType) {
  const items = payloadRows.map((bi, idx) => ({
    _id: String(idx),
    product_name: bi.product_name,
    productid: bi.product_code,
    quantity: bi.quantity,
    mrp: bi.mrp,
    alteration_charge: bi.alteration_charge || 0,
    quickDiscountPct: backCalcDiscountPct(bi.discount_total, bi.mrp, bi.quantity),
    gstRate: bi.gst_rate ?? 18,
    stitchType: bi.stitch_type || "unstitched",
  }));
  return computeBillTotals(items, appliedCodes, allDiscounts, 0, 0, docType);
}

const sum = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));

/** The full save path for a bill with no forced target. */
function save(items, codes, discounts, docType, voucher = 0) {
  const computed = computeBillTotals(items, codes, discounts, 0, voucher, docType);
  const rows = buildBillItemsPayload(1, items, 0, computed.overallDiscount, docType, 0);
  return { computed, rows };
}

// =====================================================================
// B1. "The line amounts on the bill I hand the customer add up to the
//      total printed at the bottom."
// =====================================================================
describe("B1 printed lines add up to printed grand total", () => {
  test("invoice, no discounts", () => {
    const { computed } = save(ITEMS, [], [], "invoice");
    const p = printed({ items: ITEMS, computed, docType: "invoice" });
    expect(sum(p.lines, (l) => l.amount)).toBeCloseTo(p.grandTotal, 2);
  });

  test("invoice, 10% code", () => {
    const { computed } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
    const p = printed({
      items: ITEMS, computed, docType: "invoice",
      appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    expect(sum(p.lines, (l) => l.amount)).toBeCloseTo(p.grandTotal, 2);
  });

  test("bos, 10% code", () => {
    const { computed } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "bos");
    const p = printed({
      items: ITEMS, computed, docType: "bos",
      appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    expect(sum(p.lines, (l) => l.amount)).toBeCloseTo(p.grandTotal, 2);
  });
});

// =====================================================================
// B2. "What I stored per item adds up to the bill total I stored."
// =====================================================================
describe("B2 stored lines add up to stored bill total", () => {
  test("invoice, 10% code", () => {
    const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
    expect(sum(rows, (r) => r.total)).toBeCloseTo(computed.grandTotal, 2);
  });

  test("bos, 10% code", () => {
    const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "bos");
    expect(sum(rows, (r) => r.total)).toBeCloseTo(computed.grandTotal, 2);
  });

  test("invoice, ₹500 voucher", () => {
    const { computed, rows } = save(ITEMS, [], [], "invoice", 500);
    expect(sum(rows, (r) => r.total)).toBeCloseTo(computed.grandTotal, 2);
  });
});

// =====================================================================
// B3. "The amount printed against an item equals the amount I stored
//      against that item."
// =====================================================================
describe("B3 printed line == stored line", () => {
  test("invoice, 10% code", () => {
    const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
    const p = printed({
      items: ITEMS, computed, docType: "invoice",
      appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    p.lines.forEach((l, i) => expect(l.amount).toBeCloseTo(rows[i].total, 2));
  });

  test("bos, 10% code", () => {
    const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "bos");
    const p = printed({
      items: ITEMS, computed, docType: "bos",
      appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    p.lines.forEach((l, i) => expect(l.amount).toBeCloseTo(rows[i].total, 2));
  });
});

// =====================================================================
// B4. "The GST% printed against an item is the GST% I stored for it."
// =====================================================================
test("B4 printed GST rate == stored GST rate", () => {
  const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
  const p = printed({
    items: ITEMS, computed, docType: "invoice",
    appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
  });
  p.lines.forEach((l, i) => expect(l.gstRate).toBe(rows[i].gst_rate));
});

// =====================================================================
// B5. "The GST% the operator sees while building the bill is the GST%
//      that ends up on the bill."
// =====================================================================
test("B5 on-screen GST rate (ItemRow/priceItem) == stored GST rate", () => {
  const { rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
  ITEMS.forEach((it, i) => {
    expect(priceItem(it).gstRate).toBe(rows[i].gst_rate);
  });
});

// =====================================================================
// B6. "An alteration charge is a service already done at a quoted price.
//      A discount code never reduces it."
// =====================================================================
describe("B6 alteration is never discounted", () => {
  test("invoice", () => {
    const { rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
    // stored subtotal must still contain the full alteration pre-tax value
    const alterGross = 210;
    const alterPreTax = alterGross / 1.05;
    const goodsOnly = round2(rows[1].subtotal - alterPreTax);
    // if alteration were protected, goods+alterPreTax == subtotal exactly
    expect(round2(goodsOnly + alterPreTax)).toBeCloseTo(rows[1].subtotal, 2);
    // and the alteration's own GST must be exactly 5% of the full quoted charge
    const impliedAlterGst = round2(alterGross - alterPreTax);
    expect(impliedAlterGst).toBeCloseTo(10, 2);
    // the real assertion: does the stored line keep the FULL alteration?
    const alterShareLost = round2(
      priceItem(ITEMS[1]).alteration - (rows[1].subtotal - goodsOnly),
    );
    expect(alterShareLost).toBeCloseTo(0, 2);
  });

  test("bos keeps full alteration in the line total", () => {
    const { rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "bos");
    const p = printed({
      items: ITEMS,
      computed: computeBillTotals(ITEMS, ["SAVE10"], [CODE_10PCT], 0, 0, "bos"),
      docType: "bos", appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    // stored bos line = discounted goods + FULL 210 alteration
    // printed bos line = discounted (goods + alteration)
    expect(p.lines[1].amount).toBeCloseTo(rows[1].total, 2);
  });
});

// =====================================================================
// B7. "Reopening a finalized bill and reprinting it shows the same total
//      the customer paid."
// =====================================================================
describe("B7 reprint reproduces the stored total", () => {
  test("invoice, 10% code", () => {
    const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
    const re = reprintFromDb(rows, ["SAVE10"], [CODE_10PCT], "invoice");
    expect(re.grandTotal).toBeCloseTo(computed.grandTotal, 2);
  });

  test("invoice, no codes (nothing to double-count)", () => {
    const { computed, rows } = save(ITEMS, [], [], "invoice");
    const re = reprintFromDb(rows, [], [], "invoice");
    expect(re.grandTotal).toBeCloseTo(computed.grandTotal, 2);
  });

  test("invoice, ₹5-rounded bill", () => {
    const base = computeBillTotals(ITEMS, [], [], 0, 0, "invoice");
    const target = Math.floor(base.grandTotal / 5) * 5;
    const preDisc = computePreTaxBalanceDiscount(base, target, ITEMS, [], [], 0, "invoice");
    const computed = computeBillTotals(ITEMS, [], [], preDisc, 0, "invoice");
    const rows = buildBillItemsPayload(1, ITEMS, 0, 0, "invoice", preDisc);
    const re = reprintFromDb(rows, [], [], "invoice");
    expect(re.grandTotal).toBeCloseTo(computed.grandTotal, 2);
  });
});

// =====================================================================
// B8. "Rounding down to the nearest ₹5 lands the total on a multiple of ₹5."
// =====================================================================
test("B8 auto-round hits an exact multiple of ₹5", () => {
  const base = computeBillTotals(ITEMS, [], [], 0, 0, "invoice");
  const target = Math.floor(base.grandTotal / 5) * 5;
  const preDisc = computePreTaxBalanceDiscount(base, target, ITEMS, [], [], 0, "invoice");
  const rounded = computeBillTotals(ITEMS, [], [], preDisc, 0, "invoice");
  expect(rounded.grandTotal).toBeCloseTo(target, 2);
});

// =====================================================================
// B9. "If I tell the system the customer pays exactly ₹X, the bill total
//      becomes exactly ₹X."
// =====================================================================
test("B9 balance waiver hits the agreed final amount exactly", () => {
  const base = computeBillTotals(ITEMS, [], [], 0, 0, "invoice");
  const agreed = round2(base.grandTotal - 137.5);
  const preDisc = computePreTaxBalanceDiscount(base, agreed, ITEMS, [], [], 0, "invoice");
  const final = computeBillTotals(ITEMS, [], [], preDisc, 0, "invoice");
  expect(final.grandTotal).toBeCloseTo(agreed, 2);
});

// =====================================================================
// B10. "The discount figure I show as the total equals the sum of the
//       per-item discounts I stored."
// =====================================================================
test("B10 bill-level discount total == sum of stored per-line discounts", () => {
  const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
  const shown = round2(computed.itemLevelDiscountTotal + computed.overallDiscount);
  expect(sum(rows, (r) => r.discount_total)).toBeCloseTo(shown, 2);
});

// =====================================================================
// B11. "CGST and SGST are always equal, and together they are the GST total."
// =====================================================================
test("B11 printed CGST == SGST, and they sum to the GST total", () => {
  const { computed } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
  const p = printed({
    items: ITEMS, computed, docType: "invoice",
    appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
  });
  const c = sum(p.lines, (l) => l.cgst);
  const s = sum(p.lines, (l) => l.sgst);
  expect(c).toBeCloseTo(s, 2);
  expect(round2(c + s)).toBeCloseTo(computed.gstTotal, 2);
});

// =====================================================================
// B12. "A Bill of Supply never shows or charges GST."
// =====================================================================
test("B12 bos charges no GST anywhere", () => {
  const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "bos");
  expect(computed.gstTotal).toBe(0);
  rows.forEach((r) => expect(r.gst_amount).toBe(0));
  // and the bos total must not smuggle GST in through the alteration charge
  const goodsAfterDisc = round2(computed.taxableTotal);
  expect(computed.grandTotal).toBeCloseTo(goodsAfterDisc + 10, 2); // 10 = 5% GST on 210 alteration
});

// =====================================================================
// B13. "The WhatsApp summary shows the same total as the PDF."
// =====================================================================
test("B13 WhatsApp total == printed total", () => {
  const { computed } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
  const p = printed({
    items: ITEMS, computed, docType: "invoice",
    appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
  });
  const text = generateBillText({
    billNumber: "FY26-000001", billDate: "2026-08-20", customerName: "Probe",
    items: ITEMS, computed, paymentMethod: "Cash",
  });
  const m = text.match(/Grand Total:\s+₹([\d,.]+)/);
  expect(m).not.toBeNull();
  expect(num(m[1])).toBeCloseTo(p.grandTotal, 2);
});

// =====================================================================
// B14. "The WhatsApp item lines add up to the WhatsApp total."
// =====================================================================
test("B14 WhatsApp item lines add up to its own total", () => {
  const { computed } = save(ITEMS, ["SAVE10"], [CODE_10PCT], "invoice");
  const text = generateBillText({
    billNumber: "FY26-000001", billDate: "2026-08-20", customerName: "Probe",
    items: ITEMS, computed, paymentMethod: "Cash",
  });
  const lineTotals = [...text.matchAll(/^\d+\..*= ₹([\d,.]+)/gm)].map((m) => num(m[1]));
  const grand = num(text.match(/Grand Total:\s+₹([\d,.]+)/)[1]);
  expect(round2(lineTotals.reduce((a, b) => a + b, 0))).toBeCloseTo(grand, 2);
});

// =====================================================================
// B15. "If a discount drops a stitched item under ₹2500 a piece, the operator
//       sees the same GST% the bill will carry."
// =====================================================================
describe("B15 slab crossing is visible on screen", () => {
  // 2700 stitched: 18% at face value, but a 10% code drops it to 2430 → 5%
  const CROSS = [{
    _id: "c1", product_name: "Sherwani", productid: "BC25009",
    mrp: 2700, quantity: 1, quickDiscountPct: 0, alteration_charge: 0,
    gstRate: 18, stitchType: "stitched", unit_type: "piece",
  }];

  test("on-screen rate == stored rate", () => {
    const { rows } = save(CROSS, ["SAVE10"], [CODE_10PCT], "invoice");
    expect(priceItem(CROSS[0]).gstRate).toBe(rows[0].gst_rate);
  });

  test("printed rate == stored rate", () => {
    const { computed, rows } = save(CROSS, ["SAVE10"], [CODE_10PCT], "invoice");
    const p = printed({
      items: CROSS, computed, docType: "invoice",
      appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    expect(p.lines[0].gstRate).toBe(rows[0].gst_rate);
  });

  test("stored lines still add up to the stored total", () => {
    const { computed, rows } = save(CROSS, ["SAVE10"], [CODE_10PCT], "invoice");
    expect(sum(rows, (r) => r.total)).toBeCloseTo(computed.grandTotal, 2);
  });
});

// =====================================================================
// B16. "A 'GST Off' code on a Bill of Supply gives away nothing, because
//       no GST was ever charged."
// =====================================================================
test("B16 gst_off on a bos does not discount untaxed goods", () => {
  const GST_OFF = { code: "GSTOFF", type: "gst_off", value: 0, exclusive: false, rules: {} };
  const withCode = computeBillTotals(ITEMS, ["GSTOFF"], [GST_OFF], 0, 0, "bos");
  const without = computeBillTotals(ITEMS, [], [], 0, 0, "bos");
  expect(withCode.grandTotal).toBeCloseTo(without.grandTotal, 2);
});

// =====================================================================
// Diagnostics — always printed, so the numbers behind any failure are visible.
// =====================================================================
test("diagnostics dump", () => {
  const report = {};
  for (const docType of ["invoice", "bos"]) {
    const { computed, rows } = save(ITEMS, ["SAVE10"], [CODE_10PCT], docType);
    const p = printed({
      items: ITEMS, computed, docType,
      appliedCodes: ["SAVE10"], allDiscounts: [CODE_10PCT],
    });
    const re = reprintFromDb(rows, ["SAVE10"], [CODE_10PCT], docType);
    report[docType] = {
      screen_grandTotal: computed.grandTotal,
      screen_gstTotal: computed.gstTotal,
      screen_taxableTotal: computed.taxableTotal,
      stored_line_totals: rows.map((r) => r.total),
      stored_sum: sum(rows, (r) => r.total),
      stored_gst_rates: rows.map((r) => r.gst_rate),
      stored_discounts: rows.map((r) => r.discount_total),
      printed_line_amounts: p.lines.map((l) => l.amount),
      printed_sum: sum(p.lines, (l) => l.amount),
      printed_grandTotal: p.grandTotal,
      printed_gst_rates: p.lines.map((l) => l.gstRate),
      onscreen_priceItem_rates: ITEMS.map((it) => priceItem(it).gstRate),
      reprint_grandTotal: re.grandTotal,
      reprint_delta: round2(re.grandTotal - computed.grandTotal),
    };
  }
  const voucher = save(ITEMS, [], [], "invoice", 500);
  report.voucher_500 = {
    screen_grandTotal: voucher.computed.grandTotal,
    stored_sum: sum(voucher.rows, (r) => r.total),
    delta: round2(sum(voucher.rows, (r) => r.total) - voucher.computed.grandTotal),
  };
  // eslint-disable-next-line no-console
  console.log("PROBE\n" + JSON.stringify(report, null, 2));
  expect(true).toBe(true);
});
