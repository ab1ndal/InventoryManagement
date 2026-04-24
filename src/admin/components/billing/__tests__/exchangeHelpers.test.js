import {
  calcItemCredit,
  buildReturnedQtyMap,
  buildReturnedItemsWithCredit,
  computeCreditsApplied,
  isExchangeEligible,
  isWithinExchangeWindow,
  daysSinceBill,
  EXCHANGE_WINDOW_DAYS,
} from "../exchangeHelpers";

// ---------------------------------------------------------------------------
// calcItemCredit — uses bi.total * (returnQty / quantity) (GST-inclusive)
// ---------------------------------------------------------------------------
describe("calcItemCredit", () => {
  // bi.total = (mrp*qty - discount) + gst = 2760 for this fixture
  const bi = { quantity: 3, total: 2760 };

  it("full return = total", () => {
    expect(calcItemCredit(bi, 3)).toBe(2760);
  });

  it("1/3 return = total / 3", () => {
    expect(calcItemCredit(bi, 1)).toBe(920);
  });

  it("2/3 return = total * 2/3", () => {
    expect(calcItemCredit(bi, 2)).toBe(1840);
  });

  it("returns 0 for returnQty = 0", () => {
    expect(calcItemCredit(bi, 0)).toBe(0);
  });

  it("returns 0 for negative returnQty", () => {
    expect(calcItemCredit(bi, -1)).toBe(0);
  });

  it("handles missing total (treats as 0)", () => {
    expect(calcItemCredit({ quantity: 1 }, 1)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    // total=10, qty=3, returnQty=1 → 10/3 = 3.333... → rounds to 3.33
    expect(calcItemCredit({ quantity: 3, total: 10 }, 1)).toBe(3.33);
  });
});

// ---------------------------------------------------------------------------
// buildReturnedQtyMap
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// buildReturnedItemsWithCredit
// ---------------------------------------------------------------------------
describe("buildReturnedItemsWithCredit", () => {
  const billItems = [
    { bill_item_id: 10, quantity: 3, total: 2760, product_name: "Kurti" },
    { bill_item_id: 11, quantity: 2, total: 1000, product_name: "Dupatta" },
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

// ---------------------------------------------------------------------------
// computeCreditsApplied
// ---------------------------------------------------------------------------
describe("computeCreditsApplied", () => {
  it("applies store credit then exchange credit", () => {
    const r = computeCreditsApplied(5000, 1000, 1500);
    expect(r.storeCreditUsed).toBe(1000);
    expect(r.exchangeCreditUsed).toBe(1500);
    expect(r.effectiveTotal).toBe(2500);
  });

  it("caps store credit at grandTotal", () => {
    const r = computeCreditsApplied(500, 1000, 0);
    expect(r.storeCreditUsed).toBe(500);
    expect(r.effectiveTotal).toBe(0);
  });

  it("caps exchange credit at remainder after store credit", () => {
    const r = computeCreditsApplied(1000, 600, 800);
    expect(r.storeCreditUsed).toBe(600);
    expect(r.exchangeCreditUsed).toBe(400); // only 400 left
    expect(r.effectiveTotal).toBe(0);
  });

  it("handles all zeros", () => {
    const r = computeCreditsApplied(0, 0, 0);
    expect(r).toEqual({ storeCreditUsed: 0, exchangeCreditUsed: 0, effectiveTotal: 0 });
  });

  it("handles exchange-only (no store credit)", () => {
    const r = computeCreditsApplied(2000, 0, 500);
    expect(r.storeCreditUsed).toBe(0);
    expect(r.exchangeCreditUsed).toBe(500);
    expect(r.effectiveTotal).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// isExchangeEligible
// ---------------------------------------------------------------------------
describe("isExchangeEligible", () => {
  it("returns true when alteration_charge is 0", () => {
    expect(isExchangeEligible({ alteration_charge: 0 })).toBe(true);
  });

  it("returns true when alteration_charge is absent", () => {
    expect(isExchangeEligible({})).toBe(true);
    expect(isExchangeEligible({ alteration_charge: null })).toBe(true);
  });

  it("returns false when alteration_charge > 0", () => {
    expect(isExchangeEligible({ alteration_charge: 100 })).toBe(false);
    expect(isExchangeEligible({ alteration_charge: 0.01 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// daysSinceBill / isWithinExchangeWindow — boundary tests
// ---------------------------------------------------------------------------
describe("daysSinceBill / isWithinExchangeWindow", () => {
  function makeDate(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  }

  it("EXCHANGE_WINDOW_DAYS is 7", () => {
    expect(EXCHANGE_WINDOW_DAYS).toBe(7);
  });

  it("same day = 0 days — allowed", () => {
    expect(daysSinceBill(makeDate(0))).toBe(0);
    expect(isWithinExchangeWindow(makeDate(0))).toBe(true);
  });

  it("day 7 — allowed (inclusive)", () => {
    expect(daysSinceBill(makeDate(7))).toBe(7);
    expect(isWithinExchangeWindow(makeDate(7))).toBe(true);
  });

  it("day 8 — rejected", () => {
    expect(daysSinceBill(makeDate(8))).toBe(8);
    expect(isWithinExchangeWindow(makeDate(8))).toBe(false);
  });

  it("day 30 — rejected", () => {
    expect(isWithinExchangeWindow(makeDate(30))).toBe(false);
  });
});
