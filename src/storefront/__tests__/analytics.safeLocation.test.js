import { safePageLocation } from "../lib/analytics";

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
