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

describe("buildBillItemsPayload roundingDiscount", () => {
  const items = [
    { mrp: 1995, quantity: 1, stitchType: "unstitched", source: "manual", product_code: "A" },
    { mrp: 1195, quantity: 1, stitchType: "unstitched", source: "manual", product_code: "B" },
    { mrp: 1495, quantity: 1, stitchType: "unstitched", source: "manual", product_code: "C" },
  ];

  test("distributes in whole rupees across non-last items, last item absorbs the remainder", () => {
    const roundingDiscount = 3.4; // typical pre-tax value for a ₹5-rounding, GST layered on top
    const rows = buildBillItemsPayload(1, items, 0, 0, "bos", roundingDiscount);
    const nonLast = rows.slice(0, -1);
    nonLast.forEach((row) => {
      // discount_total on non-last rows is itemDisc(0) + overallDisc(0) + balanceDisc(0) + wholeRupeeShare
      expect(Number.isInteger(row.discount_total)).toBe(true);
    });
    const sum = rows.reduce((s, r) => s + r.discount_total, 0);
    expect(sum).toBeCloseTo(roundingDiscount, 2);
  });

  test("balanceDiscount (explicit partial-finalize waiver) keeps decimal proportional split", () => {
    const balanceDiscount = 100;
    const rows = buildBillItemsPayload(1, items, balanceDiscount, 0, "bos");
    const sum = rows.reduce((s, r) => s + r.discount_total, 0);
    expect(sum).toBeCloseTo(balanceDiscount, 2);
  });
});
