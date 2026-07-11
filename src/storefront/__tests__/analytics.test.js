// No REACT_APP_GA4_ID is set in the test env (CRA test runs with
// NODE_ENV='test' anyway), so every export here must be a silent no-op.
import { initAnalytics, trackPageView, trackEvent } from "../lib/analytics";

describe("analytics — disabled without GA4 id / outside production", () => {
  it("initAnalytics injects no gtag script and does not throw", () => {
    expect(() => initAnalytics()).not.toThrow();
    expect(document.querySelector('script[src*="googletagmanager.com"]')).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it("trackPageView does nothing and does not throw", () => {
    expect(() => trackPageView("/shop")).not.toThrow();
    expect(window.gtag).toBeUndefined();
  });

  it("trackEvent does nothing and does not throw", () => {
    expect(() => trackEvent("add_to_cart", { value: 100 })).not.toThrow();
    expect(window.gtag).toBeUndefined();
  });
});
