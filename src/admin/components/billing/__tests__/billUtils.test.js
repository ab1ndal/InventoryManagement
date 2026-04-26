import { priceItem, normalizeItem, computeBillTotals, computeAlterationDeposit } from "../billUtils";
import { backCalcDiscountPct } from "../stockHelpers";

describe("normalizeItem", () => {
  it("applies defaults for missing fields", () => {
    const result = normalizeItem({});
    expect(result.qty).toBe(1);
    expect(result.mrp).toBe(0);
    expect(result.quickDiscountPct).toBe(0);
    expect(result.alteration).toBe(0);
    expect(result.gstRate).toBe(18);
  });

  it("uses provided values when present", () => {
    const result = normalizeItem({
      quantity: 3,
      mrp: 200,
      quickDiscountPct: 15,
      alteration_charge: 100,
      gstRate: 18,
    });
    expect(result.qty).toBe(3);
    expect(result.mrp).toBe(200);
    expect(result.quickDiscountPct).toBe(15);
    // alteration_charge is GST-inclusive; normalizeItem strips GST (÷1.05) to get pre-tax
    expect(result.alteration).toBeCloseTo(100 / 1.05, 2);
    expect(result.gstRate).toBe(18);
  });
});

describe("priceItem", () => {
  it("Item A: no discount, 18% GST (stitched >2500/unit), with alteration", () => {
    // qty=1, mrp=3000, disc=0%, alt=105 (gross; pre-tax=100), stitched
    // pricePerUnit=3000 > 2500 → 18% slab
    // base=3000, itemDisc=0, withCharges=3100, itemGst=540, alterGst=5, total=3645
    const item = {
      quantity: 1,
      mrp: 3000,
      quickDiscountPct: 0,
      alteration_charge: 105,
      gstRate: 18,
      stitchType: "stitched",
    };
    const result = priceItem(item);
    expect(result.base).toBeCloseTo(3000, 2);
    expect(result.itemDisc).toBeCloseTo(0, 2);
    expect(result.withCharges).toBeCloseTo(3100, 2);
    expect(result.subtotal).toBeCloseTo(3100, 2);
    expect(result.gst_amount).toBeCloseTo(545, 2);
    expect(result.total).toBeCloseTo(3645, 2);
  });

  it("Item B: 10% discount, 5% GST (stitched ≤2500/unit), no alteration", () => {
    // qty=1, mrp=1000, disc=10%, alt=0, stitched
    // pricePerUnit=900 < 2500 → 5% slab (GST only supports 5% and 18%)
    // base=1000, itemDisc=100, withCharges=900, gst=45, total=945
    const item = {
      quantity: 1,
      mrp: 1000,
      quickDiscountPct: 10,
      alteration_charge: 0,
      gstRate: 18,
      stitchType: "stitched",
    };
    const result = priceItem(item);
    expect(result.base).toBeCloseTo(1000, 2);
    expect(result.itemDisc).toBeCloseTo(100, 2);
    expect(result.withCharges).toBeCloseTo(900, 2);
    expect(result.subtotal).toBeCloseTo(900, 2);
    expect(result.gst_amount).toBeCloseTo(45, 2);
    expect(result.total).toBeCloseTo(945, 2);
  });

  it("treats 0 quantity as 1 (normalizeItem floor): base = mrp * 1", () => {
    // normalizeItem uses `Number(it.quantity || 1)`, so qty=0 → qty=1
    // qty=1, mrp=3000, disc=10%, alt=105 (gross; pre-tax=100), stitched
    // afterDisc=2700 > 2500 → 18%; withCharges=2800, itemGst=486, alterGst=5, total=3291
    const item = { quantity: 0, mrp: 3000, quickDiscountPct: 10, alteration_charge: 105, gstRate: 18, stitchType: "stitched" };
    const result = priceItem(item);
    expect(result.base).toBeCloseTo(3000, 2);
    expect(result.itemDisc).toBeCloseTo(300, 2);
    expect(result.withCharges).toBeCloseTo(2800, 2); // 2700 + 100
    expect(result.subtotal).toBeCloseTo(2800, 2);
    expect(result.gst_amount).toBeCloseTo(491, 2); // 486 + 5
    expect(result.total).toBeCloseTo(3291, 2);
  });
});

