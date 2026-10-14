import { PRICE_PRESETS, activePresetIndex } from "../lib/pricePresets";

describe("PRICE_PRESETS", () => {
  it("lists four presets from under 2,000 to above 10,000", () => {
    expect(PRICE_PRESETS.map((p) => p.label)).toEqual([
      "Under ₹2,000",
      "₹2,000 – ₹5,000",
      "₹5,000 – ₹10,000",
      "Above ₹10,000",
    ]);
  });

  it("covers every whole-rupee price exactly once (no gaps, no overlaps)", () => {
    // The hook filters with gte(min) / lte(max), both inclusive.
    const matches = (p, price) =>
      (p.min === null || price >= p.min) && (p.max === null || price <= p.max);
    for (const price of [0, 1, 1999, 2000, 4999, 5000, 9999, 10000, 50000]) {
      expect(PRICE_PRESETS.filter((p) => matches(p, price))).toHaveLength(1);
    }
  });
});

describe("activePresetIndex", () => {
  it("returns the index of the preset whose bounds match exactly", () => {
    expect(activePresetIndex(null, 1999)).toBe(0);
    expect(activePresetIndex(2000, 4999)).toBe(1);
    expect(activePresetIndex(10000, null)).toBe(3);
  });

  it("returns -1 when no preset matches", () => {
    expect(activePresetIndex(2000, 5000)).toBe(-1);
    expect(activePresetIndex(1500, null)).toBe(-1);
  });

  it("returns -1 when no price filter is set", () => {
    expect(activePresetIndex(null, null)).toBe(-1);
    expect(activePresetIndex(undefined, undefined)).toBe(-1);
  });
});
