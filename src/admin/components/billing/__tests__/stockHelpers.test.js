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

describe("linesWithSavedIds", () => {
  const { linesWithSavedIds } = require("../stockHelpers");
  const items = [{ _id: "11" }, { _id: "uuid-new" }, { _id: "13" }];
  const payload = [{ product_name: "A" }, { product_name: "N" }, { product_name: "C" }];

  test("saved lines carry their id, new ones none; a line left out is simply not sent", () => {
    expect(linesWithSavedIds(new Set(["11", "12", "13"]), items, payload)).toEqual([
      { bill_item_id: 11, product_name: "A" },
      { bill_item_id: null, product_name: "N" },
      { bill_item_id: 13, product_name: "C" },
    ]);
  });

  test("a bill with no saved lines sends them all as new", () => {
    expect(linesWithSavedIds(new Set(), items, payload).map((l) => l.bill_item_id)).toEqual([null, null, null]);
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

  test("names an exchanged line raised above its saved quantity", () => {
    const saved = { 11: { qty: 1, savedQty: 2, name: "Kurti" } };
    expect(exchangedLineProblems([{ _id: "11", quantity: 2 }], saved)).toBeNull();
    expect(exchangedLineProblems([{ _id: "11", quantity: 3 }], saved)).toBe(
      "Kurti: already exchanged, so the quantity cannot go above 2. Add more as a new item.",
    );
  });
});
