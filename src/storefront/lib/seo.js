import { imageUrl } from "./productImage";

// Builds a schema.org Product object for JSON-LD on the product detail page.
export function buildProductJsonLd({ product, variants, imagePaths, productid, categoryName }) {
  const inStock = (variants || []).some((v) => Number(v.stock) > 0);
  const image = imagePaths && imagePaths.length
    ? [imageUrl(imagePaths[0], { width: 1000, quality: 80 })]
    : undefined;
  const description =
    product.description ||
    `${product.name}${categoryName ? ` — ${categoryName}` : ""}`;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image,
    description,
    sku: productid,
    brand: { "@type": "Brand", name: "Bindal's Creations" },
    offers: {
      "@type": "Offer",
      price: Number(product.retailprice),
      priceCurrency: "INR",
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: "BINDAL'S CREATION" },
    },
  };
}
