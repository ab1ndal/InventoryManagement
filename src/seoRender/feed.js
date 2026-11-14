// Google Merchant Center product feed: the same products, prices and stock the storefront shows.
import { imageUrl } from "../storefront/lib/imageVariant";
import { stripMarkdown } from "../storefront/lib/productText";
import { productMetaDescription } from "../storefront/lib/seoText";
import { formatSize } from "../storefront/lib/sizes";
import { categoryAudience } from "./audience";
import { SITE_NAME, SITE_URL, esc } from "./html";

export const CACHE_FEED = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

const PAGE = 1000;
const FIELDS =
  "productid,name:display_title,description,retailprice,categoryid,fabric,categories(name),productimages(imageurl,displayorder),productsizecolors(stock,color,size)";
// Google's category "Apparel & Accessories > Clothing", for anything without a closer match below.
const GOOGLE_CATEGORY_CLOTHING = 1604;
// Closer Google categories (ids from google.com/basepages/producttype/taxonomy-with-ids.en-US.txt).
// Only clear matches are listed: a wrong category hurts matching more than the general one.
const SARIS_AND_LEHENGAS = 8248; // Clothing > Traditional & Ceremonial Clothing > Saris & Lehengas
const TRADITIONAL_CLOTHING = 5388; // Clothing > Traditional & Ceremonial Clothing
const DRESSES = 2271; // Clothing > Dresses
const SUITS = 1594; // Clothing > Suits
const SHIRTS_AND_TOPS = 212; // Clothing > Shirts & Tops
const PANTS = 204; // Clothing > Pants
const GOOGLE_CATEGORY = {
  SA: SARIS_AND_LEHENGAS,
  LE: SARIS_AND_LEHENGAS,
  LCH: SARIS_AND_LEHENGAS,
  // Salwar suits, kurtis, kurta pajamas, sherwanis and Jodhpuri suits are Indian traditional dress.
  ...Object.fromEntries(
    ["ST", "RMS", "KUR", "SHR", "KP", "SK", "SW", "IW", "NHJ", "GD", "SJ-2P", "SJ-3P", "C-KP", "C-SW", "C-IW", "C-S3P", "C-S5P"].map(
      (id) => [id, TRADITIONAL_CLOTHING],
    ),
  ),
  GWN: DRESSES,
  DRS: DRESSES,
  // Western two-, three- and five-piece suits and blazers.
  ...Object.fromEntries(["S2P", "S3P", "S5P", "BLZ"].map((id) => [id, SUITS])),
  ...Object.fromEntries(["SHT", "T-SHT", "TOP", "SWT-SHT"].map((id) => [id, SHIRTS_AND_TOPS])),
  ...Object.fromEntries(["FRMP", "TRS", "PNT", "JNS", "PL", "LG"].map((id) => [id, PANTS])),
};
const AUDIENCE_LABEL = { kids: "Kids", female: "Women", male: "Men" };
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

// Stock-room words that say a piece has no single colour. Google wants a colour, so these state none.
const NOT_A_COLOUR = /^(multi|multi[\s-]?colou?r(ed)?|printed|assorted|mixed?)$/i;
// Google allows up to 3 colours in one value.
const MAX_COLOURS = 3;

// Google asks for "Red/Pink/Blue". Null when the stock-room value is not a colour or names too many.
export function feedColour(raw) {
  const value = String(raw ?? "").trim();
  if (!value || NOT_A_COLOUR.test(value)) return null;
  const parts = value.split(/\s*(?:[-/,&+]|\band\b)\s*/i).filter(Boolean);
  return parts.length > 0 && parts.length <= MAX_COLOURS ? parts.join("/") : null;
}

const tag = (name, value) => `<g:${name}>${esc(value)}</g:${name}>`;

// The shop's own path, such as "Women > Saree > Silk": who it is for, the category and the fabric the
// product page shows. Merchant Center uses it to match searches and to group products in reports.
export function productType({ categoryName, fabric, gender, ageGroup }) {
  const audience = ageGroup === "kids" ? AUDIENCE_LABEL.kids : AUDIENCE_LABEL[gender];
  return [audience, categoryName, fabric].map((part) => String(part ?? "").trim()).filter(Boolean).join(" > ");
}

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
  // One item covers the whole product, so a value is stated only when every buyable variant shares it.
  // Several sizes or colours would need one item per variant, which Google requires for them.
  const sizes = [...new Set(variants.filter((v) => Number(v.stock) > 0).map((v) => v.size).filter(Boolean))];
  const colour = colours.length === 1 ? feedColour(colours[0]) : null;
  const { gender, ageGroup } = categoryAudience(product.categoryid);
  const fabric = String(product.fabric ?? "").trim();
  const type = productType({ categoryName: product.categories?.name, fabric, gender, ageGroup });
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
    tag("google_product_category", GOOGLE_CATEGORY[product.categoryid] ?? GOOGLE_CATEGORY_CLOTHING),
    ...(type ? [tag("product_type", type)] : []),
    ...(colour ? [tag("color", colour)] : []),
    // The same fabric the product page's Details table shows.
    ...(fabric ? [tag("material", fabric)] : []),
    ...(sizes.length === 1 ? [tag("size", formatSize(sizes[0]))] : []),
    ...(gender ? [tag("gender", gender)] : []),
    ...(ageGroup ? [tag("age_group", ageGroup)] : []),
    "</item>",
  ].join("");
}

// Evenly spaced across the catalogue, so a small test feed covers more than the oldest category.
export function sampleItems(items, size) {
  if (!Number.isInteger(size) || size <= 0 || size >= items.length) return items;
  return Array.from({ length: size }, (_, i) => items[Math.floor((i * items.length) / size)]);
}

export async function buildFeed(rest, { sample } = {}) {
  const items = sampleItems((await allProducts(rest)).map(feedItem).filter(Boolean), sample);
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
export async function feedResponse({ rest, log, sample }) {
  try {
    return { status: 200, body: await buildFeed(rest, { sample }) };
  } catch (err) {
    log("merchant_feed_failed", { error: err instanceof Error ? err.message : String(err) });
    return { status: 503, body: "Feed temporarily unavailable" };
  }
}
