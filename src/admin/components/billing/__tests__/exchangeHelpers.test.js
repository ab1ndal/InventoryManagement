import {
  calcItemCredit,
  buildReturnedQtyMap,
  computeMaxReturnQty,
  buildReturnedItemsWithCredit,
} from "../exchangeHelpers";

describe("calcItemCredit (D-08)", () => {
  const bi = { quantity: 3, mrp: 1000, discount_total: 300, alteration_charge: 60 };
  // Formula: (mrp * returnQty) - (discount_total * returnQty/quantity) + (alteration_charge * returnQty/quantity)
  // Full return (returnQty=3): 3000 - 300 + 60 = 2760
  // Partial return (returnQty=1): 1000 - 100 + 20 = 920
  // Partial return (returnQty=2): 2000 - 200 + 40 = 1840

  it("computes full-qty credit = mrp*qty - discount + alteration", () => {
    expect(calcItemCredit(bi, 3)).toBe(2760);
  });

  it("computes 1/3 partial credit proportionally", () => {
    expect(calcItemCredit(bi, 1)).toBe(920);
  });

  it("computes 2/3 partial credit proportionally", () => {
    expect(calcItemCredit(bi, 2)).toBe(1840);
  });

  it("returns 0 when returnQty is 0", () => {
    expect(calcItemCredit(bi, 0)).toBe(0);
  });

  it("returns 0 when returnQty is negative", () => {
    expect(calcItemCredit(bi, -1)).toBe(0);
  });

  it("handles bi with null/undefined numeric fields", () => {
    expect(calcItemCredit({ quantity: 1, mrp: 500 }, 1)).toBe(500);
  });

  it("handles zero mrp", () => {
    expect(calcItemCredit({ quantity: 2, mrp: 0, discount_total: 0, alteration_charge: 100 }, 1)).toBe(50);
  });
});

describe("buildReturnedQtyMap", () => {
  it("sums quantities per original_bill_item_id", () => {
    const existing = [
      { original_bill_item_id: 10, quantity: 1 },
      { original_bill_item_id: 10, quantity: 2 },
      { original_bill_item_id: 11, quantity: 1 },
    ];
    expect(buildReturnedQtyMap(existing)).toEqual({ 10: 3, 11: 1 });
  });
  it("returns empty object for null/empty input", () => {
    expect(buildReturnedQtyMap(null)).toEqual({});
    expect(buildReturnedQtyMap([])).toEqual({});
  });
});

describe("computeMaxReturnQty", () => {
  const billItems = [
    { bill_item_id: 10, quantity: 3, mrp: 500 },
    { bill_item_id: 11, quantity: 2, mrp: 200 },
    { bill_item_id: 12, quantity: 1, mrp: 100 },
  ];

  it("returns full qty as maxReturnQty when no existing exchanges", () => {
    const result = computeMaxReturnQty(billItems, []);
    expect(result.map(r => [r.bill_item_id, r.maxReturnQty])).toEqual([[10,3],[11,2],[12,1]]);
  });

  it("subtracts already-returned qty and drops fully-returned items", () => {
    const existing = [
      { original_bill_item_id: 10, quantity: 1 },
      { original_bill_item_id: 12, quantity: 1 }, // fully returned → drop
    ];
    const result = computeMaxReturnQty(billItems, existing);
    expect(result.map(r => [r.bill_item_id, r.maxReturnQty])).toEqual([[10,2],[11,2]]);
  });
});

describe("buildReturnedItemsWithCredit", () => {
  const billItems = [
    { bill_item_id: 10, quantity: 3, mrp: 1000, discount_total: 300, alteration_charge: 60, product_name: "Kurti" },
    { bill_item_id: 11, quantity: 2, mrp: 500,  discount_total: 0,   alteration_charge: 0,  product_name: "Dupatta" },
  ];

  it("filters out zero-qty entries", () => {
    const result = buildReturnedItemsWithCredit(billItems, { 10: 0, 11: 2 });
    expect(result.length).toBe(1);
    expect(result[0].bill_item_id).toBe(11);
  });

  it("attaches returnQty and creditAmount per item", () => {
    const result = buildReturnedItemsWithCredit(billItems, { 10: 1, 11: 2 });
    expect(result[0]).toMatchObject({ bill_item_id: 10, returnQty: 1, creditAmount: 920 });
    expect(result[1]).toMatchObject({ bill_item_id: 11, returnQty: 2, creditAmount: 1000 });
  });
});
