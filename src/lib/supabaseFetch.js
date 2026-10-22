// The Supabase host (supabase.co) sits behind Cloudflare, which plants a
// `__cf_bm` bot-management cookie. A burst of parallel client XHRs (e.g. the
// shop page firing many filter-option reads at once) looks bot-like; when the
// resulting cookie later goes stale, Cloudflare answers subsequent background
// fetches with a managed challenge a non-navigational request can't satisfy —
// so the request hangs forever and the UI is stuck on skeletons.
//
// Fix: route the PostgREST data plane (`/rest/v1` -> `/sb-rest/*`) and the
// auth API (`/auth/v1` -> `/sb-auth/*`) through same-origin Vercel rewrites.
// The browser then talks to our own domain, so it never receives or replays
// `__cf_bm`; the server-side hop to supabase.co carries any Cloudflare cookie
// and discards it.
//
// Auth must be proxied too: supabase-js awaits `auth.getSession()` before
// every REST call, and a stored-but-expired session triggers a token refresh
// first. If that refresh hangs, NO data request is ever sent — the page stalls
// with zero REST traffic (reproducible for any visitor with a saved login;
// incognito is unaffected because it has no session to refresh). Only auth
// *API calls* go through fetch; OAuth/magic-link browser redirects are built
// from the Supabase URL directly and stay on supabase.co. Storage
// (`/storage/v1`) is left direct — images load straight from Storage.
//
// The same wrapper adds a timeout to REST GETs (plus one retry) and to auth
// calls (no retry: auth-js retries refreshes itself, and a duplicate refresh
// would spend a rotating refresh token) as a defence-in-depth net: any future
// hang resolves as an error instead of an endless skeleton.

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const REST_PREFIX = `${SUPABASE_URL}/rest/v1`;
const PROXY_PREFIX = "/sb-rest";
const AUTH_PREFIX = `${SUPABASE_URL}/auth/v1`;
const AUTH_PROXY_PREFIX = "/sb-auth";

export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_RETRIES = 1;

// Map a Supabase REST/auth URL to its same-origin proxy path. Only rewrites
// when running in production (the Vercel rewrites only exist there — CRA's dev
// server has no `/sb-rest` or `/sb-auth` route, so dev talks to supabase.co
// directly). Storage URLs pass through.
export function toProxyUrl(url, { isProd, origin }) {
  if (!isProd || typeof url !== "string") return url;
  if (url.startsWith(REST_PREFIX)) {
    return origin + PROXY_PREFIX + url.slice(REST_PREFIX.length);
  }
  if (url.startsWith(AUTH_PREFIX)) {
    return origin + AUTH_PROXY_PREFIX + url.slice(AUTH_PREFIX.length);
  }
  return url;
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
    const isRestRead = input.startsWith(REST_PREFIX) && method === "GET";
    const isAuth = input.startsWith(AUTH_PREFIX);
    const target = toProxyUrl(input, { isProd, origin });

    // Timeout for idempotent REST reads (retried) and auth calls (not
    // retried). REST writes/uploads get neither (non-idempotent; uploads can
    // be slow). A caller-supplied AbortSignal is respected as-is.
    const guarded = (isRestRead || isAuth) && !init.signal;
    if (!guarded) return baseFetch(target, init);

    const maxAttempts = isRestRead ? retries + 1 : 1;
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
