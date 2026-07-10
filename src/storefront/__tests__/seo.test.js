import { buildProductJsonLd } from "../lib/seo";

const product = { name: "Silk Saree", description: "Handwoven", retailprice: "4500" };
const variants = [{ stock: 0 }, { stock: 2 }];

describe("buildProductJsonLd", () => {
  it("builds a Product with an InStock offer when any variant has stock", () => {
    const ld = buildProductJsonLd({
      product, variants, imagePaths: [], productid: "BC25001", categoryName: "Sarees",
    });
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Silk Saree");
    expect(ld.sku).toBe("BC25001");
    expect(ld.offers.price).toBe(4500);
    expect(ld.offers.priceCurrency).toBe("INR");
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
    expect(ld.offers.seller.name).toBe("BINDAL'S CREATION");
    expect(ld.brand.name).toBe("Bindal's Creations");
  });

  it("marks OutOfStock when every variant is zero", () => {
    const ld = buildProductJsonLd({
      product, variants: [{ stock: 0 }], imagePaths: [], productid: "BC25002", categoryName: null,
    });
    expect(ld.offers.availability).toBe("https://schema.org/OutOfStock");
  });
});
