// Serves every public storefront URL: the app's HTML plus real title, text and structured data, so
// crawlers that do not run JS can read the page. vercel.json rewrites requests here.
import { readFileSync } from "fs";
import { join } from "path";
import { renderResponse } from "../src/seoRender/handler";
import { restClient } from "../src/seoRender/rest";

const shell = readFileSync(join(process.cwd(), "build/shell.html"), "utf8");

export default async function handler(req, res) {
  // The rewrite adds ssr_path, and Vercel also passes its `:path` segment as `path`; every other
  // parameter came with the visitor's own request. Left in, `path` would leak into redirects.
  const { ssr_path: ssrPath, path: _routeSegment, ...query } = req.query;
  const { status, cacheControl, html, location } = await renderResponse({
    path: String(ssrPath ?? ""),
    query,
    shell,
    rest: restClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY),
    log: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  if (location) res.setHeader("Location", location);
  res.status(status).send(html);
}
