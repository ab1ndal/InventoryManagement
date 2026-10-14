import { stripMarkdown, whatsappProductUrl } from "../lib/productText";

describe("stripMarkdown", () => {
  it("removes bold markers but keeps the words", () => {
    expect(stripMarkdown("A **pistachio green** lehenga with **zari** work")).toBe(
      "A pistachio green lehenga with zari work"
    );
  });

  it("removes unpaired markers too", () => {
    expect(stripMarkdown("Soft **silk drape")).toBe("Soft silk drape");
  });

  it("returns an empty string for missing or blank text", () => {
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown("  ** **  ")).toBe("");
  });
});

describe("whatsappProductUrl", () => {
  it("prefills a message with the product name, id and page URL", () => {
    const url = whatsappProductUrl({
      name: "Silk-Lehenga",
      productid: "BC252742",
      pageUrl: "https://example.com/product/BC252742",
    });
    expect(url.startsWith("https://wa.me/919810873280?text=")).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toContain("Silk-Lehenga");
    expect(text).toContain("BC252742");
    expect(text).toContain("https://example.com/product/BC252742");
  });
});
