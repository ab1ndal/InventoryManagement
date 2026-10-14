import { COLLECTIONS, getCollection } from "../lib/collections";

describe("collections config", () => {
  it("returns the matching collection for a known slug", () => {
    const wedding = getCollection("wedding");
    expect(wedding).toEqual(
      expect.objectContaining({ slug: "wedding", title: "Wedding" })
    );
  });

  it("has a Diwali collection driven by an explicit, duplicate-free product list", () => {
    const diwali = getCollection("diwali");
    expect(diwali).toEqual(expect.objectContaining({ slug: "diwali", title: "Diwali Edit" }));
    expect(diwali.productIds.length).toBeGreaterThan(0);
    expect(new Set(diwali.productIds).size).toBe(diwali.productIds.length);
    diwali.productIds.forEach((id) => expect(id).toMatch(/^BC\d+$/));
  });

  it("returns null for an unknown slug", () => {
    expect(getCollection("nope")).toBeNull();
  });

  it("every collection has a slug and a title", () => {
    expect(COLLECTIONS.length).toBeGreaterThan(0);
    COLLECTIONS.forEach((c) => {
      expect(typeof c.slug).toBe("string");
      expect(c.slug.length).toBeGreaterThan(0);
      expect(typeof c.title).toBe("string");
      expect(c.title.length).toBeGreaterThan(0);
    });
  });
});
