jest.mock("lib/supabaseClient", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn(), from: jest.fn() },
}));

import { supabase } from "lib/supabaseClient";
import {
  OrdersApiError,
  createOrder,
  createOrderMessage,
  formatRupees,
  getCheckoutLive,
  loadCashfree,
  lookupOrder,
  myOrders,
  orderStatus,
  refundChoose,
  resetCashfreeLoaderForTests,
} from "../lib/ordersApi";

function httpError(status, body) {
  return { context: { status, json: async () => body }, message: "Edge Function returned a non-2xx status code" };
}

const ROW = {
  order_ref: "WEB-000001", status: "shipped", created_at: "2026-10-20T10:00:00Z", paid_at: null,
  subtotal: 3000, promo_discount: 0, shipping: 80, voucher_applied: 0, credit_applied: 0, gateway_amount: 3080,
  courier_name: "Delhivery", awb: "123", tracking_url: "https://shiprocket.co/tracking/123",
  items: [{ name: "Silk Saree", size: "FREE", color: "Red", qty: 2, unit_price: 1500, status: "shipped", refunded_qty: 0 }],
};

it("invokes create-order and returns its body", async () => {
  supabase.functions.invoke.mockResolvedValue({ data: { orderRef: "WEB-000001" }, error: null });
  await expect(createOrder({ attemptKey: "k" })).resolves.toEqual({ orderRef: "WEB-000001" });
  expect(supabase.functions.invoke).toHaveBeenCalledWith("create-order", { body: { attemptKey: "k" } });
});

it("turns a non-2xx body into an OrdersApiError carrying code and status", async () => {
  supabase.functions.invoke.mockResolvedValue({ data: null, error: httpError(409, { error: "Prices changed", code: "price_changed" }) });
  const err = await createOrder({}).catch((e) => e);
  expect(err).toBeInstanceOf(OrdersApiError);
  expect(err.code).toBe("price_changed");
  expect(err.status).toBe(409);
  expect(createOrderMessage(err.code)).toBe("Prices updated, please review");
});

it("marks a failure without a response as a network error", async () => {
  supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: "Failed to send a request" } });
  await expect(orderStatus({ orderRef: "WEB-1", accessToken: "t" })).rejects.toMatchObject({ code: "network" });
});

it("sends order-status with the access token, and refund choices with their action", async () => {
  supabase.functions.invoke.mockResolvedValue({ data: {}, error: null });
  await orderStatus({ orderRef: "WEB-1", accessToken: "tok" });
  expect(supabase.functions.invoke).toHaveBeenCalledWith("order-status", { body: { orderRef: "WEB-1", accessToken: "tok" } });
  await refundChoose("abc", "store_credit");
  expect(supabase.functions.invoke).toHaveBeenCalledWith("refund-choice", { body: { token: "abc", action: "choose", choice: "store_credit" } });
});

it("reads the live switch and fails closed on error", async () => {
  const single = jest.fn().mockResolvedValue({ data: { checkout_live: true }, error: null });
  supabase.from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
  await expect(getCheckoutLive()).resolves.toBe(true);
  single.mockResolvedValue({ data: null, error: { message: "boom" } });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  await expect(getCheckoutLive()).resolves.toBe(false);
});

it("normalises the lookup RPC to the order-status shape, null when not found", async () => {
  supabase.rpc.mockResolvedValue({ data: ROW, error: null });
  const order = await lookupOrder("web-000001", "9810873280");
  expect(supabase.rpc).toHaveBeenCalledWith("online_order_lookup", { p_order_ref: "web-000001", p_phone: "9810873280" });
  expect(order).toMatchObject({
    orderRef: "WEB-000001", status: "shipped", trackingUrl: "https://shiprocket.co/tracking/123",
    totals: { subtotal: 3000, shipping: 80, gatewayAmount: 3080 },
    items: [{ name: "Silk Saree", qty: 2, status: "shipped" }],
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
  await expect(lookupOrder("WEB-9", "1")).resolves.toBeNull();
});

it("lists my orders newest first, unwrapping setof jsonb rows", async () => {
  supabase.rpc.mockResolvedValue({
    data: [
      { my_online_orders: { ...ROW, order_ref: "WEB-000001", created_at: "2026-10-01T00:00:00Z" } },
      { my_online_orders: { ...ROW, order_ref: "WEB-000002", created_at: "2026-10-05T00:00:00Z" } },
    ],
    error: null,
  });
  const orders = await myOrders();
  expect(orders.map((o) => o.orderRef)).toEqual(["WEB-000002", "WEB-000001"]);
});

it("injects the Cashfree SDK once and returns an instance for the mode", async () => {
  resetCashfreeLoaderForTests();
  delete window.Cashfree;
  const instance = { checkout: jest.fn() };
  const first = loadCashfree("sandbox");
  const scripts = document.querySelectorAll('script[src="https://sdk.cashfree.com/js/v3/cashfree.js"]');
  expect(scripts).toHaveLength(1);
  window.Cashfree = jest.fn(() => instance);
  scripts[0].onload();
  await expect(first).resolves.toBe(instance);
  await loadCashfree("production");
  expect(document.querySelectorAll('script[src="https://sdk.cashfree.com/js/v3/cashfree.js"]')).toHaveLength(1);
  expect(window.Cashfree).toHaveBeenLastCalledWith({ mode: "production" });
});

it("formats rupees without decimals for whole amounts", () => {
  expect(formatRupees(3080)).toBe("3,080");
  expect(formatRupees(99.5)).toBe("99.50");
});
