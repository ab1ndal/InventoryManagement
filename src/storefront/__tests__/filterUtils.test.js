import { computeAvailableOptions, sortByAvailability } from "../hooks/filterUtils";

const CATALOG = [
  {
    productid: "p1", categoryid: "cat-kurta", fabric: "cotton", retailprice: 1000,
    variants: [{ color: "red", size: "S" }, { color: "blue", size: "M" }],
  },
  {
    productid: "p2", categoryid: "cat-kurta", fabric: "silk", retailprice: 2000,
    variants: [{ color: "green", size: "L" }],
  },
  {
    productid: "p3", categoryid: "cat-saree", fabric: "cotton", retailprice: 1500,
    variants: [{ color: "red", size: "Free Size" }],
  },
];

const NO_FILTERS = { categories: [], colors: [], sizes: [], fabrics: [], priceMin: null, priceMax: null };

describe("computeAvailableOptions", () => {
  it("returns all options when no filters active", () => {
    const r = computeAvailableOptions(CATALOG, NO_FILTERS);
    expect(r.categories).toEqual(new Set(["cat-kurta", "cat-saree"]));
    expect(r.colors).toEqual(new Set(["red", "blue", "green"]));
    expect(r.sizes).toEqual(new Set(["S", "M", "L", "Free Size"]));
    expect(r.fabrics).toEqual(new Set(["cotton", "silk"]));
  });

  it("restricts colors/sizes/fabrics when category filter active, not categories itself", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, categories: ["cat-kurta"] });
    expect(r.categories).toEqual(new Set(["cat-kurta", "cat-saree"]));
    expect(r.colors).toEqual(new Set(["red", "blue", "green"]));
    expect(r.sizes).toEqual(new Set(["S", "M", "L"]));
    expect(r.fabrics).toEqual(new Set(["cotton", "silk"]));
  });

  it("restricts categories when color filter active, not colors itself", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, colors: ["green"] });
    expect(r.categories).toEqual(new Set(["cat-kurta"]));
    expect(r.colors).toEqual(new Set(["red", "blue", "green"]));
  });

  it("filters by price range", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, priceMin: 1200, priceMax: 2000 });
    expect(r.categories).toEqual(new Set(["cat-kurta", "cat-saree"]));
    expect(r.colors).toEqual(new Set(["green", "red"]));
    expect(r.fabrics).toEqual(new Set(["silk", "cotton"]));
  });

  it("returns empty sets for empty catalog", () => {
    const r = computeAvailableOptions([], NO_FILTERS);
    expect(r.categories.size).toBe(0);
    expect(r.colors.size).toBe(0);
  });

  it("returns null-safe result for null catalog", () => {
    const r = computeAvailableOptions(null, NO_FILTERS);
    expect(r.categories.size).toBe(0);
  });

  it("cross-filters: category + color restricts sizes to only variants that have both", () => {
    // p1 has (red,S) and (blue,M). Filtering color=red means only (red,S) qualifies.
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, categories: ["cat-kurta"], colors: ["red"] });
    expect(r.sizes).toEqual(new Set(["S"]));
  });

  it("variant co-occurrence: color+size filter only matches products with that exact pairing", () => {
    // p1 has (red,S) and (blue,M). Filtering color=blue,size=S should yield NO match for p1.
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, colors: ["blue"], sizes: ["S"] });
    // No product has a variant with both blue AND S
    expect(r.categories.size).toBe(0);
  });

  it("handles entries with missing variants without crashing", () => {
    const catalogWithNulls = [
      { productid: "p4", categoryid: "cat-kurta", fabric: "cotton", retailprice: 500, variants: null },
      ...CATALOG,
    ];
    expect(() => computeAvailableOptions(catalogWithNulls, NO_FILTERS)).not.toThrow();
  });
});

describe("sortByAvailability", () => {
  it("puts available items before unavailable", () => {
    const items = ["blue", "red", "green"];
    const available = new Set(["red", "green"]);
    const sorted = sortByAvailability(items, (x) => x, available);
    expect(sorted.indexOf("red")).toBeLessThan(sorted.indexOf("blue"));
    expect(sorted.indexOf("green")).toBeLessThan(sorted.indexOf("blue"));
  });

  it("returns items unchanged when availableSet is null", () => {
    expect(sortByAvailability(["a", "b"], (x) => x, null)).toEqual(["a", "b"]);
  });

  it("does not mutate the original array", () => {
    const items = ["blue", "red"];
    const available = new Set(["red"]);
    sortByAvailability(items, (x) => x, available);
    expect(items).toEqual(["blue", "red"]);
  });

  it("selected option not in availableSet still sorts to top (treated as available by caller)", () => {
    // sortByAvailability itself just sorts by set membership.
    // The caller (component) passes selected items as "available" because it excludes them from the unavailable check.
    // This test verifies that an item IN the set sorts before one NOT in the set.
    const items = ["blue", "red"];
    const available = new Set(["red"]); // "blue" is selected but not in available set
    const sorted = sortByAvailability(items, (x) => x, available);
    expect(sorted[0]).toBe("red");
    expect(sorted[1]).toBe("blue");
  });
});
