// Serves every public storefront URL: the app's HTML plus real title, text and structured data, so
// crawlers that do not run JS can read the page. vercel.json rewrites requests here.
import { readFileSync } from "fs";
import { join } from "path";
import { renderResponse } from "../src/seoRender/handler";
import { restClient } from "../src/seoRender/rest";

const shell = readFileSync(join(process.cwd(), "build/shell.html"), "utf8");

export default async function handler(req, res) {
  const { status, cacheControl, html } = await renderResponse({
    path: String(req.query.ssr_path ?? ""),
    shell,
    rest: restClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY),
    log: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(html);
}
