import { isPrivateAddress, resumeAnalyticsOnCleanAddress, endOrderAnalytics } from "../lib/analytics";

afterEach(() => {
  endOrderAnalytics();
  window.history.pushState({}, "", "/");
});

describe("order page analytics gate", () => {
  it("refuses while the address still carries a token", () => {
    window.history.pushState({}, "", "/order/WEB-000001?t=tok_secret");
    expect(resumeAnalyticsOnCleanAddress("WEB-000001")).toBe(false);
    expect(isPrivateAddress("/order/WEB-000001", "")).toBe(true);
  });

  it("refuses for a different page or order", () => {
    window.history.pushState({}, "", "/order/WEB-000002");
    expect(resumeAnalyticsOnCleanAddress("WEB-000001")).toBe(false);
    window.history.pushState({}, "", "/shop");
    expect(resumeAnalyticsOnCleanAddress("WEB-000001")).toBe(false);
  });

  it("allows only that bare order address once resumed, never with a token, and not after it ends", () => {
    window.history.pushState({}, "", "/order/WEB-000001");
    expect(isPrivateAddress("/order/WEB-000001", "")).toBe(true);
    expect(resumeAnalyticsOnCleanAddress("WEB-000001")).toBe(true);
    expect(isPrivateAddress("/order/WEB-000001", "")).toBe(false);
    expect(isPrivateAddress("/order/WEB-000001", "?t=x")).toBe(true);
    expect(isPrivateAddress("/order/WEB-000002", "")).toBe(true);
    endOrderAnalytics();
    expect(isPrivateAddress("/order/WEB-000001", "")).toBe(true);
  });
});
