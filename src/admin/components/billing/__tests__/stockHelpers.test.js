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