describe("computeBillTotals", () => {
  it("single stitched item >2500/unit, no discounts: 18% GST", () => {
    // mrp=3000 > 2500 → 18% slab for stitched
    const items = [
      { quantity: 1, mrp: 3000, quickDiscountPct: 0, alteration_charge: 0, gstRate: 18, stitchType: "stitched" },
    ];
    const result = computeBillTotals(items, [], []);
    expect(result.overallDiscount).toBeCloseTo(0, 2);
    expect(result.taxableTotal).toBeCloseTo(3000, 2);
    expect(result.gstTotal).toBeCloseTo(540, 2);
    expect(result.grandTotal).toBeCloseTo(3540, 2);
  });

  it("single unstitched item: always 5% GST regardless of gstRate field", () => {
    const items = [
      { quantity: 1, mrp: 1000, quickDiscountPct: 0, alteration_charge: 0, gstRate: 18, stitchType: "unstitched" },
    ];
    const result = computeBillTotals(items, [], []);
    expect(result.taxableTotal).toBeCloseTo(1000, 2);
    expect(result.gstTotal).toBeCloseTo(50, 2);
    expect(result.grandTotal).toBeCloseTo(1050, 2);
  });

  it("empty items returns all zeros", () => {
    const result = computeBillTotals([], [], []);
    expect(result.itemsSubtotal).toBeCloseTo(0, 2);
    expect(result.itemLevelDiscountTotal).toBeCloseTo(0, 2);
    expect(result.overallDiscount).toBeCloseTo(0, 2);
    expect(result.taxableTotal).toBeCloseTo(0, 2);
    expect(result.gstTotal).toBeCloseTo(0, 2);
    expect(result.grandTotal).toBeCloseTo(0, 2);
  });
});

describe("backCalcDiscountPct", () => {
  it("computes correct percentage: backCalcDiscountPct(100, 500, 2) = 10", () => {
    // 100 / (500 * 2) * 100 = 10
    expect(backCalcDiscountPct(100, 500, 2)).toBeCloseTo(10, 2);
  });

  it("handles division by zero: backCalcDiscountPct(0, 0, 0) = 0", () => {
    expect(backCalcDiscountPct(0, 0, 0)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    // 10 / (30 * 1) * 100 = 33.333...
    const result = backCalcDiscountPct(10, 30, 1);
    expect(result).toBeCloseTo(33.33, 2);
  });
});

describe("computeAlterationDeposit", () => {
  it("returns 0 when no items have alteration charges", () => {
    const items = [
      { quantity: 1, mrp: 500, quickDiscountPct: 0, alteration_charge: 0, gstRate: 5, stitchType: "unstitched" },
      { quantity: 2, mrp: 300, quickDiscountPct: 10, alteration_charge: 0, gstRate: 5, stitchType: "unstitched" },
    ];
    expect(computeAlterationDeposit(items)).toBe(0);
  });

  it("sums total (with GST) of items that have alteration charges", () => {
    const items = [
      { quantity: 1, mrp: 500, quickDiscountPct: 0, alteration_charge: 50, gstRate: 5, stitchType: "stitched" },
    ];
    const result = computeAlterationDeposit(items);
    expect(result).toBeCloseTo(575, 0);
  });

  it("ignores items without alteration charges", () => {
    const items = [
      { quantity: 1, mrp: 500, quickDiscountPct: 0, alteration_charge: 0, gstRate: 5, stitchType: "unstitched" },
      { quantity: 1, mrp: 400, quickDiscountPct: 0, alteration_charge: 50, gstRate: 5, stitchType: "stitched" },
    ];
    const withAltOnly = [items[1]];
    expect(computeAlterationDeposit(items)).toBeCloseTo(computeAlterationDeposit(withAltOnly), 2);
  });

  it("sums across multiple altered items", () => {
    const items = [
      { quantity: 1, mrp: 500, quickDiscountPct: 0, alteration_charge: 50, gstRate: 5, stitchType: "stitched" },
      { quantity: 1, mrp: 400, quickDiscountPct: 0, alteration_charge: 30, gstRate: 5, stitchType: "stitched" },
    ];
    const individual = items.map((it) => computeAlterationDeposit([it]));
    expect(computeAlterationDeposit(items)).toBeCloseTo(individual[0] + individual[1], 2);
  });
});
