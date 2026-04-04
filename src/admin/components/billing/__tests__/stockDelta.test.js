import { computeStockDelta } from "../stockHelpers";

describe("computeStockDelta", () => {
  it("new draft: empty existing, 2 new items → negative deltas only", () => {
    const existing = [];
    const newItems = [
      { variantid: "v1", quantity: 3 },
      { variantid: "v2", quantity: 1 },
    ];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBe(-3);
    expect(delta["v2"]).toBe(-1);
  });

  it("update with same items same qty → all deltas zero", () => {
    const existing = [{ variantid: "v1", quantity: 2 }];
    const newItems = [{ variantid: "v1", quantity: 2 }];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBe(0);
  });

  it("update with qty increase → negative delta for that variant", () => {
    const existing = [{ variantid: "v1", quantity: 2 }];
    const newItems = [{ variantid: "v1", quantity: 5 }];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBe(-3);
  });

  it("update with item removal → positive delta (stock restored)", () => {
    const existing = [
      { variantid: "v1", quantity: 2 },
      { variantid: "v2", quantity: 1 },
    ];
    const newItems = [{ variantid: "v1", quantity: 2 }];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBe(0);
    expect(delta["v2"]).toBe(1);
  });

  it("update with item addition → new negative delta", () => {
    const existing = [{ variantid: "v1", quantity: 2 }];
    const newItems = [
      { variantid: "v1", quantity: 2 },
      { variantid: "v3", quantity: 4 },
    ];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBe(0);
    expect(delta["v3"]).toBe(-4);
  });

  it("mixed changes: some removed, some added, some qty changed", () => {
    // existing: v1=3, v2=2
    // new: v1=1 (qty decreased), v3=5 (new item, v2 removed)
    const existing = [
      { variantid: "v1", quantity: 3 },
      { variantid: "v2", quantity: 2 },
    ];
    const newItems = [
      { variantid: "v1", quantity: 1 },
      { variantid: "v3", quantity: 5 },
    ];
    const delta = computeStockDelta(existing, newItems);
    // v1: +3 (restore old) - 1 (new qty) = +2
    expect(delta["v1"]).toBe(2);
    // v2: +2 (restore, not in new) = +2
    expect(delta["v2"]).toBe(2);
    // v3: -5 (new item) = -5
    expect(delta["v3"]).toBe(-5);
  });

  it("ignores items with null variantid", () => {
    const existing = [{ variantid: null, quantity: 2 }];
    const newItems = [{ variantid: null, quantity: 3 }];
    const delta = computeStockDelta(existing, newItems);
    expect(Object.keys(delta)).toHaveLength(0);
  });
});
