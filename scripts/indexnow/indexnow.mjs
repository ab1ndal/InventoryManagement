// Tells IndexNow search engines (Bing, Yandex, Naver, Seznam, Yep) which pages appeared or
// disappeared since the last run, so new one-off pieces are crawled within hours, not weeks.
// Google does not take part; it reads the sitemap.
//
// State is the previous run's sitemap URL list, kept by the GitHub workflow's cache. With no
// state (first run, or the cache expired) every sitemap URL is sent once.
//
// Usage: node scripts/indexnow/indexnow.mjs <state-file>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SITE = "https://www.bindalscreations.com";
// Public by design: search engines check it against /<key>.txt on the site.
export const KEY = "4a3dab4214c8fd6eee375524f8e3de46";
const ENDPOINT = "https://api.indexnow.org/indexnow";
// IndexNow accepts up to 10,000 URLs per request.
export const MAX_URLS_PER_REQUEST = 10000;
// A sitemap less than half the size of the last one is more likely an outage than real
// removals, and sending it would tell engines hundreds of live pages are gone.
const MIN_SIZE_RATIO = 0.5;
const TIMEOUT_MS = 30000;

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

/** Page URLs in a sitemap, on this site only. Image entries are not pages. */
export function sitemapUrls(xml) {
  const urls = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/&amp;/g, "&"));
  return [...new Set(urls.filter((u) => u === `${SITE}/` || u.startsWith(`${SITE}/`)))];
}

/** URLs added or removed since the previous list; every URL when there is no previous list. */
export function changedUrls(previous, current) {
  if (!previous) return current;
  const before = new Set(previous);
  const now = new Set(current);
  return [...current.filter((u) => !before.has(u)), ...previous.filter((u) => !now.has(u))];
}

/** Why this sitemap should not be trusted, or null when it is fine to use. */
export function sitemapProblem(previous, current) {
  if (current.length === 0) return "sitemap has no page URLs";
  if (previous && current.length < previous.length * MIN_SIZE_RATIO) {
    return `sitemap shrank from ${previous.length} to ${current.length} URLs`;
  }
  return null;
}

export function batches(urls, size = MAX_URLS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size));
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.text();
}

async function submit(urlList) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 200 = accepted, 202 = accepted while the key is still being verified.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow returned ${res.status} for ${urlList.length} URLs: ${(await res.text()).slice(0, 300)}`);
  }
  return res.status;
}

async function main(statePath) {
  if (!statePath) throw new Error("usage: indexnow.mjs <state-file>");
  const previous = existsSync(statePath) ? readFileSync(statePath, "utf8").split("\n").filter(Boolean) : null;

  const key = (await fetchText(`${SITE}/${KEY}.txt`)).trim();
  if (key !== KEY) throw new Error(`key file on the site does not match (got ${key.slice(0, 40)})`);

  const current = sitemapUrls(await fetchText(`${SITE}/sitemap.xml`));
  const problem = sitemapProblem(previous, current);
  if (problem) throw new Error(`${problem}; nothing sent, state kept`);

  const changed = changedUrls(previous, current);
  log("indexnow_diff", { previous: previous?.length ?? null, current: current.length, changed: changed.length });
  for (const batch of batches(changed)) {
    const status = await submit(batch);
    log("indexnow_submitted", { urls: batch.length, status });
  }
  // State moves forward only after every batch was accepted, so a failed day is retried.
  writeFileSync(statePath, `${current.join("\n")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv[2]).catch((err) => {
    log("indexnow_failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
