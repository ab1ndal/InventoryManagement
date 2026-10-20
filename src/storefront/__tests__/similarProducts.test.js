import { categoryGroup, rankSimilar } from "../lib/similarProducts";

const CURRENT = { productid: "BC1", categoryid: "LE", retailprice: 10000, fabric: "Silk" };

function product(productid, overrides = {}, variants = [{ stock: 1, color: "Blue" }]) {
  return {
    productid,
    categoryid: "LE",
    retailprice: 10000,
    fabric: "Net",
    productsizecolors: variants,
    ...overrides,
  };
}

describe("categoryGroup", () => {
  it("returns the header collection holding the category", () => {
    expect(categoryGroup("RMS")).toEqual(
      expect.objectContaining({ slug: "suits", categoryIds: ["ST", "RMS"] })
    );
  });

  it("ignores the hand-picked Diwali collection and unknown categories", () => {
    expect(categoryGroup("LE").slug).toBe("lehengas");
    expect(categoryGroup("NOPE")).toBeNull();
  });
});

describe("rankSimilar", () => {
  it("drops the current product and sold-out products", () => {
    const ranked = rankSimilar(CURRENT, [], [
      product("BC1"),
      product("BC2", {}, [{ stock: 0, color: "Red" }]),
      product("BC3"),
    ]);
    expect(ranked.map((p) => p.productid)).toEqual(["BC3"]);
  });

  it("prefers nearby prices over far ones", () => {
    const ranked = rankSimilar(CURRENT, [], [
      product("FAR", { retailprice: 17000 }),
      product("NEAR", { retailprice: 9500 }),
    ]);
    expect(ranked.map((p) => p.productid)).toEqual(["NEAR", "FAR"]);
  });

  it("prefers the same raw category over sibling categories", () => {
    const ranked = rankSimilar({ ...CURRENT, categoryid: "ST" }, [], [
      product("SIB", { categoryid: "RMS" }),
      product("SAME", { categoryid: "ST" }),
    ]);
    expect(ranked.map((p) => p.productid)).toEqual(["SAME", "SIB"]);
  });

  it("rewards a shared colour (case-insensitive) and the same fabric", () => {
    const ranked = rankSimilar(CURRENT, ["Green"], [
      product("PLAIN"),
      product("FABRIC", { fabric: "silk" }),
      product("COLOUR", {}, [{ stock: 1, color: " green " }]),
    ]);
    expect(ranked.map((p) => p.productid)).toEqual(["COLOUR", "FABRIC", "PLAIN"]);
  });

  it("keeps query order on ties and caps the result", () => {
    const candidates = ["A", "B", "C", "D"].map((id) => product(id));
    expect(rankSimilar(CURRENT, [], candidates, 3).map((p) => p.productid)).toEqual(["A", "B", "C"]);
  });
});
