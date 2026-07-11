import { mergeCarts, revalidateItems } from "../lib/cartLogic";

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
