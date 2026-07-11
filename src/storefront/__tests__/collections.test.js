import { COLLECTIONS, getCollection } from "../lib/collections";

describe("collections config", () => {
  it("returns the matching collection for a known slug", () => {
    const wedding = getCollection("wedding");
    expect(wedding).toEqual(
      expect.objectContaining({ slug: "wedding", title: "Wedding" })
    );
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
