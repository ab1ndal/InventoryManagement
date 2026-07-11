// Thin GA4 wrapper. Everything here is a complete no-op unless both
// REACT_APP_GA4_ID is set AND we're running a production build — so dev
// and test runs never inject a script or call window.gtag.
const GA4_ID = process.env.REACT_APP_GA4_ID;
const ENABLED = !!GA4_ID && process.env.NODE_ENV === "production";

let initialized = false;

export function initAnalytics() {
  if (!ENABLED || initialized) return;
  initialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  // send_page_view:false — page views are sent manually via trackPageView on
  // route change, so the config call must not also auto-fire one (double-count).
  window.gtag("config", GA4_ID, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(script);
}

export function trackPageView(path) {
  if (!ENABLED || typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", { page_path: path });
}

export function trackEvent(name, params) {
  if (!ENABLED || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
