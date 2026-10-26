// scripts/generate-sitemap.js
/**
 * Generates public/sitemap.xml from storefront-visible products, collections
 * and static routes. Run on demand (NOT wired into `npm run build`):
 *   node scripts/generate-sitemap.js
 * Reads REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_ANON_KEY from .env.
 * Uses the anon key on purpose: the products RLS policy decides which products
 * the storefront shows (only those with productimages rows), so the sitemap
 * lists exactly the pages that render instead of "Product not found".
 */
const fs = require("fs");
const path = require("path");

// Canonical host. The bare domain 307-redirects here, so never list it.
// Keep in sync with the Sitemap line in public/robots.txt.
const SITE_URL = "https://www.bindalscreations.com";

// Public, indexable storefront routes (see src/App.js). Cart, checkout,
// wishlist, login, account, search and track are left out on purpose.
const STATIC_PATHS = [
  "/",
  "/shop",
  "/collections",
  "/faq",
  "/about",
  "/customize",
  "/contact",
  "/size-guide",
  "/policies/shipping",
  "/policies/returns",
  "/policies/privacy",
  "/policies/terms",
];

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// Collections with no categoryIds/productIds are empty placeholders
// (e.g. "wedding", "festive") and would render an empty page.
async function loadCollectionSlugs() {
  const { COLLECTIONS } = await import(
    path.join(__dirname, "..", "src", "storefront", "lib", "collections.js")
  );
  return COLLECTIONS.filter(
    (c) => (c.productIds?.length || 0) + (c.categoryIds?.length || 0) > 0
  ).map((c) => c.slug);
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const supaUrl = env.REACT_APP_SUPABASE_URL;
  const key = env.REACT_APP_SUPABASE_ANON_KEY;
  if (!supaUrl || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY in .env");
    process.exit(1);
  }

  // PostgREST caps a single response at ~1000 rows, so page through with
  // Range headers instead of trusting one fetch. Stable order keeps pages
  // from overlapping or skipping rows.
  const PAGE = 1000;
  const products = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${supaUrl}/rest/v1/products?select=productid&order=productid`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok) {
      console.error("Failed to fetch products:", res.status, await res.text());
      process.exit(1);
    }
    const batch = await res.json();
    products.push(...batch);
    if (batch.length < PAGE) break;
  }

  const collectionSlugs = await loadCollectionSlugs();
  const urls = [
    ...STATIC_PATHS.map((p) => `${SITE_URL}${p}`),
    ...collectionSlugs.map((s) => `${SITE_URL}/collections/${encodeURIComponent(s)}`),
    ...products.map((p) => `${SITE_URL}/product/${encodeURIComponent(p.productid)}`),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  const outPath = path.join(__dirname, "..", "public", "sitemap.xml");
  fs.writeFileSync(outPath, xml);
  console.log(
    `Wrote ${urls.length} URLs to ${outPath} ` +
      `(${STATIC_PATHS.length} static, ${collectionSlugs.length} collections, ${products.length} products)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
