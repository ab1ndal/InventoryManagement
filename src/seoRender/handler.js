// Wiring for api/render.js. Dependencies are passed in so failure paths can be tested.

import { renderHtml } from "./html";
import { describePage } from "./pages";

export const CACHE_RENDERED = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";
// Short, so a brief outage does not stick, but long enough to spare a struggling database.
export const CACHE_DEGRADED = "public, max-age=0, s-maxage=30";

// Answers that hold until the catalogue changes, unlike a 404 that an outage could cause.
const SETTLED_STATUSES = new Set([200, 301, 410]);

// `query` is the request's parameters other than the rewritten path; a value may repeat.
function searchString(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) =>
    [].concat(value).forEach((v) => params.append(key, String(v)))
  );
  const search = params.toString();
  return search ? `?${search}` : "";
}

// Always answers with the working app: visitors must not lose the storefront because of SEO.
export async function renderResponse({ path, query, shell, rest, log }) {
  try {
    const page = await describePage(path, rest, searchString(query));
    return {
      status: page.status,
      cacheControl: SETTLED_STATUSES.has(page.status) ? CACHE_RENDERED : CACHE_DEGRADED,
      html: renderHtml(shell, page),
      location: page.location,
    };
  } catch (err) {
    log("seo_render_failed", { path, error: err instanceof Error ? err.message : String(err) });
    return { status: 200, cacheControl: CACHE_DEGRADED, html: shell };
  }
}
