import { buildAvailabilityArgs, mapAvailability } from "./shopAvailability";

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
