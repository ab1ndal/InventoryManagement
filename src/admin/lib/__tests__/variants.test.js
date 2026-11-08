import { addStockByCode, addVariantStock, VariantInputError } from "../variants";
import { fakeSupabase } from "../testing/fakeSupabase";

const product = { productid: "BC25001", name: "Kurta" };
const existing = { variantid: "v-1", size: "M", color: "Red", stock: 0 };

describe("addVariantStock", () => {
  it("adds stock to the variant that already has this size and colour", async () => {
    const client = fakeSupabase({ "productsizecolors.select": { data: existing, error: null } });
    const out = await addVariantStock(client, { product, size: "M", color: "Red", quantity: 2 });
    expect(out).toEqual({ variantid: "v-1", created: false, stock_before: 0, stock: 2 });
    expect(client.calls[0].filters).toEqual([
      ["eq", "productid", "BC25001"],
      ["eq", "size", "M"],
      ["eq", "color", "Red"],
    ]);
    expect(client.calls[1]).toMatchObject({
      op: "rpc",
      fn: "stock_adjust",
      args: { p_variant: "v-1", p_delta: 2, p_reason: "manual_edit", p_ref: "BC25001" },
    });
    expect(client.calls[2].row.summary).toBe(
      "Increased stock of Red / M, product BC25001 — Kurta: 0 → 2 (+2) (from billing)",
    );
  });

  it("creates the variant when the product has no such size and colour", async () => {
    const client = fakeSupabase({
      "productsizecolors.select": { data: null, error: null },
      "productsizecolors.insert": (call) => ({ data: call.row, error: null }),
    });
    const out = await addVariantStock(client, { product, size: "XL", color: "Blue", quantity: 1 });
    expect(out).toMatchObject({ created: true, stock: 1 });
    expect(client.calls[1].row).toEqual({
      variantid: out.variantid,
      productid: "BC25001",
      size: "XL",
      color: "Blue",
      stock: 1,
    });
    expect(client.calls[2].row.summary).toBe(
      "Added variant Blue / XL to product BC25001 — Kurta (stock 1) (from billing)",
    );
  });

  it("keeps metre stock to three decimals", async () => {
    const client = fakeSupabase({ "productsizecolors.select": { data: { ...existing, stock: 1.5 }, error: null } });
    const out = await addVariantStock(client, { product: { ...product, unit_type: "meter" }, size: "M", color: "Red", quantity: "2.25" });
    expect(out.stock).toBe(3.75);
    expect(client.calls[1].args.p_delta).toBe(2.25);
  });

  it.each([
    [{ size: "", color: "Red", quantity: 1 }, /size/],
    [{ size: "M", color: "", quantity: 1 }, /colour/],
    [{ size: "M", color: "Red", quantity: 0 }, /more than 0/],
    [{ size: "M", color: "Red", quantity: "abc" }, /more than 0/],
  ])("refuses %o before writing", async (input, message) => {
    const client = fakeSupabase();
    await expect(addVariantStock(client, { product, ...input })).rejects.toThrow(message);
    await expect(addVariantStock(client, { product, ...input })).rejects.toThrow(VariantInputError);
    expect(client.calls).toEqual([]);
  });

  it("refuses part pieces for a piece product", async () => {
    const client = fakeSupabase();
    await expect(
      addVariantStock(client, { product: { ...product, unit_type: "piece" }, size: "M", color: "Red", quantity: 1.5 }),
    ).rejects.toThrow(/whole number/);
  });

  it("passes on a failed stock change", async () => {
    const client = fakeSupabase({
      "productsizecolors.select": { data: existing, error: null },
      "rpc.stock_adjust": { data: null, error: { message: "permission denied" } },
    });
    await expect(addVariantStock(client, { product, size: "M", color: "Red", quantity: 1 })).rejects.toThrow(
      "permission denied",
    );
  });

  it("dry run looks up the variant and writes nothing", async () => {
    const client = fakeSupabase({ "productsizecolors.select": { data: { ...existing, stock: 1 }, error: null } });
    const out = await addVariantStock(client, { product, size: "M", color: "Red", quantity: 2 }, { dryRun: true });
    expect(out).toEqual({ dry_run: true, variantid: "v-1", created: false, stock_before: 1, stock: 3 });
    expect(client.calls.map((c) => c.op)).toEqual(["select"]);
  });

  it("ends the activity summary with the given source", async () => {
    const client = fakeSupabase({ "productsizecolors.select": { data: existing, error: null } });
    await addVariantStock(client, { product, size: "M", color: "Red", quantity: 1 }, { source: "via CLI" });
    expect(client.calls[2].row.summary).toMatch(/\(via CLI\)$/);
  });
});

