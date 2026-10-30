import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import CheckoutPage from "../pages/CheckoutPage";
import { OrdersApiError } from "../lib/ordersApi";

jest.mock("../components/FreeShippingNudge", () => ({ amount }) =>
  require("react").createElement("div", { "data-testid": "free-shipping-nudge", "data-amount": amount })
);
const mockUseCart = jest.fn();
jest.mock("../context/CartContext", () => ({ useCart: () => mockUseCart() }));
const mockAuth = jest.fn();
jest.mock("../context/StorefrontAuthContext", () => ({ useStorefrontAuth: () => mockAuth() }));

const mockApi = {
  getCheckoutLive: jest.fn(),
  quote: jest.fn(),
  createOrder: jest.fn(),
  loadCashfree: jest.fn(),
  fetchMyCustomer: jest.fn(),
  newAttemptKey: jest.fn(),
};
jest.mock("../lib/ordersApi", () => ({
  ...jest.requireActual("../lib/ordersApi"),
  getCheckoutLive: (...a) => mockApi.getCheckoutLive(...a),
  quote: (...a) => mockApi.quote(...a),
  createOrder: (...a) => mockApi.createOrder(...a),
  loadCashfree: (...a) => mockApi.loadCashfree(...a),
  fetchMyCustomer: (...a) => mockApi.fetchMyCustomer(...a),
  newAttemptKey: (...a) => mockApi.newAttemptKey(...a),
}));


const ITEM = { variant_id: "v1", product_id: "BC1", quantity: 2, name: "Silk Saree", size: "FREE", color: "Red", price: 1500, image_url: null };
const ATTEMPT_KEY = "11111111-2222-4333-8444-555555555555";

function quoteResponse(over = {}) {
  const { quote: quoteOver, ...rest } = over;
  return {
    live: true,
    quote: {
      lines: [{ variantId: "v1", productId: "BC1", name: "Silk Saree", size: "FREE", color: "Red", unitPrice: 1500, qty: 2, promoShare: 0, paidValue: 3000 }],
      subtotal: 3000, promoDiscount: 0, shipping: 80, voucherApplied: 0, creditApplied: 0,
      gatewayAmount: 3080, amountDue: 3080, freeShippingGap: 2000,
      ...quoteOver,
    },
    pincode: { ok: true, inUp: true },
    shippingSource: "rate",
    code: null,
    creditAvailable: 0,
    unavailable: [],
    ...rest,
  };
}

