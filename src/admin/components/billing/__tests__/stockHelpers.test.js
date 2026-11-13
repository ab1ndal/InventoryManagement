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

describe("buildBillItemsPayload discount distribution", () => {
  const items = [
    { mrp: 1995, quantity: 1, stitchType: "unstitched", source: "manual", product_code: "A" },
    { mrp: 1195, quantity: 1, stitchType: "unstitched", source: "manual", product_code: "B" },
    { mrp: 1495, quantity: 1, stitchType: "unstitched", source: "manual", product_code: "C" },
  ];

  test("balanceDiscount (explicit partial-finalize waiver) keeps decimal proportional split", () => {
    const balanceDiscount = 100;
    const rows = buildBillItemsPayload(1, items, balanceDiscount, 0, "bos");
    const sum = rows.reduce((s, r) => s + r.discount_total, 0);
    expect(sum).toBeCloseTo(balanceDiscount, 2);
  });
});

describe("diffBillItems", () => {
  const { diffBillItems } = require("../stockHelpers");
  const items = [{ _id: "11" }, { _id: "uuid-new" }, { _id: "13" }];
  const payload = [{ product_name: "A" }, { product_name: "N" }, { product_name: "C" }];

  test("saved lines update in place, new ones insert, missing ones delete", () => {
    expect(diffBillItems(new Set(["11", "12", "13"]), items, payload)).toEqual({
      removeIds: [12],
      updates: [
        { bill_item_id: 11, row: { product_name: "A" } },
        { bill_item_id: 13, row: { product_name: "C" } },
      ],
      inserts: [{ product_name: "N" }],
      insertIds: ["uuid-new"],
    });
  });

  test("a new draft's lines are all inserts", () => {
    expect(diffBillItems(new Set(), items, payload)).toMatchObject({ removeIds: [], updates: [], inserts: payload });
  });
});

describe("exchangedLineProblems", () => {
  const { exchangedLineProblems } = require("../stockHelpers");
  const exchanged = { 11: { qty: 2, name: "Kurti" } };

  test("none when the exchanged line stays at or above its exchanged quantity", () => {
    expect(exchangedLineProblems([{ _id: "11", quantity: 2 }], exchanged)).toBeNull();
    expect(exchangedLineProblems([{ _id: "11", quantity: 3 }], {})).toBeNull();
  });

  test("names a removed or reduced exchanged line", () => {
    expect(exchangedLineProblems([], exchanged)).toBe("Kurti: 2 already exchanged, so it stays on the bill");
    expect(exchangedLineProblems([{ _id: "11", quantity: 1 }], exchanged)).toBe(
      "Kurti: 2 already exchanged, so the quantity cannot go below 2",
    );
  });
});
