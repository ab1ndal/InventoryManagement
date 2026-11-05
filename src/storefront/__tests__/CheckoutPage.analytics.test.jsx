import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CheckoutPage from "../pages/CheckoutPage";

jest.mock("../components/FreeShippingNudge", () => () => null);
const mockUseCart = jest.fn();
jest.mock("../context/CartContext", () => ({ useCart: () => mockUseCart() }));
jest.mock("../context/StorefrontAuthContext", () => ({ useStorefrontAuth: () => ({ user: null }) }));

const mockApi = { getCheckoutLive: jest.fn(), quote: jest.fn(), createOrder: jest.fn(), loadCashfree: jest.fn(), fetchMyCustomer: jest.fn() };
jest.mock("../lib/ordersApi", () => ({
  ...jest.requireActual("../lib/ordersApi"),
  getCheckoutLive: (...a) => mockApi.getCheckoutLive(...a),
  quote: (...a) => mockApi.quote(...a),
  createOrder: (...a) => mockApi.createOrder(...a),
  loadCashfree: (...a) => mockApi.loadCashfree(...a),
  fetchMyCustomer: (...a) => mockApi.fetchMyCustomer(...a),
  newAttemptKey: () => "11111111-2222-4333-8444-555555555555",
}));
const mockTrack = jest.fn();
jest.mock("../lib/analytics", () => ({
  ...jest.requireActual("../lib/analytics"),
  trackEvent: (...a) => mockTrack(...a),
  pauseAnalytics: jest.fn(),
}));

const ITEM = { variant_id: "v1", product_id: "BC1", quantity: 2, name: "Silk Saree", size: "FREE", color: "Red", price: 1500, image_url: null };

function quoteResponse(over = {}) {
  return {
    live: true,
    quote: { lines: [], subtotal: 3000, promoDiscount: 200, shipping: 80, voucherApplied: 0, creditApplied: 0, gatewayAmount: 2880, amountDue: 2880, freeShippingGap: 0 },
    pincode: { ok: true, inUp: true },
    shippingSource: "rate",
    code: null,
    creditAvailable: 0,
    unavailable: [],
    ...over,
  };
}

const named = (name) => mockTrack.mock.calls.filter(([n]) => n === name);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/checkout"]}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order/:ref" element={<div />} />
      </Routes>
    </MemoryRouter>
  );
}

function fillAddress() {
  userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
  userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
  userEvent.type(screen.getByPlaceholderText(/pincode/i), "201001");
  userEvent.type(screen.getByPlaceholderText(/flat, house no/i), "58");
  userEvent.type(screen.getByPlaceholderText(/area, street/i), "Sihani Gate Market");
  userEvent.type(screen.getByPlaceholderText(/^city$/i), "Ghaziabad");
  userEvent.selectOptions(screen.getByRole("combobox"), "Uttar Pradesh");
}

beforeEach(() => {
  mockTrack.mockReset();
  mockUseCart.mockReturnValue({ items: [ITEM], renewHolds: jest.fn() });
  mockApi.getCheckoutLive.mockResolvedValue(true);
  mockApi.fetchMyCustomer.mockResolvedValue(null);
  // Like the server: no pincode typed yet means no delivery quote.
  mockApi.quote.mockImplementation(async (p) => {
    if (p.fulfilment === "pickup") return quoteResponse({ pincode: null, shippingSource: "pickup" });
    return p.pincode ? quoteResponse() : quoteResponse({ pincode: null, shippingSource: "none" });
  });
  mockApi.createOrder.mockResolvedValue({ orderRef: "WEB-000009", accessToken: "tok", paymentSessionId: "s", cashfreeMode: "sandbox", paid: false });
  mockApi.loadCashfree.mockResolvedValue({ checkout: jest.fn().mockResolvedValue({}) });
  window.sessionStorage.clear();
});

it("sends begin_checkout once when the live form shows, then add_shipping_info once a delivery quote works", async () => {
  renderPage();
  await screen.findByTestId("quote-shipping");
  expect(named("begin_checkout")).toHaveLength(1);
  expect(named("begin_checkout")[0][1]).toMatchObject({ value: 3000, currency: "INR" });
  expect(named("add_shipping_info")).toHaveLength(0);

  fillAddress();
  await waitFor(() => expect(named("add_shipping_info")).toHaveLength(1));
  expect(named("add_shipping_info")[0][1]).toEqual({ shipping_tier: "delivery", value: 2800, currency: "INR" });
  expect(named("begin_checkout")).toHaveLength(1);
});

it("sends add_shipping_info with tier pickup when the shopper picks store pickup", async () => {
  renderPage();
  await screen.findByTestId("quote-shipping");
  userEvent.click(screen.getByRole("radio", { name: /pick up at the shop/i }));
  await waitFor(() => expect(named("add_shipping_info")).toHaveLength(1));
  expect(named("add_shipping_info")[0][1].shipping_tier).toBe("pickup");
});

it("sends add_payment_info only for a valid Pay tap, and carries no personal fields", async () => {
  renderPage();
  await screen.findByTestId("quote-shipping");
  userEvent.click(screen.getByRole("button", { name: /pay|place order/i }));
  await screen.findByText("Enter a valid 10-digit Indian mobile number");
  expect(named("add_payment_info")).toHaveLength(0);

  fillAddress();
  const pay = await screen.findByRole("button", { name: "Pay ₹2,880" });
  await waitFor(() => expect(pay).toBeEnabled());
  userEvent.click(pay);
  await waitFor(() => expect(mockApi.createOrder).toHaveBeenCalledTimes(1));
  expect(named("add_payment_info")).toEqual([["add_payment_info", { value: 2800, currency: "INR" }]]);
  expect(JSON.stringify(mockTrack.mock.calls)).not.toMatch(/Priya|9810873280|Sihani/);
});
