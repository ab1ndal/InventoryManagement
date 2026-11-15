import { normalizeProductCode, findProducts, listCategories, searchProducts, nearProducts, editDistance, ProductInputError } from "../products";
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
      "products_admin.select": { data: [saree], error: null },
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
    expect(client.calls.filter((c) => c.table === "products_admin")).toHaveLength(1);
  });

  it("falls back to a partial match when there is no exact one", async () => {
    let n = 0;
    const client = fakeSupabase({
      "products_admin.select": () => (n++ === 0 ? { data: [], error: null } : { data: [saree], error: null }),
      "productsizecolors.select": { data: [], error: null },
      "categories.select": { data: [], error: null },
    });
    const out = await findProducts(client, "252051");
    expect(out.map((p) => p.productid)).toEqual(["BC252051"]);
    expect(client.calls[1].filters).toContainEqual(["ilike", "productid", "%252051%"]);
  });

  it("returns [] when nothing matches", async () => {
    const client = fakeSupabase({ "products_admin.select": { data: [], error: null } });
    await expect(findProducts(client, "ZZZ999")).resolves.toEqual([]);
  });

  it("rejects an empty code", async () => {
    await expect(findProducts(fakeSupabase(), " - ")).rejects.toThrow(/code is required/);
  });

  it("propagates a database error", async () => {
    const client = fakeSupabase({ "products_admin.select": { data: null, error: new Error("boom") } });
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
      "products_admin.select": { data: rows, error: null },
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

  it("with near, puts the codes closest to the written one first", async () => {
    const c = fakeSupabase({
      "products_admin.select": {
        data: [
          { ...saree, productid: "BC251111" },
          { ...saree, productid: "BC253249" },
          { ...saree, productid: "BC25324" },
          { ...saree, productid: "BC253148" },
        ],
        error: null,
      },
      "productsizecolors.select": { data: [], error: null },
      "categories.select": { data: [], error: null },
    });
    const out = await searchProducts(c, { categoryid: "SA", mrp: "2195", near: "bc-253248" });
    expect(out.map((p) => [p.productid, p.code_distance])).toEqual([
      ["BC253148", 1],
      ["BC25324", 1],
      ["BC253249", 1],
      ["BC251111", 4],
    ]);
  });

  it("without near, keeps product order and adds no distance", async () => {
    const out = await searchProducts(client(), { categoryid: "SA" });
    expect(out.map((p) => p.productid)).toEqual(["BC1", "BC2"]);
    expect(out[0]).not.toHaveProperty("code_distance");
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

describe("nearProducts", () => {
  const product = (productid, retailprice) => ({ ...saree, productid, retailprice: String(retailprice) });
  const client = (rows, variants) =>
    fakeSupabase({
      "products_admin.select": { data: rows, error: null },
      "productsizecolors.select": { data: variants, error: null },
      "categories.select": { data: [{ categoryid: "SA", name: "Saree" }], error: null },
    });

  it("asks for every one-digit-off code of the written one", async () => {
    const c = client([], []);
    await nearProducts(c, { code: "bc-25 134" });
    const [, , ids] = c.calls[0].filters[0];
    expect(ids[0]).toBe("BC25134");
    expect(ids).toHaveLength(1 + 5 * 9);
    expect(ids).toContain("BC25154");
    expect(ids).toContain("BC35134");
  });

  it("keeps near codes at the slip's MRP and colour, look-alike digits first", async () => {
    const rows = [
      product("BC253248", 2995),
      product("BC253249", 2195), // 8→9: not a look-alike pair
      product("BC253268", 2195), // 4→6
      product("BC253246", 2195), // 8→6: look-alike
      product("BC253148", 1795), // wrong MRP
    ];
    const variants = [
      { variantid: "w", productid: "BC253248", size: "FREE-SIZE", color: "Maroon", stock: 1 },
      { variantid: "a", productid: "BC253249", size: "FREE-SIZE", color: "Fawn", stock: 1 },
      { variantid: "b", productid: "BC253268", size: "FREE-SIZE", color: "Black", stock: 2 },
      { variantid: "c", productid: "BC253246", size: "FREE-SIZE", color: "Light Fawn", stock: 0 },
      { variantid: "d", productid: "BC253148", size: "FREE-SIZE", color: "Fawn", stock: 1 },
    ];
    const out = await nearProducts(client(rows, variants), { code: "BC253248", mrp: "2195", color: "fawn" });
    expect(out.written.productid).toBe("BC253248");
    expect(out.written_matches).toEqual({ mrp: false, color: false });
    expect(out.near.map((p) => [p.productid, p.changed, p.lookalike])).toEqual([
      ["BC253246", "8→6 at digit 8", true],
      ["BC253249", "8→9 at digit 8", false],
    ]);
    expect(out.near[1].variants).toEqual([{ variantid: "a", size: "FREE-SIZE", color: "Fawn", stock: 1 }]);
  });

  it("with in-stock, drops near codes whose matching variants are all sold", async () => {
    const rows = [product("BC253249", 2195), product("BC253246", 2195)];
    const variants = [
      { variantid: "a", productid: "BC253249", size: "M", color: "Fawn", stock: 1 },
      { variantid: "c", productid: "BC253246", size: "M", color: "Fawn", stock: 0 },
    ];
    const out = await nearProducts(client(rows, variants), { code: "BC253248", color: "fawn", inStock: true });
    expect(out.written).toBeNull();
    expect(out.written_matches).toBeNull();
    expect(out.near.map((p) => p.productid)).toEqual(["BC253249"]);
  });

  it("without filters lists every existing near code, in-stock ones first after look-alikes", async () => {
    const rows = [product("BC25135", 999), product("BC25139", 999)];
    const variants = [
      { variantid: "a", productid: "BC25135", size: "M", color: "Red", stock: 0 },
      { variantid: "b", productid: "BC25139", size: "M", color: "Red", stock: 3 },
    ];
    const out = await nearProducts(client(rows, variants), { code: "BC25134" });
    // 4→9 is a look-alike, 4→5 is not.
    expect(out.near.map((p) => p.productid)).toEqual(["BC25139", "BC25135"]);
    expect(out.written_matches).toBeNull();
  });

  it.each([
    [{ code: "" }, /must be letters then digits/],
    [{ code: "BC25-ABC" }, /must be letters then digits/],
    [{ code: "BC25134", mrp: "abc" }, /Invalid MRP/],
  ])("rejects bad input %#", async (input, msg) => {
    await expect(nearProducts(client([], []), input)).rejects.toThrow(msg);
  });
});

describe("editDistance", () => {
  it.each([
    ["BC253248", "BC253248", 0],
    ["BC253248", "BC253249", 1],
    ["BC251868", "BC257868", 1],
    ["BC25134", "BC251134", 1],
    ["BC253248", "BC235248", 2],
  ])("%s → %s is %d", (a, b, d) => {
    expect(editDistance(a, b)).toBe(d);
  });
});
