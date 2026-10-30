import { mergeCarts, revalidateItems, addToItems, maxQuantity, applyHoldResults } from "../lib/cartLogic";

const item = (variant_id, quantity, extra = {}) => ({
  variant_id, product_id: "BC1", quantity, name: "Saree",
  size: "FREE", color: "Red", price: 1000, image_url: null, ...extra,
});

describe("mergeCarts", () => {
  it("unions distinct variants", () => {
    const merged = mergeCarts([item("a", 1)], [item("b", 2)]);
    expect(merged.map((i) => i.variant_id).sort()).toEqual(["a", "b"]);
  });
  it("takes the max quantity for a variant present in both (no double-count)", () => {
    const merged = mergeCarts([item("a", 2)], [item("a", 2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });
  it("keeps the higher of differing quantities", () => {
    expect(mergeCarts([item("a", 5)], [item("a", 1)])[0].quantity).toBe(5);
  });
});

describe("revalidateItems", () => {
  it("drops variants missing from live data", () => {
    const { items, changes } = revalidateItems([item("a", 1)], {});
    expect(items).toHaveLength(0);
    expect(changes).toEqual([{ variant_id: "a", name: "Saree", type: "removed" }]);
  });
  it("caps quantity to live stock", () => {
    const { items, changes } = revalidateItems([item("a", 5)], { a: { stock: 2, price: 1000 } });
    expect(items[0].quantity).toBe(2);
    expect(changes).toContainEqual({ variant_id: "a", name: "Saree", type: "capped" });
  });
  it("removes items whose live stock is 0", () => {
    const { items } = revalidateItems([item("a", 1)], { a: { stock: 0, price: 1000 } });
    expect(items).toHaveLength(0);
  });
  it("updates and flags a changed price", () => {
    const { items, changes } = revalidateItems([item("a", 1)], { a: { stock: 9, price: 1200 } });
    expect(items[0].price).toBe(1200);
    expect(changes).toContainEqual({ variant_id: "a", name: "Saree", type: "repriced" });
  });
});

describe("addToItems", () => {
  it("adds a new variant up to its stock", () => {
    const { items, added } = addToItems([], item("a", 3, { stock: 2 }));
    expect(added).toBe(2);
    expect(items[0].quantity).toBe(2);
  });
  it("adds nothing once the cart holds all the stock", () => {
    const start = [item("a", 1, { stock: 1 })];
    const { items, added } = addToItems(start, item("a", 1, { stock: 1 }));
    expect(added).toBe(0);
    expect(items).toBe(start);
  });
  it("tops an existing line up to the latest known stock", () => {
    const { items, added } = addToItems([item("a", 1)], item("a", 5, { stock: 3 }));
    expect(added).toBe(2);
    expect(items[0]).toMatchObject({ quantity: 3, stock: 3 });
  });
  it("is unbounded when stock is unknown", () => {
    expect(addToItems([item("a", 4)], item("a", 2)).added).toBe(2);
    expect(maxQuantity(item("a", 1))).toBe(Infinity);
  });
});

describe("revalidateItems stock", () => {
  it("records the live stock on each kept item", () => {
    const { items } = revalidateItems([item("a", 1)], { a: { stock: 4, price: 1000 } });
    expect(items[0].stock).toBe(4);
  });
});

describe("applyHoldResults", () => {
  const hold = (variantId, available, reason = null) => ({ variantId, requested: 0, held: 0, available, reason });
  const res = (items, extra = {}) => ({ rateLimited: false, items, expiresAt: null, ...extra });

  it("cuts a line back to what other shoppers' holds leave", () => {
    const { items, capped } = applyHoldResults([item("v1", 3), item("v2", 1)], res([hold("v1", 2), hold("v2", 1)]));
    expect(items).toEqual([item("v1", 2, { stock: 2 }), item("v2", 1)]);
    expect(capped).toEqual([{ variant_id: "v1", product_id: "BC1", name: "Saree", quantity: 2 }]);
  });

  it("removes a line when nothing is left for this shopper", () => {
    const { items, capped } = applyHoldResults([item("v1", 1)], res([hold("v1", 0, "unavailable")]));
    expect(items).toEqual([]);
    expect(capped).toEqual([{ variant_id: "v1", product_id: "BC1", name: "Saree", quantity: 0 }]);
  });

  it("leaves the cart alone on anti-hoarding caps when the units are still free", () => {
    const cart = [item("v1", 3), item("v2", 2)];
    const { items, capped } = applyHoldResults(cart, res([hold("v1", 3, "holder_cap"), hold("v2", 5, "ip_cap")]));
    expect(items).toBe(cart);
    expect(capped).toEqual([]);
  });

  it("ignores a rate-limited response", () => {
    const cart = [item("v1", 3)];
    const { items, capped } = applyHoldResults(cart, res([hold("v1", 0)], { rateLimited: true }));
    expect(items).toBe(cart);
    expect(capped).toEqual([]);
  });

  it("ignores results for variants no longer in the cart", () => {
    const cart = [item("v1", 1)];
    expect(applyHoldResults(cart, res([hold("v9", 0)])).items).toBe(cart);
  });
});