describe("addStockByCode", () => {
  const shirt = { productid: "BC25385", name: "Cotton Self-Shirt", categoryid: "SHT", purchaseprice: 567, unit_type: "piece" };
  const xl = { variantid: "v-xl", productid: "BC25385", size: "XL|42", color: "Pink", stock: 0 };
  // findProducts lists variants with .in(); addVariantStock looks one up with .eq().
  const client = ({ products = [shirt], lookup = xl, sizes = [{ code: "3XL|46" }], colors = [{ code: "Pink" }] } = {}) =>
    fakeSupabase({
      "products_admin.select": { data: products, error: null },
      "productsizecolors.select": (call) =>
        call.filters[0][0] === "in" ? { data: [xl], error: null } : { data: lookup, error: null },
      "productsizecolors.insert": (call) => ({ data: call.row, error: null }),
      "sizes.select": { data: sizes, error: null },
      "colors.select": { data: colors, error: null },
    });

  it("adds stock to the existing variant, matching size and colour ignoring case", async () => {
    const c = client();
    const out = await addStockByCode(c, { code: "bc-25385", size: "xl|42", color: " pink ", quantity: "1" });
    expect(out).toMatchObject({ productid: "BC25385", size: "XL|42", color: "Pink", created: false, stock: 1 });
    const lookup = c.calls.find((x) => x.table === "productsizecolors" && x.filters[0][0] === "eq");
    expect(lookup.filters).toEqual([
      ["eq", "productid", "BC25385"],
      ["eq", "size", "XL|42"],
      ["eq", "color", "Pink"],
    ]);
    expect(c.calls.find((x) => x.op === "rpc")).toMatchObject({ fn: "stock_adjust", args: { p_variant: "v-xl", p_delta: 1 } });
    expect(c.calls.at(-1).row.summary).toMatch(/\(via CLI\)$/);
  });

  it("refuses a size and colour the product doesn't have without allowNewVariant", async () => {
    const c = client();
    await expect(addStockByCode(c, { code: "BC25385", size: "XL|42", color: "Mustard", quantity: 1 })).rejects.toThrow(
      "BC25385 has no Mustard / XL|42 variant (has: Pink / XL|42). Pass --new-variant to add it",
    );
    expect(c.calls.some((x) => x.op !== "select")).toBe(false);
  });

  it("creates a new variant from the inventory's size and colour lists", async () => {
    const c = client({ lookup: null });
    const out = await addStockByCode(c, { code: "BC25385", size: "3xl|46", color: "pink", quantity: 1, allowNewVariant: true });
    expect(out).toMatchObject({ size: "3XL|46", color: "Pink", created: true, stock: 1 });
    expect(c.calls.find((x) => x.op === "insert" && x.table === "productsizecolors").row).toMatchObject({
      productid: "BC25385",
      size: "3XL|46",
      color: "Pink",
      stock: 1,
    });
  });

  it.each([
    [{ size: "46", color: "Pink" }, 'Unknown size "46"'],
    [{ size: "3XL|46", color: "Pinkish" }, 'Unknown colour "Pinkish"'],
  ])("refuses a new variant with %o", async (input, message) => {
    const c = client({ lookup: null });
    await expect(
      addStockByCode(c, { code: "BC25385", quantity: 1, allowNewVariant: true, ...input }),
    ).rejects.toThrow(message);
    expect(c.calls.some((x) => x.op !== "select")).toBe(false);
  });

  it("needs the exact product code", async () => {
    const c = client({ products: [] });
    await expect(addStockByCode(c, { code: "BC2538", size: "XL|42", color: "Pink", quantity: 1 })).rejects.toThrow(
      "No product BC2538",
    );
  });

  it("dry run writes nothing", async () => {
    const c = client();
    const out = await addStockByCode(c, { code: "BC25385", size: "XL|42", color: "Pink", quantity: 2 }, { dryRun: true });
    expect(out).toMatchObject({ dry_run: true, variantid: "v-xl", stock_before: 0, stock: 2 });
    expect(c.calls.some((x) => x.op !== "select")).toBe(false);
  });
});
