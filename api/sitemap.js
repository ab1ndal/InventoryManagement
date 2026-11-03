// /sitemap.xml, built from what the storefront can show right now.
import { CACHE_SITEMAP, sitemapResponse } from "../src/seoRender/sitemap";
import { restClient } from "../src/seoRender/rest";

export default async function handler(req, res) {
  const { status, body } = await sitemapResponse({
    rest: restClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY),
    log: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
  });
  res.setHeader("Content-Type", status === 200 ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? CACHE_SITEMAP : "no-store");
  res.status(status).send(body);
}
