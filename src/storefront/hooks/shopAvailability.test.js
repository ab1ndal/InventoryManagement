import { buildAvailabilityArgs, computeAvailability, mapAvailability } from "./shopAvailability";

const NO_FILTERS = { categories: [], colors: [], sizes: [], fabrics: [], priceMin: null, priceMax: null };

const COLOR_FAMILY_TO_CODES = { Blue: ["NAVY", "TEAL"], Green: ["TEAL", "OLIVE"] };
const FABRIC_FAMILY_TO_CODES = { Silk: ["KATAN", "TUSSAR"], Cotton: ["MUL"] };

describe("buildAvailabilityArgs", () => {
  it("passes null for every dimension when no filters are active", () => {
    expect(buildAvailabilityArgs(NO_FILTERS, COLOR_FAMILY_TO_CODES, FABRIC_FAMILY_TO_CODES)).toEqual({
      p_categories: null,
      p_color_codes: null,
      p_sizes: null,
      p_fabric_codes: null,
      p_price_min: null,
      p_price_max: null,
    });
  });

  it("expands colour and fabric families to their distinct member codes", () => {
    const args = buildAvailabilityArgs(
      { ...NO_FILTERS, colors: ["Blue", "Green"], fabrics: ["Silk", "Cotton"] },
      COLOR_FAMILY_TO_CODES,
      FABRIC_FAMILY_TO_CODES
    );
    expect(args.p_color_codes).toEqual(["NAVY", "TEAL", "OLIVE"]);
    expect(args.p_fabric_codes).toEqual(["KATAN", "TUSSAR", "MUL"]);
  });

  it("passes categories and sizes through as-is", () => {
    const args = buildAvailabilityArgs(
      { ...NO_FILTERS, categories: ["T-SHT"], sizes: ["XL|42", "FREE-SIZE"] },
      COLOR_FAMILY_TO_CODES,
      FABRIC_FAMILY_TO_CODES
    );
    expect(args.p_categories).toEqual(["T-SHT"]);
    expect(args.p_sizes).toEqual(["XL|42", "FREE-SIZE"]);
  });

  it("keeps the __no_match__ sentinel when a family expands to no codes", () => {
    const args = buildAvailabilityArgs(
      { ...NO_FILTERS, colors: ["Unknown"], fabrics: ["Unknown"] },
      COLOR_FAMILY_TO_CODES,
      FABRIC_FAMILY_TO_CODES
    );
    expect(args.p_color_codes).toEqual(["__no_match__"]);
    expect(args.p_fabric_codes).toEqual(["__no_match__"]);
  });

  it("passes price bounds through, including zero", () => {
    const args = buildAvailabilityArgs(
      { ...NO_FILTERS, priceMin: 0, priceMax: 5000 },
      COLOR_FAMILY_TO_CODES,
      FABRIC_FAMILY_TO_CODES
    );
    expect(args.p_price_min).toBe(0);
    expect(args.p_price_max).toBe(5000);
  });
});

describe("mapAvailability", () => {
  const COLOR_CODE_TO_FAMILIES = { NAVY: ["Blue"], TEAL: ["Blue", "Green"], OLIVE: ["Green"] };
  const FABRIC_CODE_TO_FAMILIES = { KATAN: ["Silk"], MUL: ["Cotton"] };

  it("maps codes up to every family they belong to", () => {
    const result = mapAvailability(
      { categories: ["T-SHT", "KURTA"], color_codes: ["TEAL"], sizes: ["S|36"], fabric_codes: ["KATAN", "MUL"] },
      COLOR_CODE_TO_FAMILIES,
      FABRIC_CODE_TO_FAMILIES
    );
    expect(result.categories).toEqual(new Set(["T-SHT", "KURTA"]));
    expect(result.colors).toEqual(new Set(["Blue", "Green"]));
    expect(result.sizes).toEqual(new Set(["S|36"]));
    expect(result.fabrics).toEqual(new Set(["Silk", "Cotton"]));
  });

  it("ignores codes with no known family", () => {
    const result = mapAvailability(
      { categories: [], color_codes: ["NAVY", "MYSTERY"], sizes: [], fabric_codes: ["MYSTERY"] },
      COLOR_CODE_TO_FAMILIES,
      FABRIC_CODE_TO_FAMILIES
    );
    expect(result.colors).toEqual(new Set(["Blue"]));
    expect(result.fabrics).toEqual(new Set());
  });

  it("treats missing arrays as empty", () => {
    const result = mapAvailability({}, COLOR_CODE_TO_FAMILIES, FABRIC_CODE_TO_FAMILIES);
    expect(result).toEqual({
      categories: new Set(),
      colors: new Set(),
      sizes: new Set(),
      fabrics: new Set(),
    });
  });
});

describe("computeAvailability", () => {
  // Mirrors get_shop_available_options for a small, fully loaded product set.
  const ROWS = [
    { productid: "A", categoryid: "SA", fabric: "KATAN", retailprice: 5000, productsizecolors: [{ color: "NAVY", size: "FREE" }] },
    { productid: "B", categoryid: "LE", fabric: "MUL", retailprice: 9000, productsizecolors: [{ color: "RED", size: "M|38" }, { color: "NAVY", size: "L|40" }] },
    { productid: "C", categoryid: null, fabric: null, retailprice: 2000, productsizecolors: [{ color: null, size: null }] },
  ];
  const sorted = (r) => ({
    categories: [...r.categories].sort(),
    color_codes: [...r.color_codes].sort(),
    sizes: [...r.sizes].sort(),
    fabric_codes: [...r.fabric_codes].sort(),
  });
  const args = (o = {}) => ({ ...buildAvailabilityArgs(NO_FILTERS, {}, {}), ...o });

  it("returns every distinct non-null value when nothing is filtered", () => {
    expect(sorted(computeAvailability(ROWS, args()))).toEqual({
      categories: ["LE", "SA"],
      color_codes: ["NAVY", "RED"],
      sizes: ["FREE", "L|40", "M|38"],
      fabric_codes: ["KATAN", "MUL"],
    });
  });

  it("ignores a dimension's own filter and applies the others", () => {
    const r = sorted(computeAvailability(ROWS, args({ p_color_codes: ["RED"] })));
    expect(r.color_codes).toEqual(["NAVY", "RED"]);
    expect(r.categories).toEqual(["LE"]);
    expect(r.fabric_codes).toEqual(["MUL"]);
    expect(r.sizes).toEqual(["M|38"]);
  });

  it("matches colour and size on the same variant", () => {
    const r = computeAvailability(ROWS, args({ p_color_codes: ["RED"], p_sizes: ["L|40"] }));
    expect(r.categories).toEqual([]);
  });

  it("applies price bounds to every dimension", () => {
    const r = sorted(computeAvailability(ROWS, args({ p_price_min: 4000, p_price_max: 6000 })));
    expect(r).toEqual({ categories: ["SA"], color_codes: ["NAVY"], sizes: ["FREE"], fabric_codes: ["KATAN"] });
  });

  it("applies category and fabric filters", () => {
    const r = sorted(computeAvailability(ROWS, args({ p_categories: ["SA"], p_fabric_codes: ["MUL"] })));
    expect(r.categories).toEqual(["LE"]);
    expect(r.fabric_codes).toEqual(["KATAN"]);
    expect(r.color_codes).toEqual([]);
  });
});
