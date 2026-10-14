import { HERO_SLIDES } from "../lib/heroSlides";

describe("hero slides config", () => {
  it("has 3 to 4 slides with unique ids", () => {
    expect(HERO_SLIDES.length).toBeGreaterThanOrEqual(3);
    expect(HERO_SLIDES.length).toBeLessThanOrEqual(4);
    const ids = HERO_SLIDES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("leads with the Diwali Edit", () => {
    expect(HERO_SLIDES[0].href).toBe("/collections/diwali");
  });

  it("never says crafted or handcrafted", () => {
    const copy = HERO_SLIDES.map((s) => [s.eyebrow, s.headline, s.subline, s.cta].join(" ")).join(" ");
    expect(copy).not.toMatch(/crafted/i);
  });
});
