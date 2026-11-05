import { isPrivateAddress, safePageLocation } from "../lib/analytics";

describe("safePageLocation", () => {
  it("removes the order access token", () => {
    expect(safePageLocation("https://shop.test/order/WEB-000001?t=secret")).toBe(
      "https://shop.test/order/WEB-000001"
    );
  });

  it("keeps campaign and search parameters", () => {
    expect(safePageLocation("https://shop.test/shop?utm_source=x&t=secret&q=saree")).toBe(
      "https://shop.test/shop?utm_source=x&q=saree"
    );
  });

  it("leaves other addresses alone", () => {
    expect(safePageLocation("https://shop.test/faq")).toBe("https://shop.test/faq");
  });
});

describe("isPrivateAddress", () => {
  it("treats order pages and any address with a token as private", () => {
    expect(isPrivateAddress("/order/WEB-000001", "?t=secret")).toBe(true);
    expect(isPrivateAddress("/order/WEB-000001")).toBe(true);
    expect(isPrivateAddress("/shop", "?t=secret")).toBe(true);
  });

  it("leaves public pages alone", () => {
    expect(isPrivateAddress("/", "")).toBe(false);
    expect(isPrivateAddress("/orders-info", "?utm_source=x")).toBe(false);
    expect(isPrivateAddress("/track", "?order=WEB-000001")).toBe(false);
  });
});
