import { HERO_SLIDES } from "../lib/heroSlides";

describe("hero slides config", () => {
  it("has 3 to 6 slides with unique ids", () => {
    expect(HERO_SLIDES.length).toBeGreaterThanOrEqual(3);
    expect(HERO_SLIDES.length).toBeLessThanOrEqual(6);
    const ids = HERO_SLIDES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts custom tailoring second, right after Diwali", () => {
    expect(HERO_SLIDES.slice(0, 2).map((s) => s.id)).toEqual(["diwali", "customize"]);
    expect(HERO_SLIDES[1].href).toBe("/customize");
  });

  it("gives every slide copy, a CTA and an in-site link", () => {
    HERO_SLIDES.forEach((s) => {
      expect(s.headline).toEqual(expect.any(String));
      expect(s.subline).toEqual(expect.any(String));
      expect(s.cta).toEqual(expect.any(String));
      expect(s.href).toMatch(/^\//);
    });
  });

  it("gives every slide at least one image, each a productid or a url", () => {
    HERO_SLIDES.forEach((s) => {
      expect(s.images.length).toBeGreaterThan(0);
      s.images.forEach((img) => {
        const hasOne = Boolean(img.productid) !== Boolean(img.url);
        expect(hasOne).toBe(true);
      });
    });
  });

  it("points every static image at a file in /public", () => {
    const fs = require("fs");
    const path = require("path");
    HERO_SLIDES.flatMap((s) => s.images)
      .flatMap((img) => [img.url, img.mobileUrl])
      .filter(Boolean)
      .forEach((url) => {
        expect(fs.existsSync(path.join(__dirname, "../../../public", url))).toBe(true);
      });
  });

  it("links the plus-size slide to the 3XL-and-up collection", () => {
    const { getCollection } = require("../lib/collections");
    const slide = HERO_SLIDES.find((s) => s.id === "plus-size");
    expect(slide.href).toBe("/collections/plus-size");
    expect(getCollection("plus-size").sizes).toEqual(["3XL|46", "4XL|48", "5XL|50", "6XL|52", "7XL|54", "8XL|56", "9XL|58", "10XL|60"]);
  });

  it("leads with the Diwali Glam", () => {
    expect(HERO_SLIDES[0].href).toBe("/collections/diwali");
  });

  it("never says crafted or handcrafted", () => {
    const copy = HERO_SLIDES.map((s) => [s.headline, s.subline, s.cta].join(" ")).join(" ");
    expect(copy).not.toMatch(/crafted/i);
  });
});
