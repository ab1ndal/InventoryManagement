// Thin GA4 wrapper. Everything here is a complete no-op unless both
// REACT_APP_GA4_ID is set AND we're running a production build — so dev
// and test runs never inject a script or call window.gtag.
const GA4_ID = process.env.REACT_APP_GA4_ID;
const ENABLED = !!GA4_ID && process.env.NODE_ENV === "production";

// GA4 reports the full address by default, and its automatic hits ignore a
// page_location we set. Order pages carry an access token in `t`, which must never
// reach a third party, so analytics does not run on them at all.
//
// The one exception: the order page of an order THIS tab checked out, once the
// token has been moved out of the address (see resumeAnalyticsOnCleanAddress).
let cleanOrderRef = null;

export function isPrivateAddress(pathname, search = "") {
  if (new URLSearchParams(search).has("t")) return true;
  if (cleanOrderRef && pathname === `/order/${cleanOrderRef}`) return false;
  return /^\/order(\/|$)/.test(pathname);
}

function setPaused(paused) {
  if (GA4_ID) window[`ga-disable-${GA4_ID}`] = paused;
}

// Call before moving within the app to an address that carries a token.
export function pauseAnalytics() {
  setPaused(true);
}

// Allows analytics on `/order/<ref>`, but only when the address bar really is
// that bare address right now (no token, nothing else): the check reads the
// browser's address, not router state, so the tag can never load while a token
// is still in it. Returns whether analytics is now running.
export function resumeAnalyticsOnCleanAddress(orderRef) {
  const { pathname, search, hash } = window.location;
  if (pathname !== `/order/${orderRef}` || search || hash) return false;
  cleanOrderRef = orderRef;
  setPaused(false);
  initAnalytics();
  return true;
}

// Order page closed: its address is private again.
export function endOrderAnalytics() {
  cleanOrderRef = null;
}

export function safePageLocation(href) {
  const url = new URL(href);
  url.searchParams.delete("t");
  return url.toString();
}

let initialized = false;
// Google counts the page the tag loads on by itself, so we report only later moves.
let loadViewCounted = false;

export function initAnalytics() {
  if (!ENABLED || initialized) return;
  if (isPrivateAddress(window.location.pathname, window.location.search)) {
    setPaused(true);
    return;
  }
  initialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  // send_page_view:false — page views are sent manually via trackPageView on
  // route change, so the config call must not also auto-fire one (double-count).
  window.gtag("set", { page_location: safePageLocation(window.location.href) });
  window.gtag("config", GA4_ID, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(script);
}

export function trackPageView(path) {
  if (!ENABLED) return;
  const isPrivate = isPrivateAddress(window.location.pathname, window.location.search);
  setPaused(isPrivate);
  if (isPrivate) return;
  initAnalytics();
  const pageLocation = safePageLocation(window.location.href);
  window.gtag("set", { page_location: pageLocation });
  if (!loadViewCounted) {
    loadViewCounted = true;
    return;
  }
  window.gtag("event", "page_view", { page_path: path, page_location: pageLocation });
}

export function trackEvent(name, params) {
  if (!ENABLED || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
