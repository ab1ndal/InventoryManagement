import { COLLECTIONS } from "../storefront/lib/collections";
import { SITE_URL, esc } from "./html";
import { STATIC_PATHS } from "./pages";

export const CACHE_SITEMAP = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

// PostgREST caps one response at 1000 rows, so page through with a stable order.
const PAGE = 1000;

async function allProductIds(rest) {
  const ids = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(`products?select=productid&order=productid&limit=${PAGE}&offset=${offset}`);
    ids.push(...rows.map((r) => r.productid));
    if (rows.length < PAGE) return ids;
  }
}

export async function buildSitemap(rest) {
  const products = await allProductIds(rest);
  const paths = [
    "/",
    "/shop",
    ...STATIC_PATHS,
    ...COLLECTIONS.map((c) => `/collections/${encodeURIComponent(c.slug)}`),
    ...products.map((id) => `/product/${encodeURIComponent(id)}`),
  ];
  // No <lastmod>: products have no reliable change date, and Google ignores dates it cannot trust.
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${esc(SITE_URL + p)}</loc></url>`).join("\n") +
    `\n</urlset>\n`
  );
}

// A failure must not look like an empty catalogue: 503 tells Google to come back, and keeps the last sitemap.
export async function sitemapResponse({ rest, log }) {
  try {
    return { status: 200, body: await buildSitemap(rest) };
  } catch (err) {
    log("seo_sitemap_failed", { error: err instanceof Error ? err.message : String(err) });
    return { status: 503, body: "Sitemap temporarily unavailable" };
  }
}
