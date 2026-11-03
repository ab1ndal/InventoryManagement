// Serves every public storefront URL: the app's HTML plus real title, text and structured data, so
// crawlers that do not run JS can read the page. vercel.json rewrites requests here.
import { readFileSync } from "fs";
import { join } from "path";
import { renderResponse } from "../src/seoRender/handler";

const REST_TIMEOUT_MS = 3000;
const shell = readFileSync(join(process.cwd(), "build/shell.html"), "utf8");

function restClient(url, anonKey) {
  return async (query) => {
    const res = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status} for ${query.slice(0, 80)}`);
    return res.json();
  };
}

export default async function handler(req, res) {
  const { status, cacheControl, html } = await renderResponse({
    path: String(req.query.path ?? ""),
    shell,
    rest: restClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY),
    log: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).send(html);
}
