// Google Merchant Center product feed: the same products, prices and stock the storefront shows.
import { imageUrl } from "../storefront/lib/imageVariant";
import { stripMarkdown } from "../storefront/lib/productText";
import { productMetaDescription } from "../storefront/lib/seoText";
import { SITE_NAME, SITE_URL, esc } from "./html";

export const CACHE_FEED = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

const PAGE = 1000;
const FIELDS =
  "productid,name:display_title,description,retailprice,productimages(imageurl,displayorder),productsizecolors(stock,color)";
// Google's category "Apparel & Accessories > Clothing".
const GOOGLE_CATEGORY_CLOTHING = 1604;
// Merchant Center allows 10 extra photos per item.
const MAX_EXTRA_IMAGES = 10;

async function allProducts(rest) {
  const products = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(`products?select=${FIELDS}&order=productid&limit=${PAGE}&offset=${offset}`);
    products.push(...rows);
    if (rows.length < PAGE) return products;
  }
}

const tag = (name, value) => `<g:${name}>${esc(value)}</g:${name}>`;

function feedItem(product) {
  const images = [...(product.productimages || [])]
    .sort((a, b) => (a.displayorder ?? 0) - (b.displayorder ?? 0))
    .map((img) => imageUrl(img.imageurl, { width: 1200 }));
  const variants = product.productsizecolors || [];
  // Sold-out pieces are left out rather than listed as unavailable: most stock is one-off.
  if (!images.length || !variants.some((v) => Number(v.stock) > 0)) return null;

  const price = Number(product.retailprice);
  const text = stripMarkdown(product.description);
  const colours = [...new Set(variants.map((v) => v.color).filter(Boolean))];
  return [
    "<item>",
    tag("id", product.productid),
    tag("title", product.name),
    tag("description", text || productMetaDescription({ name: product.name, text, price })),
    tag("link", `${SITE_URL}/product/${encodeURIComponent(product.productid)}`),
    tag("image_link", images[0]),
    ...images.slice(1, MAX_EXTRA_IMAGES + 1).map((url) => tag("additional_image_link", url)),
    tag("availability", "in_stock"),
    tag("price", `${price.toFixed(2)} INR`),
    tag("brand", SITE_NAME),
    tag("condition", "new"),
    // These are the shop's own pieces, with no manufacturer barcode to state.
    tag("identifier_exists", "no"),
    tag("google_product_category", GOOGLE_CATEGORY_CLOTHING),
    ...(colours.length === 1 ? [tag("color", colours[0])] : []),
    "</item>",
  ].join("");
}

export async function buildFeed(rest) {
  const items = (await allProducts(rest)).map(feedItem).filter(Boolean);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>` +
    `<title>${esc(SITE_NAME)}</title><link>${esc(SITE_URL)}</link>` +
    `<description>Products from ${esc(SITE_NAME)}</description>\n` +
    items.join("\n") +
    `\n</channel></rss>\n`
  );
}

// An outage must not look like an empty catalogue, which would drop every listing.
export async function feedResponse({ rest, log }) {
  try {
    return { status: 200, body: await buildFeed(rest) };
  } catch (err) {
    log("merchant_feed_failed", { error: err instanceof Error ? err.message : String(err) });
    return { status: 503, body: "Feed temporarily unavailable" };
  }
}
