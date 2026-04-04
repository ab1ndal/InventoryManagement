import { priceItem, normalizeItem, computeBillTotals } from "../billUtils";
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
      gstRate: 12,
    });
    expect(result.qty).toBe(3);
    expect(result.mrp).toBe(200);
    expect(result.quickDiscountPct).toBe(15);
    expect(result.alteration).toBe(100);
    expect(result.gstRate).toBe(12);
  });
});

describe("priceItem", () => {
  it("Item A: no discount, 18% GST, with alteration", () => {
    // qty=2, mrp=500, disc=0%, alt=50, gst=18%
    // base=1000, itemDisc=0, withCharges=1050, gst=189, total=1239
    const item = {
      quantity: 2,
      mrp: 500,
      quickDiscountPct: 0,
      alteration_charge: 50,
      gstRate: 18,
    };
    const result = priceItem(item);
    expect(result.base).toBeCloseTo(1000, 2);
    expect(result.itemDisc).toBeCloseTo(0, 2);
    expect(result.withCharges).toBeCloseTo(1050, 2);
    expect(result.subtotal).toBeCloseTo(1050, 2);
    expect(result.gst_amount).toBeCloseTo(189, 2);
    expect(result.total).toBeCloseTo(1239, 2);
  });

  it("Item B: 10% discount, 12% GST, no alteration", () => {
    // qty=1, mrp=1000, disc=10%, alt=0, gst=12%
    // base=1000, itemDisc=100, withCharges=900, gst=108, total=1008
    const item = {
      quantity: 1,
      mrp: 1000,
      quickDiscountPct: 10,
      alteration_charge: 0,
      gstRate: 12,
    };
    const result = priceItem(item);
    expect(result.base).toBeCloseTo(1000, 2);
    expect(result.itemDisc).toBeCloseTo(100, 2);
    expect(result.withCharges).toBeCloseTo(900, 2);
    expect(result.subtotal).toBeCloseTo(900, 2);
    expect(result.gst_amount).toBeCloseTo(108, 2);
    expect(result.total).toBeCloseTo(1008, 2);
  });

  it("treats 0 quantity as 1 (normalizeItem floor): base = mrp * 1", () => {
    // normalizeItem uses `Number(it.quantity || 1)`, so qty=0 → qty=1
    const item = { quantity: 0, mrp: 500, quickDiscountPct: 10, alteration_charge: 50, gstRate: 18 };
    const result = priceItem(item);
    // qty=1, mrp=500, disc=10%, alt=50, gst=18%
    // base=500, itemDisc=50, withCharges=500, gst=90, total=590
    expect(result.base).toBeCloseTo(500, 2);
    expect(result.itemDisc).toBeCloseTo(50, 2);
    expect(result.withCharges).toBeCloseTo(500, 2); // 500-50+50
    expect(result.subtotal).toBeCloseTo(500, 2);
    expect(result.gst_amount).toBeCloseTo(90, 2);
    expect(result.total).toBeCloseTo(590, 2);
  });
});

describe("computeBillTotals", () => {
  it("single item no discounts: grandTotal = subtotal + gst", () => {
    const items = [
      { quantity: 1, mrp: 1000, quickDiscountPct: 0, alteration_charge: 0, gstRate: 18 },
    ];
    const result = computeBillTotals(items, [], []);
    expect(result.overallDiscount).toBeCloseTo(0, 2);
    expect(result.taxableTotal).toBeCloseTo(1000, 2);
    expect(result.gstTotal).toBeCloseTo(180, 2);
    expect(result.grandTotal).toBeCloseTo(1180, 2);
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
