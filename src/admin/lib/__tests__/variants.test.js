import { addVariantStock, VariantInputError } from "../variants";
import { fakeSupabase } from "../testing/fakeSupabase";

const product = { productid: "BC25001", name: "Kurta" };
const existing = { variantid: "v-1", size: "M", color: "Red", stock: 0 };

describe("addVariantStock", () => {
  it("adds stock to the variant that already has this size and colour", async () => {
    const client = fakeSupabase({ "productsizecolors.select": { data: existing, error: null } });
    const out = await addVariantStock(client, { product, size: "M", color: "Red", quantity: 2 });
    expect(out).toEqual({ variantid: "v-1", created: false, stock: 2 });
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
});
