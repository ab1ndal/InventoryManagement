// Wiring for api/render.js. Dependencies are passed in so failure paths can be tested.

import { renderHtml } from "./html";
import { describePage } from "./pages";

export const CACHE_RENDERED = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";
// Short, so a brief outage does not stick, but long enough to spare a struggling database.
export const CACHE_DEGRADED = "public, max-age=0, s-maxage=30";

// Always answers with the working app: visitors must not lose the storefront because of SEO.
export async function renderResponse({ path, shell, rest, log }) {
  try {
    const page = await describePage(path, rest);
    return {
      status: page.status,
      cacheControl: page.status === 200 ? CACHE_RENDERED : CACHE_DEGRADED,
      html: renderHtml(shell, page),
    };
  } catch (err) {
    log("seo_render_failed", { path, error: err instanceof Error ? err.message : String(err) });
    return { status: 200, cacheControl: CACHE_DEGRADED, html: shell };
  }
}