function OrderRoute() {
  const location = useLocation();
  return <div data-testid="order-route">{location.pathname + location.search}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/checkout"]}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order/:ref" element={<OrderRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

function fillAddress(pincode = "201001", state = "Uttar Pradesh") {
  userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
  userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
  userEvent.type(screen.getByPlaceholderText(/address line 1/i), "58 Sihani Gate Market");
  userEvent.type(screen.getByPlaceholderText(/^city$/i), "Ghaziabad");
  userEvent.selectOptions(screen.getByRole("combobox"), state);
  userEvent.type(screen.getByPlaceholderText(/pincode/i), pincode);
}

beforeEach(() => {
  mockUseCart.mockReturnValue({ items: [ITEM] });
  mockAuth.mockReturnValue({ user: null });
  mockApi.getCheckoutLive.mockResolvedValue(true);
  mockApi.quote.mockImplementation(async () => quoteResponse());
  mockApi.fetchMyCustomer.mockResolvedValue(null);
  mockApi.newAttemptKey.mockReturnValue(ATTEMPT_KEY);
});

it("shows server totals and a Pay button with the gateway amount", async () => {
  renderPage();
  expect(await screen.findByTestId("quote-shipping")).toHaveTextContent("Enter your pincode");
  // No hidden shipping: without a pincode the total is unknown too.
  expect(screen.getByTestId("quote-to-pay")).toHaveTextContent("Enter your pincode");
  expect(screen.queryByRole("link", { name: /whatsapp/i })).not.toBeInTheDocument();
  fillAddress();
  await waitFor(() => expect(screen.getByTestId("quote-shipping")).toHaveTextContent("₹80"));
  expect(screen.getByTestId("quote-to-pay")).toHaveTextContent("₹3,080");
  const pay = await screen.findByRole("button", { name: "Pay ₹3,080" });
  expect(screen.queryByText(/We usually deliver within Uttar Pradesh/)).not.toBeInTheDocument();
  await waitFor(() => expect(pay).toBeEnabled());
  expect(mockApi.quote).toHaveBeenLastCalledWith({ items: [{ variantId: "v1", qty: 2 }], fulfilment: "ship", pincode: "201001" });
});

it("shows Calculating… instead of a stale figure while a re-quote is in flight", async () => {
  renderPage();
  await screen.findByTestId("quote-shipping");
  let release;
  mockApi.quote.mockImplementation(() => new Promise((resolve) => { release = () => resolve(quoteResponse()); }));
  fillAddress();
  await waitFor(() => expect(screen.getByTestId("quote-shipping")).toHaveTextContent("Calculating…"));
  expect(screen.getByTestId("quote-to-pay")).toHaveTextContent("Calculating…");
  await waitFor(() => expect(release).toBeDefined());
  release();
  await waitFor(() => expect(screen.getByTestId("quote-shipping")).toHaveTextContent("₹80"));
  expect(screen.getByTestId("quote-to-pay")).toHaveTextContent("₹3,080");
});

it("labels flat-rate shipping as the standard rate", async () => {
  mockApi.quote.mockImplementation(async () => quoteResponse({ shippingSource: "flat", quote: { shipping: 99, gatewayAmount: 3099 } }));
  renderPage();
  fillAddress();
  expect(await screen.findByText("Standard rate")).toBeInTheDocument();
  expect(screen.getByTestId("quote-shipping")).toHaveTextContent("₹99");
});

it("passes subtotal minus promo discount to the free-shipping nudge", async () => {
  mockApi.quote.mockImplementation(async () => quoteResponse({ quote: { promoDiscount: 300 } }));
  renderPage();
  await waitFor(() => expect(screen.getByTestId("free-shipping-nudge")).toHaveAttribute("data-amount", "2700"));
});

it("shows code messages and lets an applied code be removed", async () => {
  mockApi.quote.mockImplementation(async (p) => {
    if (p.code === "BAD") return quoteResponse({ code: { status: "invalid" } });
    if (p.code === "SLOW") return quoteResponse({ code: { status: "rate_limited" } });
    if (p.code === "GOOD") return quoteResponse({ code: { status: "ok", kind: "promo" }, quote: { promoDiscount: 300, gatewayAmount: 2780 } });
    return quoteResponse();
  });
  renderPage();
  await screen.findByTestId("quote-to-pay");
  const box = screen.getByLabelText(/gift card \/ promo code/i);

  userEvent.type(box, "BAD");
  userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("That code isn't valid")).toBeInTheDocument();

  userEvent.clear(box);
  userEvent.type(box, "SLOW");
  userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("Too many attempts, try later")).toBeInTheDocument();

  userEvent.clear(box);
  userEvent.type(box, "GOOD");
  userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("Code applied")).toBeInTheDocument();
  expect(screen.getByTestId("quote-promo")).toHaveTextContent("−₹300");

  userEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.queryByText("Code applied")).not.toBeInTheDocument();
  await waitFor(() => expect(mockApi.quote).toHaveBeenLastCalledWith({ items: [{ variantId: "v1", qty: 2 }], fulfilment: "ship" }));
});

it("shows the leftover-voucher note the server sends", async () => {
  mockApi.quote.mockImplementation(async (p) =>
    p.code
      ? quoteResponse({
          code: { status: "ok", kind: "voucher", message: "₹1,920 left on your voucher will be emailed to you" },
          quote: { voucherApplied: 3080, gatewayAmount: 0, amountDue: 0 },
        })
      : quoteResponse()
  );
  renderPage();
  await screen.findByTestId("quote-to-pay");
  userEvent.type(screen.getByLabelText(/gift card/i), "VOUCHER5000ABCD");
  userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("₹1,920 left on your voucher will be emailed to you")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Place order" })).toBeInTheDocument();
});

it("caps store credit at the available balance for a signed-in shopper", async () => {
  mockAuth.mockReturnValue({ user: { id: "u1", email: "asha@example.com" } });
  mockApi.fetchMyCustomer.mockResolvedValue({ first_name: "Asha", last_name: "K", phone: "9876543210", address: "12 MG Road" });
  mockApi.quote.mockImplementation(async (p) =>
    quoteResponse({ creditAvailable: 700, quote: { creditApplied: p.creditRequested ?? 0, gatewayAmount: 3080 - (p.creditRequested ?? 0) } })
  );
  renderPage();
  expect(await screen.findByDisplayValue("Asha K")).toBeInTheDocument();
  expect(screen.getByDisplayValue("asha@example.com")).toBeInTheDocument();
  const credit = await screen.findByLabelText(/use store credit/i);
  userEvent.type(credit, "900");
  expect(credit).toHaveValue(700);
  await waitFor(() => expect(mockApi.quote).toHaveBeenLastCalledWith(expect.objectContaining({ creditRequested: 700 })));
  expect(await screen.findByTestId("quote-credit")).toHaveTextContent("−₹700");
});

