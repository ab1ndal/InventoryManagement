import React from "react";
import { render, screen } from "@testing-library/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import OrderPage from "../pages/OrderPage";
import { rememberPendingOrder, readOrderToken } from "../lib/pendingOrder";

const mockOrderStatus = jest.fn();
jest.mock("../lib/ordersApi", () => ({
  ...jest.requireActual("../lib/ordersApi"),
  orderStatus: (...a) => mockOrderStatus(...a),
}));
jest.mock("../context/CartContext", () => ({ useCart: () => ({ clearCart: jest.fn() }) }));
jest.mock("../context/StorefrontAuthContext", () => ({ useStorefrontAuth: () => ({ user: null }) }));

// What the address bar held at the moment analytics was started, and every event sent.
const mockCalls = { resume: [], events: [] };
jest.mock("../lib/analytics", () => ({
  ...jest.requireActual("../lib/analytics"),
  resumeAnalyticsOnCleanAddress: (ref) => {
    mockCalls.resume.push({ ref, search: global.window.location.search, path: global.window.location.pathname });
    return true;
  },
  endOrderAnalytics: () => {},
  trackEvent: (name, params) => mockCalls.events.push({ name, params }),
}));

function order(status, over = {}) {
  return {
    orderRef: "WEB-000001",
    status,
    fulfilment: "ship",
    items: [{ name: "Silk Saree", size: "FREE", color: "Red", qty: 2, status: "ordered" }],
    totals: { subtotal: 3000, promoDiscount: 200, shipping: 80, voucherApplied: 0, creditApplied: 0, gatewayAmount: 2880 },
    trackingUrl: null,
    leftoverVoucher: null,
    ...over,
  };
}

function renderAt(url) {
  window.history.pushState({}, "", url);
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/order/:ref" element={<OrderPage />} />
      </Routes>
    </BrowserRouter>
  );
}

const events = (name) => mockCalls.events.filter((e) => e.name === name);

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  mockCalls.resume.length = 0;
  mockCalls.events.length = 0;
  mockOrderStatus.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

it("moves the token out of the address before analytics starts, and keeps using it", async () => {
  rememberPendingOrder("WEB-000001");
  mockOrderStatus.mockResolvedValue(order("paid"));
  renderAt("/order/WEB-000001?t=tok_secret");
  await screen.findByText("Payment received — order confirmed");

  expect(mockCalls.resume).toHaveLength(1);
  expect(mockCalls.resume[0]).toEqual({ ref: "WEB-000001", search: "", path: "/order/WEB-000001" });
  expect(window.location.search).toBe("");
  expect(readOrderToken("WEB-000001")).toBe("tok_secret");
  expect(mockOrderStatus).toHaveBeenCalledWith({ orderRef: "WEB-000001", accessToken: "tok_secret" });
});

it("sends purchase once, with order money and no personal fields", async () => {
  rememberPendingOrder("WEB-000001");
  mockOrderStatus.mockResolvedValue(order("paid", { name: "Priya", phone: "9810873280", email: "a@b.c", address: "58 Gate" }));
  const { rerender } = renderAt("/order/WEB-000001?t=tok_secret");
  await screen.findByText("Payment received — order confirmed");
  rerender(
    <BrowserRouter>
      <Routes>
        <Route path="/order/:ref" element={<OrderPage />} />
      </Routes>
    </BrowserRouter>
  );

  const purchases = events("purchase");
  expect(purchases).toHaveLength(1);
  expect(purchases[0].params).toEqual({
    transaction_id: "WEB-000001",
    value: 2880,
    currency: "INR",
    shipping: 80,
    items: [{ item_name: "Silk Saree", quantity: 2 }],
  });
  expect(JSON.stringify(mockCalls.events)).not.toMatch(/tok_secret|Priya|9810873280|a@b\.c|Gate/);
});

it("does not send purchase again after a reload in the same browser", async () => {
  rememberPendingOrder("WEB-000001");
  mockOrderStatus.mockResolvedValue(order("paid"));
  const first = renderAt("/order/WEB-000001?t=tok_secret");
  await screen.findByText("Payment received — order confirmed");
  first.unmount();

  // Reload: clean address, token only in session storage.
  renderAt("/order/WEB-000001");
  await screen.findByText("Payment received — order confirmed");
  expect(mockOrderStatus).toHaveBeenLastCalledWith({ orderRef: "WEB-000001", accessToken: "tok_secret" });
  expect(events("purchase")).toHaveLength(1);
});

it("sends nothing and leaves the address alone for a link this tab did not check out", async () => {
  mockOrderStatus.mockResolvedValue(order("paid"));
  renderAt("/order/WEB-000001?t=tok_old");
  await screen.findByText("Payment received — order confirmed");

  expect(window.location.search).toBe("?t=tok_old");
  expect(mockCalls.resume).toHaveLength(0);
  expect(mockCalls.events).toHaveLength(0);
  expect(mockOrderStatus).toHaveBeenCalledWith({ orderRef: "WEB-000001", accessToken: "tok_old" });
});

it("sends nothing for a signed-in view of an order this tab did not check out", async () => {
  mockOrderStatus.mockResolvedValue(order("paid"));
  renderAt("/order/WEB-000001");
  await screen.findByText("Payment received — order confirmed");
  expect(mockCalls.resume).toHaveLength(0);
  expect(mockCalls.events).toHaveLength(0);
});

it("sends payment_failed once for a failed order this tab checked out", async () => {
  rememberPendingOrder("WEB-000001");
  mockOrderStatus.mockResolvedValue(order("payment_failed"));
  renderAt("/order/WEB-000001?t=tok_secret");
  await screen.findByText("Payment didn't go through");

  expect(events("payment_failed")).toEqual([
    { name: "payment_failed", params: { transaction_id: "WEB-000001", currency: "INR" } },
  ]);
  expect(events("purchase")).toHaveLength(0);
});
