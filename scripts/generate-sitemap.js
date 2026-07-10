// scripts/generate-sitemap.js
/**
 * Generates public/sitemap.xml from the products table + static routes.
 * Run on demand (NOT wired into `npm run build`):
 *   node scripts/generate-sitemap.js
 * Reads REACT_APP_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
 * Site domain: https://bindalscreations.com (override with SITE_URL).
 */
const fs = require("fs");
const path = require("path");

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

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const SITE_URL = (env.SITE_URL || "https://bindalscreations.com").replace(/\/$/, "");
  const supaUrl = env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  // PostgREST caps a single response at ~1000 rows, so page through the
  // whole products table with Range headers instead of trusting one fetch.
  const PAGE = 1000;
  const products = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${supaUrl}/rest/v1/products?select=productid`, {
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

  const staticPaths = ["/", "/shop", "/faq"];
  const urls = [
    ...staticPaths.map((p) => `${SITE_URL}${p}`),
    ...products.map((p) => `${SITE_URL}/product/${p.productid}`),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  const outPath = path.join(__dirname, "..", "public", "sitemap.xml");
  fs.writeFileSync(outPath, xml);
  console.log(`Wrote ${urls.length} URLs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