it("hides store credit for guests", async () => {
  mockApi.quote.mockImplementation(async () => quoteResponse({ creditAvailable: 700 }));
  renderPage();
  await screen.findByTestId("quote-to-pay");
  expect(screen.queryByLabelText(/use store credit/i)).not.toBeInTheDocument();
});

it("accepts an address outside Uttar Pradesh with a soft note and Pay enabled", async () => {
  mockApi.quote.mockImplementation(async (p) =>
    p.pincode ? quoteResponse({ pincode: { ok: true, inUp: false } }) : quoteResponse({ pincode: null })
  );
  renderPage();
  fillAddress("400001", "Maharashtra");
  expect(
    await screen.findByText(
      "We usually deliver within Uttar Pradesh. For other states we'll confirm delivery with you on WhatsApp before dispatch."
    )
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Pay ₹3,080" })).toBeEnabled());
});

it("shows the soft note when the pincode is outside UP even if the state says UP", async () => {
  mockApi.quote.mockImplementation(async (p) =>
    p.pincode ? quoteResponse({ pincode: { ok: true, inUp: false } }) : quoteResponse({ pincode: null })
  );
  renderPage();
  fillAddress("247001");
  expect(await screen.findByText(/We usually deliver within Uttar Pradesh\./)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Pay ₹3,080" })).toBeEnabled());
});

it("warns about unavailable items and blocks payment", async () => {
  mockApi.quote.mockImplementation(async () => quoteResponse({ unavailable: [{ variantId: "v1", available: 1 }] }));
  renderPage();
  fillAddress();
  expect(await screen.findByText(/Only 1 left of Silk Saree \(FREE\/Red\)/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /pay ₹/i })).toBeDisabled();
});

it("navigates to the order page when credit or a voucher covered everything", async () => {
  mockApi.quote.mockImplementation(async () => quoteResponse({ quote: { gatewayAmount: 0, amountDue: 0, voucherApplied: 3080 } }));
  mockApi.createOrder.mockResolvedValue({ orderRef: "WEB-000001", accessToken: "tok_abc", paymentSessionId: null, cashfreeMode: "sandbox", paid: true });
  renderPage();
  fillAddress();
  const place = await screen.findByRole("button", { name: "Place order" });
  await waitFor(() => expect(place).toBeEnabled());
  userEvent.click(place);
  expect(await screen.findByTestId("order-route")).toHaveTextContent("/order/WEB-000001?t=tok_abc");
  expect(mockApi.loadCashfree).not.toHaveBeenCalled();
  expect(mockApi.createOrder).toHaveBeenCalledWith({
    attemptKey: ATTEMPT_KEY,
    items: [{ variantId: "v1", qty: 2 }],
    fulfilment: "ship",
    address: { name: "Priya Sharma", phone: "9810873280", line1: "58 Sihani Gate Market", city: "Ghaziabad", state: "Uttar Pradesh", pincode: "201001" },
  });
});

it("opens Cashfree checkout and reuses the attempt key on retry", async () => {
  const checkout = jest.fn().mockResolvedValue({});
  mockApi.loadCashfree.mockResolvedValue({ checkout });
  mockApi.createOrder
    .mockRejectedValueOnce(new OrdersApiError("gateway", { code: "gateway_error", status: 502 }))
    .mockResolvedValueOnce({ orderRef: "WEB-000002", accessToken: "tok", paymentSessionId: "session_123", cashfreeMode: "sandbox", paid: false });
  renderPage();
  fillAddress();
  const pay = await screen.findByRole("button", { name: "Pay ₹3,080" });
  await waitFor(() => expect(pay).toBeEnabled());
  userEvent.click(pay);
  expect(await screen.findByText("We couldn't start the payment. Please try again.")).toBeInTheDocument();
  await waitFor(() => expect(pay).toBeEnabled());
  userEvent.click(pay);
  await waitFor(() => expect(checkout).toHaveBeenCalledWith({ paymentSessionId: "session_123", redirectTarget: "_self" }));
  expect(mockApi.loadCashfree).toHaveBeenCalledWith("sandbox");
  expect(mockApi.createOrder).toHaveBeenCalledTimes(2);
  expect(mockApi.createOrder.mock.calls.map((c) => c[0].attemptKey)).toEqual([ATTEMPT_KEY, ATTEMPT_KEY]);
  expect(mockApi.newAttemptKey).toHaveBeenCalledTimes(1);
});

it("re-quotes and asks for review when prices changed", async () => {
  mockApi.createOrder.mockRejectedValue(new OrdersApiError("price", { code: "price_changed", status: 409 }));
  renderPage();
  fillAddress();
  const pay = await screen.findByRole("button", { name: "Pay ₹3,080" });
  await waitFor(() => expect(pay).toBeEnabled());
  const before = mockApi.quote.mock.calls.length;
  mockApi.quote.mockImplementation(async () => quoteResponse({ quote: { subtotal: 3200, gatewayAmount: 3280 } }));
  userEvent.click(pay);
  expect(await screen.findByText("Prices updated, please review")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Pay ₹3,280" })).toBeInTheDocument();
  expect(mockApi.quote.mock.calls.length).toBeGreaterThan(before);
});

it("falls back to the WhatsApp flow when the server says checkout is off", async () => {
  mockApi.quote.mockResolvedValue({ live: false });
  renderPage();
  expect(await screen.findByRole("button", { name: /complete your order on whatsapp/i })).toBeInTheDocument();
});

function pickupQuote(over = {}) {
  return quoteResponse({ pincode: null, shippingSource: "pickup", quote: { shipping: 0, gatewayAmount: 3000, amountDue: 3000, freeShippingGap: 0 }, ...over });
}

describe("store pickup", () => {
  beforeEach(() => {
    mockApi.quote.mockImplementation(async (p) => (p.fulfilment === "pickup" ? pickupQuote() : quoteResponse()));
  });

  it("hides the address, re-quotes for pickup and shows free store-pickup shipping", async () => {
    renderPage();
    await screen.findByTestId("quote-shipping");
    expect(screen.getByRole("radio", { name: /ship to me/i })).toBeChecked();
    expect(screen.getByTestId("free-shipping-nudge")).toBeInTheDocument();

    userEvent.click(screen.getByRole("radio", { name: /pick up at the shop/i }));
    expect(screen.queryByPlaceholderText(/address line 1/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/pincode/i)).not.toBeInTheDocument();
    expect(screen.getByText("58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("quote-shipping")).toHaveTextContent("Free (store pickup)"));
    expect(screen.getByTestId("quote-to-pay")).toHaveTextContent("₹3,000");
    expect(screen.queryByTestId("free-shipping-nudge")).not.toBeInTheDocument();
    expect(mockApi.quote).toHaveBeenLastCalledWith({ items: [{ variantId: "v1", qty: 2 }], fulfilment: "pickup" });

    userEvent.click(screen.getByRole("radio", { name: /ship to me/i }));
    expect(screen.getByPlaceholderText(/address line 1/i)).toBeInTheDocument();
    await waitFor(() => expect(mockApi.quote).toHaveBeenLastCalledWith({ items: [{ variantId: "v1", qty: 2 }], fulfilment: "ship" }));
  });

  it("enables Pay with only name and phone, and sends no address lines", async () => {
    const checkout = jest.fn().mockResolvedValue({});
    mockApi.loadCashfree.mockResolvedValue({ checkout });
    mockApi.createOrder.mockResolvedValue({ orderRef: "WEB-000003", accessToken: "tok", paymentSessionId: "session_9", cashfreeMode: "sandbox", paid: false });
    renderPage();
    // userEvent fires synchronously; let react-hook-form's mount-time validity
    // check (ship branch) resolve first, or its stale result lands last.
    await screen.findByTestId("quote-shipping");
    userEvent.click(screen.getByRole("radio", { name: /pick up at the shop/i }));
    userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
    userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
    const pay = await screen.findByRole("button", { name: "Pay ₹3,000" });
    await waitFor(() => expect(pay).toBeEnabled());
    userEvent.click(pay);
    await waitFor(() => expect(checkout).toHaveBeenCalledWith({ paymentSessionId: "session_9", redirectTarget: "_self" }));
    expect(mockApi.createOrder).toHaveBeenCalledWith({
      attemptKey: ATTEMPT_KEY,
      items: [{ variantId: "v1", qty: 2 }],
      fulfilment: "pickup",
      address: { name: "Priya Sharma", phone: "9810873280" },
    });
  });

  it("keeps Pay disabled until the quote on screen is a pickup quote", async () => {
    // A server that ignores `fulfilment` answers with a ship quote and no pincode.
    mockApi.quote.mockImplementation(async () => quoteResponse({ pincode: null }));
    renderPage();
    // userEvent fires synchronously; let react-hook-form's mount-time validity
    // check (ship branch) resolve first, or its stale result lands last.
    await screen.findByTestId("quote-shipping");
    userEvent.click(screen.getByRole("radio", { name: /pick up at the shop/i }));
    userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
    userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
    await waitFor(() => expect(mockApi.quote).toHaveBeenLastCalledWith(expect.objectContaining({ fulfilment: "pickup" })));
    await waitFor(() => expect(screen.getByTestId("quote-to-pay")).not.toHaveTextContent("Calculating…"));
    expect(screen.getByRole("button", { name: /pay ₹/i })).toBeDisabled();
  });
});
