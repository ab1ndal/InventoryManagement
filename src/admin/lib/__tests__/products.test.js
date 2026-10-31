import { normalizeProductCode, findProducts, listCategories, searchProducts, ProductInputError } from "../products";
import { fakeSupabase } from "../testing/fakeSupabase";

const saree = {
  productid: "BC252051",
  name: "Georgette-Saree",
  categoryid: "SA",
  fabric: "Georgette",
  purchaseprice: "1172.00",
  retailprice: "2395.00",
  unit_type: "piece",
};

describe("normalizeProductCode", () => {
  it("uppercases and strips dashes and spaces", () => {
    expect(normalizeProductCode(" bc-25 2051 ")).toBe("BC252051");
  });
});

describe("findProducts", () => {
  it("returns the exact match with category, cost Z-code and sorted variants", async () => {
    const client = fakeSupabase({
      "products.select": { data: [saree], error: null },
      "productsizecolors.select": {
        data: [
          { variantid: "v2", productid: "BC252051", size: "L", color: "Red", stock: 0 },
          { variantid: "v1", productid: "BC252051", size: "S", color: "Red", stock: 2 },
        ],
        error: null,
      },
      "categories.select": { data: [{ categoryid: "SA", name: "Saree" }], error: null },
    });
    const [p] = await findProducts(client, "BC-252051");
    expect(p).toMatchObject({ productid: "BC252051", category_name: "Saree", cost_zcode: "ZAAGB" });
    expect(p.variants).toEqual([
      { variantid: "v1", size: "S", color: "Red", stock: 2 },
      { variantid: "v2", size: "L", color: "Red", stock: 0 },
    ]);
    // exact hit: no partial search
    expect(client.calls.filter((c) => c.table === "products")).toHaveLength(1);
  });

  it("falls back to a partial match when there is no exact one", async () => {
    let n = 0;
    const client = fakeSupabase({
      "products.select": () => (n++ === 0 ? { data: [], error: null } : { data: [saree], error: null }),
      "productsizecolors.select": { data: [], error: null },
      "categories.select": { data: [], error: null },
    });
    const out = await findProducts(client, "252051");
    expect(out.map((p) => p.productid)).toEqual(["BC252051"]);
    expect(client.calls[1].filters).toContainEqual(["ilike", "productid", "%252051%"]);
  });

  it("returns [] when nothing matches", async () => {
    const client = fakeSupabase({ "products.select": { data: [], error: null } });
    await expect(findProducts(client, "ZZZ999")).resolves.toEqual([]);
  });

  it("rejects an empty code", async () => {
    await expect(findProducts(fakeSupabase(), " - ")).rejects.toThrow(/code is required/);
  });

  it("propagates a database error", async () => {
    const client = fakeSupabase({ "products.select": { data: null, error: new Error("boom") } });
    await expect(findProducts(client, "BC1")).rejects.toThrow("boom");
  });
});

describe("listCategories", () => {
  it("returns id + name rows", async () => {
    const rows = [{ categoryid: "SA", name: "Saree" }];
    const client = fakeSupabase({ "categories.select": { data: rows, error: null } });
    await expect(listCategories(client)).resolves.toEqual(rows);
  });
});

describe("searchProducts", () => {
  const rows = [
    { ...saree, productid: "BC1", purchaseprice: "2516.00" },
    { ...saree, productid: "BC2", purchaseprice: "2516.00" },
  ];
  const variants = [
    { variantid: "a", productid: "BC1", size: "FREE-SIZE", color: "Mustard", stock: 0 },
    { variantid: "b", productid: "BC2", size: "FREE-SIZE", color: "Yellow", stock: 1 },
  ];
  const client = () =>
    fakeSupabase({
      "products.select": { data: rows, error: null },
      "productsizecolors.select": { data: variants, error: null },
      "categories.select": { data: [{ categoryid: "SA", name: "Saree" }], error: null },
    });

  it("decodes a cost Z-code and filters by category and MRP", async () => {
    const c = client();
    const out = await searchProducts(c, { categoryid: "SA", cost: "ZBEAF", mrp: "5395" });
    expect(out.map((p) => p.productid)).toEqual(["BC1", "BC2"]);
    expect(c.calls[0].filters).toEqual([
      ["eq", "categoryid", "SA"],
      ["eq", "purchaseprice", 2516],
      ["eq", "retailprice", 5395],
    ]);
  });

  it("keeps only matching variants and drops products left with none", async () => {
    const out = await searchProducts(client(), { cost: "ZBEAF", color: "yell", inStock: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ productid: "BC2", variants: [{ variantid: "b" }] });
  });

  it.each([
    [{}, /at least one of name, category, cost or MRP/],
    [{ color: "red" }, /at least one of/],
    [{ cost: "ZZ" }, /Invalid cost "ZZ"/],
    [{ mrp: "abc" }, /Invalid MRP/],
  ])("rejects bad filters %#", async (f, msg) => {
    await expect(searchProducts(client(), f)).rejects.toThrow(ProductInputError);
    await expect(searchProducts(client(), f)).rejects.toThrow(msg);
  });
});
