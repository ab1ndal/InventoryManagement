// /feeds/google-products.xml, read by Google Merchant Center.
import { CACHE_FEED, feedResponse } from "../src/seoRender/feed";
import { restClient } from "../src/seoRender/rest";

export default async function handler(req, res) {
  const { status, body } = await feedResponse({
    // ?sample=25 serves a small test feed for a first Merchant Center review.
    sample: Number(req.query?.sample) || undefined,
    rest: restClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY),
    log: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
  });
  res.setHeader("Content-Type", status === 200 ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? CACHE_FEED : "no-store");
  res.status(status).send(body);
}
