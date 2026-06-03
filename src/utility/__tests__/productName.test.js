import { composeProductName, shouldRecomposeName } from "../productName";

describe("composeProductName", () => {
  it("joins fabric and category with ' - '", () => {
    expect(composeProductName("Silk", "Saree")).toBe("Silk - Saree");
  });

  it("drops empty parts", () => {
    expect(composeProductName("", "Saree")).toBe("Saree");
    expect(composeProductName("Silk", "")).toBe("Silk");
    expect(composeProductName("", "")).toBe("");
  });
});

describe("shouldRecomposeName", () => {
  it("always composes for a new product", () => {
    expect(
      shouldRecomposeName({
        isNewProduct: true,
        fabricChanged: false,
        categoryChanged: false,
      })
    ).toBe(true);
  });

  it("does NOT touch an existing name when nothing changed", () => {
    // The phantom-rename bug: blurring fabric/category on an unrelated edit
    // (e.g. editing variants) must not rewrite the stored name.
    expect(
      shouldRecomposeName({
        isNewProduct: false,
        fabricChanged: false,
        categoryChanged: false,
      })
    ).toBe(false);
  });

  it("recomposes an existing name when fabric changes", () => {
    expect(
      shouldRecomposeName({
        isNewProduct: false,
        fabricChanged: true,
        categoryChanged: false,
      })
    ).toBe(true);
  });

  it("recomposes an existing name when category changes", () => {
    expect(
      shouldRecomposeName({
        isNewProduct: false,
        fabricChanged: false,
        categoryChanged: true,
      })
    ).toBe(true);
  });
});
