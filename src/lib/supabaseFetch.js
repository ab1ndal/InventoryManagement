// The Supabase REST host (supabase.co) sits behind Cloudflare, which plants a
// `__cf_bm` bot-management cookie. A burst of parallel client XHRs (e.g. the
// shop page firing many filter-option reads at once) looks bot-like; when the
// resulting cookie later goes stale, Cloudflare answers subsequent background
// fetches with a managed challenge a non-navigational request can't satisfy —
// so the request hangs forever and the UI is stuck on skeletons.
//
// Fix: route only the PostgREST data plane (`/rest/v1`) through a same-origin
// Vercel rewrite (`/sb-rest/*`). The browser then talks to our own domain, so
// it never receives or replays `__cf_bm`; the server-side hop to supabase.co
// carries any Cloudflare cookie and discards it. Auth (`/auth/v1`) and storage
// (`/storage/v1`) are left direct — they're low-volume single requests that
// don't trigger the bot challenge, and proxying auth would complicate the
// OAuth redirect chain.
//
// The same wrapper adds a timeout + one retry to idempotent REST GETs as a
// defence-in-depth net: any future hang resolves as an error instead of an
// endless skeleton.

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const REST_PREFIX = `${SUPABASE_URL}/rest/v1`;
const PROXY_PREFIX = "/sb-rest";

export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_RETRIES = 1;

// Map a Supabase REST URL to the same-origin proxy path. Only rewrites when
// running in production (the Vercel rewrite only exists there — CRA's dev
// server has no `/sb-rest` route, so dev talks to supabase.co directly, exactly
// like the image pipeline). Non-REST URLs (auth, storage) pass through.
export function toProxyUrl(url, { isProd, origin }) {
  if (!isProd) return url;
  if (typeof url !== "string" || !url.startsWith(REST_PREFIX)) return url;
  return origin + PROXY_PREFIX + url.slice(REST_PREFIX.length);
}

// Build the fetch implementation handed to createClient's `global.fetch`.
export function makeSupabaseFetch({
  isProd,
  origin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  fetchImpl,
} = {}) {
  const baseFetch =
    fetchImpl ||
    (typeof fetch !== "undefined" ? (...args) => fetch(...args) : null);

  return async function supabaseFetch(input, init = {}) {
    // Only string inputs are proxyable/inspectable; postgrest-js and gotrue-js
    // both call fetch(urlString, init). Anything else passes straight through.
    if (typeof input !== "string" || !baseFetch) {
      return baseFetch(input, init);
    }

    const method = (init.method || "GET").toUpperCase();
    const isRest = input.startsWith(REST_PREFIX);
    const target = toProxyUrl(input, { isProd, origin });

    // Timeout + retry only for idempotent REST reads. Writes/uploads/auth are
    // not retried (non-idempotent) and get no timeout (uploads can be slow).
    // A caller-supplied AbortSignal is respected as-is, skipping our timeout.
    const guarded = isRest && method === "GET" && !init.signal;
    if (!guarded) return baseFetch(target, init);

    const maxAttempts = retries + 1;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await baseFetch(target, { ...init, signal: controller.signal });
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  };
}
