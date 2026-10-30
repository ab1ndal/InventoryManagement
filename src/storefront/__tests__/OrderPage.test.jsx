import React from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import OrderPage, { POLL_INTERVAL_MS } from "../pages/OrderPage";
import { OrdersApiError } from "../lib/ordersApi";
import { rememberPendingOrder } from "../lib/pendingOrder";

const mockOrderStatus = jest.fn();
jest.mock("../lib/ordersApi", () => ({
  ...jest.requireActual("../lib/ordersApi"),
  orderStatus: (...a) => mockOrderStatus(...a),
}));
const mockClearCart = jest.fn();
jest.mock("../context/CartContext", () => ({ useCart: () => ({ clearCart: mockClearCart }) }));
const mockAuth = jest.fn();
jest.mock("../context/StorefrontAuthContext", () => ({ useStorefrontAuth: () => mockAuth() }));


function order(status, over = {}) {
  return {
    orderRef: "WEB-000001",
    status,
    items: [{ name: "Silk Saree", size: "FREE", color: "Red", qty: 2, status: "ordered" }],
    totals: { subtotal: 3000, promoDiscount: 0, shipping: 80, voucherApplied: 0, creditApplied: 0, gatewayAmount: 3080 },
    trackingUrl: null,
    leftoverVoucher: null,
    ...over,
  };
}

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/order/:ref" element={<OrderPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAuth.mockReturnValue({ user: null });
  window.sessionStorage.clear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
});

it("polls while payment is pending, then shows the confirmed order and clears the cart", async () => {
  jest.useFakeTimers();
  rememberPendingOrder("WEB-000001");
  mockOrderStatus
    .mockResolvedValueOnce(order("pending_payment"))
    .mockResolvedValueOnce(order("pending_payment"))
    .mockResolvedValue(order("paid"));
  renderAt("/order/WEB-000001?t=tok_abc");

  expect(await screen.findByText("Confirming your payment…")).toBeInTheDocument();
  await act(async () => {
    jest.advanceTimersByTime(POLL_INTERVAL_MS);
  });
  await act(async () => {
    jest.advanceTimersByTime(POLL_INTERVAL_MS);
  });
  expect(await screen.findByText("Payment received — order confirmed")).toBeInTheDocument();
  expect(mockOrderStatus).toHaveBeenCalledTimes(3);
  expect(mockOrderStatus).toHaveBeenCalledWith({ orderRef: "WEB-000001", accessToken: "tok_abc" });
  expect(screen.getByText(/Save your order number/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /track an order/i })).toHaveAttribute("href", "/track");
  expect(mockClearCart).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(POLL_INTERVAL_MS * 3);
  });
  expect(mockOrderStatus).toHaveBeenCalledTimes(3);
});

it("stops polling after two minutes and says it is still confirming", async () => {
  jest.useFakeTimers();
  mockOrderStatus.mockResolvedValue(order("pending_payment"));
  renderAt("/order/WEB-000001?t=tok");
  await screen.findByText("Confirming your payment…");
  for (let i = 0; i < 45; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MS);
    });
  }
  expect(mockOrderStatus).toHaveBeenCalledTimes(40);
  expect(screen.getByText("Still confirming your payment")).toBeInTheDocument();
});

it("shows the failed state", async () => {
  mockOrderStatus.mockResolvedValue(order("payment_failed"));
  renderAt("/order/WEB-000001?t=tok");
  expect(await screen.findByText("Payment didn't go through")).toBeInTheDocument();
  expect(mockClearCart).not.toHaveBeenCalled();
});

it("shows the expired state", async () => {
  mockOrderStatus.mockResolvedValue(order("expired"));
  renderAt("/order/WEB-000001?t=tok");
  expect(await screen.findByText("This order expired before payment was completed")).toBeInTheDocument();
});

it("shows totals and a leftover voucher, and no save-number note when signed in", async () => {
  mockAuth.mockReturnValue({ user: { id: "u1" } });
  mockOrderStatus.mockResolvedValue(order("paid", { leftoverVoucher: { code: "ABCDEFGHJKLMNPQR", value: 1920 } }));
  renderAt("/order/WEB-000001");
  expect(await screen.findByText("Payment received — order confirmed")).toBeInTheDocument();
  expect(mockOrderStatus).toHaveBeenCalledWith({ orderRef: "WEB-000001", accessToken: undefined });
  expect(screen.getByText("ABCDEFGHJKLMNPQR")).toBeInTheDocument();
  expect(screen.getByText(/₹1,920 left on your voucher/)).toBeInTheDocument();
  expect(screen.getByText("₹3,080")).toBeInTheDocument();
  expect(screen.queryByText(/Save your order number/)).not.toBeInTheDocument();
  // Opened without a pending checkout marker: the cart is left alone.
  expect(mockClearCart).not.toHaveBeenCalled();
});

it("says not found for an unknown ref or bad token", async () => {
  mockOrderStatus.mockRejectedValue(new OrdersApiError("not found", { status: 404 }));
  renderAt("/order/WEB-000404?t=bad");
  expect(await screen.findByText("We couldn't find that order")).toBeInTheDocument();
});

it("shows a ready store-pickup order with the shop address and no courier link", async () => {
  mockOrderStatus.mockResolvedValue(
    order("ready_for_pickup", { fulfilment: "pickup", totals: { subtotal: 3000, promoDiscount: 0, shipping: 0, voucherApplied: 0, creditApplied: 0, gatewayAmount: 3000 } })
  );
  renderAt("/order/WEB-000001?t=tok");
  expect(await screen.findByText("Payment received — order confirmed")).toBeInTheDocument();
  expect(screen.getByText(/ready at our shop: 58 Sihani Gate Market/)).toBeInTheDocument();
  expect(screen.getByText("Free (store pickup)")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /track with the courier/i })).not.toBeInTheDocument();
});
