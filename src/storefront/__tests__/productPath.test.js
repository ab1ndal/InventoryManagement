import {
  productSlug,
  productPath,
  parseProductParam,
  PUBLIC_ID_RE,
  LEGACY_CODE_RE,
} from "../lib/productPath";

describe("productSlug", () => {
  it("keeps the title up to the word 'with'", () => {
    expect(
      productSlug(
        "Off White Metti Cotton 5 Piece Suit with Contrast Piping and Double-Breasted Waistcoat"
      )
    ).toBe("off-white-metti-cotton-5-piece-suit");
    expect(
      productSlug(
        "Navy Blue Cotton Readymade Suit with Embroidered Neckline, Palazzo and Tie-Dye Dupatta"
      )
    ).toBe("navy-blue-cotton-readymade-suit");
  });

  it("slugs a plain title", () => {
    expect(productSlug("Cotton Saree")).toBe("cotton-saree");
  });

  it("spells out & and drops apostrophes", () => {
    expect(productSlug("Black & Gold Silk Saree")).toBe("black-and-gold-silk-saree");
    expect(productSlug("Men's Kurta WITH Jacket")).toBe("mens-kurta");
    expect(productSlug("Men’s Kurta")).toBe("mens-kurta");
  });

  it("splits only on the standalone word 'with'", () => {
    expect(productSlug("Withered Rose Georgette Saree")).toBe("withered-rose-georgette-saree");
    expect(productSlug("Without Dupatta Cotton Suit")).toBe("without-dupatta-cotton-suit");
    expect(productSlug("With Love Printed Kurta")).toBe("");
  });

  it("cuts a long title at a whole word within 50 characters", () => {
    const title = "Rani Pink Banarasi Silk Saree Zari Border Woven Pallu Tassels Blouse Pc";
    expect(title.length).toBeGreaterThanOrEqual(70);
    const slug = productSlug(title);
    expect(slug).toBe("rani-pink-banarasi-silk-saree-zari-border-woven");
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("cuts a single word longer than 50 characters at 50", () => {
    expect(productSlug("a".repeat(60))).toBe("a".repeat(50));
  });

  it("returns an empty string for a missing or blank title", () => {
    expect(productSlug(null)).toBe("");
    expect(productSlug("")).toBe("");
  });
});

describe("productPath", () => {
  it("joins the slug and the public id", () => {
    expect(productPath({ public_id: "k7x2m", name: "Cotton Saree" })).toBe(
      "/product/cotton-saree-k7x2m"
    );
  });

  it("uses the id alone when the slug is empty", () => {
    expect(productPath({ public_id: "k7x2m", name: "" })).toBe("/product/k7x2m");
    expect(productPath({ public_id: "k7x2m", name: null })).toBe("/product/k7x2m");
  });

  it("throws when the public id is missing", () => {
    expect(() => productPath({ name: "Cotton Saree" })).toThrow(
      "productPath: missing public_id"
    );
  });
});

describe("parseProductParam", () => {
  it("reads the id from the last segment", () => {
    expect(parseProductParam("cotton-saree-k7x2m")).toEqual({
      kind: "id",
      publicId: "k7x2m",
      slug: "cotton-saree",
    });
  });

  it("lower-cases an upper-case id", () => {
    expect(parseProductParam("K7X2M")).toEqual({ kind: "id", publicId: "k7x2m", slug: "" });
    expect(parseProductParam("Cotton-Saree-K7X2M")).toEqual({
      kind: "id",
      publicId: "k7x2m",
      slug: "cotton-saree",
    });
  });

  it("marks old BC codes as legacy", () => {
    expect(parseProductParam("BC253135")).toEqual({ kind: "legacy" });
    expect(parseProductParam("bc25001")).toEqual({ kind: "legacy" });
  });

  it("rejects anything else", () => {
    expect(parseProductParam("bc2501")).toEqual({ kind: "invalid" });
    expect(parseProductParam("cotton-saree-k7x0m")).toEqual({ kind: "invalid" });
    expect(parseProductParam("")).toEqual({ kind: "invalid" });
  });
});

describe("patterns", () => {
  it("cannot match each other", () => {
    expect(PUBLIC_ID_RE.test("k7x2m")).toBe(true);
    expect(LEGACY_CODE_RE.test("k7x2m")).toBe(false);
    expect(PUBLIC_ID_RE.test("bc25001")).toBe(false);
  });
});
