import { COLLECTIONS, getCollection } from "../lib/collections";

describe("collections config", () => {
  it("returns the matching collection for a known slug", () => {
    expect(getCollection("sarees")).toEqual(
      expect.objectContaining({ slug: "sarees", title: "Sarees" })
    );
  });

  it("hides the uncurated Wedding and Festive collections", () => {
    expect(getCollection("wedding")).toBeNull();
    expect(getCollection("festive")).toBeNull();
  });

  it("has a Diwali collection driven by an explicit, duplicate-free product list", () => {
    const diwali = getCollection("diwali");
    expect(diwali).toEqual(expect.objectContaining({ slug: "diwali", title: "Diwali Glam" }));
    expect(diwali.productIds.length).toBeGreaterThan(0);
    expect(new Set(diwali.productIds).size).toBe(diwali.productIds.length);
    diwali.productIds.forEach((id) => expect(id).toMatch(/^BC\d+$/));
    // Product-list collections are filtered and ordered client-side.
    const { MAX_SCOPED_PRODUCT_IDS } = require("../hooks/useShopFilters");
    expect(diwali.productIds.length).toBeLessThanOrEqual(MAX_SCOPED_PRODUCT_IDS);
  });

  it("backs every header category link with a category collection", () => {
    const { NAV_LINKS } = require("../lib/siteConfig");
    NAV_LINKS.filter((l) => l.to.startsWith("/collections/")).forEach((link) => {
      const collection = getCollection(link.to.replace("/collections/", ""));
      expect(collection).not.toBeNull();
      expect((collection.productIds || collection.categoryIds).length).toBeGreaterThan(0);
    });
    const categoryLinks = NAV_LINKS.filter((l) => !["Diwali Glam", "Custom Tailoring", "Shop All"].includes(l.label));
    categoryLinks.forEach((l) => expect(l.to).toMatch(/^\/collections\//));
  });

  it("backs every home page category rail with a non-empty category collection", () => {
    ["sarees", "lehengas", "kurtis", "everyday", "sherwani", "kurta-pajama"].forEach((slug) => {
      const collection = getCollection(slug);
      expect(collection).not.toBeNull();
      expect(collection.productIds).toBeUndefined();
      expect(collection.categoryIds.length).toBeGreaterThan(0);
    });
    expect(getCollection("everyday").categoryIds).toEqual(
      expect.arrayContaining(["CRD", "SHT", "KUR"])
    );
    expect(getCollection("sherwani").categoryIds).toEqual(["SW"]);
    expect(getCollection("kurta-pajama").categoryIds).toEqual(["KP"]);
  });

  it("keeps Kurtis and Men as the similar-products group for categories Everyday shares", () => {
    const { categoryGroup } = require("../lib/similarProducts");
    expect(categoryGroup("KUR").slug).toBe("kurtis");
    expect(categoryGroup("SHT").slug).toBe("men");
    expect(categoryGroup("SW").slug).toBe("men");
    expect(categoryGroup("KP").slug).toBe("men");
  });

  it("has unique slugs", () => {
    const slugs = COLLECTIONS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
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

  describe("intro text", () => {
    const words = (text) => text.trim().split(/\s+/).length;
    const withIntro = COLLECTIONS.filter((c) => c.slug !== "diwali");
    const allText = (c) => [c.intro.lead, ...c.intro.more];

    it("every collection except the Diwali campaign has an intro of 60 to 120 words", () => {
      expect(COLLECTIONS.find((c) => c.slug === "diwali").intro).toBeUndefined();
      withIntro.forEach((c) => {
        expect(c.intro).toBeDefined();
        const total = words(allText(c).join(" "));
        expect(total).toBeGreaterThanOrEqual(60);
        expect(total).toBeLessThanOrEqual(120);
        expect(words(c.intro.lead)).toBeLessThanOrEqual(25);
      });
    });

    it("no two collections share a sentence", () => {
      const sentences = withIntro.flatMap((c) => allText(c).join(" ").split(/(?<=\.)\s+/));
      expect(new Set(sentences).size).toBe(sentences.length);
    });

    it("avoids words the owner has ruled out, prices and a delivery area", () => {
      withIntro.forEach((c) => {
        expect(allText(c).join(" ")).not.toMatch(
          /\bexact|true colou?r|guarantee|\bbest\b|popular|award|₹|\bRs\b|deliver|ship|all india|pan.india|real photo|\bAI\b/i
        );
      });
    });
  });
});
