import { render } from "@testing-library/react";
import InvoiceView from "../InvoiceView";
import { rehydrateBillTotals } from "../rehydrateBill";
import { round2 } from "../billUtils";

const num = (s) => Number(String(s).replace(/[₹,%\s]/g, ""));

// FY26-000267 (billid 284) as actually stored — the bill that exposed the drift.
const BILL_284 = {
  totalamount: 6500.0,
  gst_total: 0,
  discount_total: 1955.0,
  taxable_total: 6496.19,
  applied_codes: [],
  document_type: "bos",
};
const ITEMS_284 = [
  { bill_item_id: 857, product_name: "Bedsheet",           quantity: 1, mrp: 600,  alteration_charge: 0,  discount_total: 0,      subtotal: 600,     total: 600,     gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
  { bill_item_id: 858, product_name: "Silk-Saree",         quantity: 1, mrp: 1995, alteration_charge: 0,  discount_total: 494.96, subtotal: 1500.04, total: 1500.04, gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
  { bill_item_id: 859, product_name: "Cotton-Saree",       quantity: 1, mrp: 1195, alteration_charge: 0,  discount_total: 295.05, subtotal: 899.95,  total: 899.95,  gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
  { bill_item_id: 860, product_name: "Cotton-Saree",       quantity: 1, mrp: 1995, alteration_charge: 0,  discount_total: 494.96, subtotal: 1500.04, total: 1500.04, gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
  { bill_item_id: 861, product_name: "Cotton-Suit (3 Pc)", quantity: 1, mrp: 1495, alteration_charge: 0,  discount_total: 374.95, subtotal: 1120.05, total: 1120.05, gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
  { bill_item_id: 862, product_name: "Cotton-Saree",       quantity: 1, mrp: 1095, alteration_charge: 80, discount_total: 295.08, subtotal: 876.11,  total: 879.93,  gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
];

function renderReprint(billRow, billItems, allDiscounts = []) {
  const { computed, lines, discountLines } = rehydrateBillTotals(billRow, billItems, allDiscounts);
  const { container, unmount } = render(
    <InvoiceView
      billId={284}
      billNumber="FY26-000267"
      billDate="2026-08-03"
      customerName="Test"
      salespersonNames={[]}
      items={billItems}
      computed={computed}
      lines={lines}
      discountLines={discountLines}
      docType={billRow.document_type}
      paymentMethod="Cash"
      paymentAmount={billRow.totalamount}
      appliedCodes={billRow.applied_codes}
      allDiscounts={allDiscounts}
      appliedStoreCredit={0}
    />,
  );
  // Reads the printed invoice the way a customer sees it: line totals by
  // column position, and the grand total from the page text.
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
  const rows = [...container.querySelectorAll("tbody tr")];
  const isBos = billRow.document_type === "bos";
  const printedLines = rows.map((tr) => {
    // eslint-disable-next-line testing-library/no-node-access
    const td = [...tr.querySelectorAll("td")];
    return num(td[isBos ? 5 : 9].textContent);
  });
  // eslint-disable-next-line testing-library/no-container
  const grand = num(container.textContent.match(/Grand Total: ₹([\d.,]+)/)[1]);
  // eslint-disable-next-line testing-library/no-container
  const text = container.textContent;
  unmount();
  return { computed, printedLines, grand, text };
}

describe("reprint of a stored bill (FY26-000267)", () => {
  test("prints the stored grand total exactly", () => {
    const { grand } = renderReprint(BILL_284, ITEMS_284);
    expect(grand).toBe(6500.0);
  });

  test("prints each stored line amount verbatim", () => {
    const { printedLines } = renderReprint(BILL_284, ITEMS_284);
    expect(printedLines).toEqual(ITEMS_284.map((i) => i.total));
  });

  test("shows the stored discount total, not a re-derived one", () => {
    const { text } = renderReprint(BILL_284, ITEMS_284);
    expect(text).toContain("Discount: −₹1955.00");
  });

  test("subtotal − discount reconciles to the printed total", () => {
    const { computed, grand } = renderReprint(BILL_284, ITEMS_284);
    expect(round2(computed.itemsSubtotal - computed.discountTotal)).toBeCloseTo(grand, 2);
  });
});

describe("reprint with a discount code no longer double-counts", () => {
  // A bill whose lines already carry the code discount: re-pricing would apply it twice.
  const billRow = {
    totalamount: 3780.0,
    gst_total: 0,
    discount_total: 420.0,
    taxable_total: 3780.0,
    applied_codes: ["SAVE10"],
    document_type: "bos",
  };
  const items = [
    { bill_item_id: 1, product_name: "A", quantity: 1, mrp: 2800, alteration_charge: 0, discount_total: 280, subtotal: 2520, total: 2520, gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
    { bill_item_id: 2, product_name: "B", quantity: 1, mrp: 1400, alteration_charge: 0, discount_total: 140, subtotal: 1260, total: 1260, gst_rate: null, gst_amount: 0, stitch_type: "unstitched" },
  ];
  const discounts = [{ code: "SAVE10", type: "percentage", value: 10, exclusive: false, rules: {} }];

  test("grand total matches the stored total", () => {
    const { grand } = renderReprint(billRow, items, discounts);
    expect(grand).toBe(3780.0);
  });

  test("lines add up to the printed total", () => {
    const { printedLines, grand } = renderReprint(billRow, items, discounts);
    expect(round2(printedLines.reduce((a, b) => a + b, 0))).toBeCloseTo(grand, 2);
  });

  test("the code breakdown reconciles to the stored discount total", () => {
    const { discountLines } = rehydrateBillTotals(billRow, items, discounts);
    const shown = round2(discountLines.reduce((s, l) => s + l.amount, 0));
    expect(shown).toBeCloseTo(420.0, 2);
  });
});

describe("invoice reprint splits stored GST into equal halves", () => {
  const billRow = {
    totalamount: 1155.0,
    gst_total: 55.0,
    discount_total: 0,
    taxable_total: 1100.0,
    applied_codes: [],
    document_type: "invoice",
  };
  const items = [
    { bill_item_id: 1, product_name: "A", quantity: 1, mrp: 1100, alteration_charge: 0, discount_total: 0, subtotal: 1100, total: 1155, gst_rate: 5, gst_amount: 55, stitch_type: "unstitched" },
  ];

  test("cgst + sgst equals the stored gst_amount", () => {
    const { lines } = rehydrateBillTotals(billRow, items);
    expect(round2(lines[0].cgst + lines[0].sgst)).toBeCloseTo(55.0, 2);
  });

  test("prints the stored line total and grand total", () => {
    const { printedLines, grand } = renderReprint(billRow, items);
    expect(printedLines).toEqual([1155]);
    expect(grand).toBe(1155.0);
  });
});
