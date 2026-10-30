import { supabase } from "lib/supabaseClient";

// Storefront side of the online-orders HTTP contract
// (docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md).
// Every money figure comes from the server; nothing here prices an order.

export const WHATSAPP_URL = "https://wa.me/919810873280";
const CASHFREE_SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

// Non-2xx responses carry `{ error, code }`. `code` drives UI messages;
// `status` lets callers tell "not found" (404) from other failures.
export class OrdersApiError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = "OrdersApiError";
    this.code = code;
    this.status = status;
  }
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;
  // FunctionsHttpError keeps the Response in `context`; relay/fetch errors
  // have no response, so they surface as code "network".
  const response = error.context;
  if (response && typeof response.json === "function") {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new OrdersApiError(`${name} failed with HTTP ${response.status} (unreadable body)`, {
        status: response.status,
      });
    }
    throw new OrdersApiError(payload?.error || `${name} failed with HTTP ${response.status}`, {
      code: payload?.code ?? null,
      status: response.status,
    });
  }
  throw new OrdersApiError(error.message || `${name} failed`, { code: "network" });
}

// Fails closed: if the switch can't be read, the shop keeps the WhatsApp flow.
export async function getCheckoutLive() {
  const { data, error } = await supabase
    .from("storefront_settings")
    .select("checkout_live")
    .eq("id", 1)
    .single();
  if (error) {
    console.warn("storefront_settings read failed; using WhatsApp checkout", error);
    return false;
  }
  return data?.checkout_live === true;
}

export function quote(payload) {
  return invoke("checkout-quote", payload);
}

export function createOrder(payload) {
  return invoke("create-order", payload);
}

export function orderStatus({ orderRef, accessToken }) {
  return invoke("order-status", accessToken ? { orderRef, accessToken } : { orderRef });
}

export function refundPreview(token) {
  return invoke("refund-choice", { token, action: "preview" });
}

export function refundChoose(token, choice) {
  return invoke("refund-choice", { token, action: "choose", choice });
}

export async function fetchMyCustomer() {
  const { data, error } = await supabase.rpc("resolve_my_customer");
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

// SQL (snake_case `_order_public_json`) → the order-status response shape.
export function normalizeOrder(row) {
  if (!row) return null;
  return {
    orderRef: row.order_ref,
    status: row.status,
    fulfilment: row.fulfilment ?? "ship",
    createdAt: row.created_at ?? null,
    paidAt: row.paid_at ?? null,
    items: (row.items ?? []).map((i) => ({
      name: i.name,
      size: i.size,
      color: i.color,
      qty: i.qty,
      status: i.status,
      refundedQty: i.refunded_qty ?? 0,
    })),
    totals: {
      subtotal: Number(row.subtotal ?? 0),
      promoDiscount: Number(row.promo_discount ?? 0),
      shipping: Number(row.shipping ?? 0),
      voucherApplied: Number(row.voucher_applied ?? 0),
      creditApplied: Number(row.credit_applied ?? 0),
      gatewayAmount: Number(row.gateway_amount ?? 0),
    },
    trackingUrl: row.tracking_url ?? null,
    courier: row.courier ?? null,
    courierName: row.courier_name ?? null,
    awb: row.awb ?? null,
    leftoverVoucher: null,
  };
}

export async function lookupOrder(orderRef, phone) {
  const { data, error } = await supabase.rpc("online_order_lookup", {
    p_order_ref: orderRef,
    p_phone: phone,
  });
  if (error) throw error;
  return normalizeOrder(data);
}

export async function myOrders() {
  const { data, error } = await supabase.rpc("my_online_orders");
  if (error) throw error;
  // `returns setof jsonb` arrives as bare objects, or wrapped under the
  // function name depending on the PostgREST version.
  return (data ?? [])
    .map((row) => normalizeOrder(row?.my_online_orders ?? row))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

let cashfreeScript = null;

// Loads Cashfree's v3 SDK once (no npm dependency) and returns an instance.
export function loadCashfree(mode) {
  if (!cashfreeScript) {
    cashfreeScript = new Promise((resolve, reject) => {
      if (window.Cashfree) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = CASHFREE_SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        cashfreeScript = null;
        reject(new OrdersApiError("Could not load the payment page", { code: "sdk_load_failed" }));
      };
      document.head.appendChild(script);
    });
  }
  return cashfreeScript.then(() => window.Cashfree({ mode }));
}

// Test seam: lets a test start from "script not yet injected".
export function resetCashfreeLoaderForTests() {
  cashfreeScript = null;
}

// ₹ amounts: whole rupees without decimals, otherwise 2 dp.
export function formatRupees(amount) {
  const n = Number(amount) || 0;
  return Number.isInteger(n)
    ? n.toLocaleString("en-IN")
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function newAttemptKey() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  const b = window.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CREATE_ORDER_MESSAGES = {
  checkout_off: "Online checkout is paused right now. Please complete your order on WhatsApp.",
  price_changed: "Prices updated, please review",
  out_of_stock: "Some items just sold out. Please review your order.",
  invalid_address: "Please check your address details.",
  invalid_code: "That code isn't valid",
  rate_limited: "Too many attempts, try later",
  gateway_error: "We couldn't start the payment. Please try again.",
  sdk_load_failed: "We couldn't open the payment page. Please check your connection and try again.",
};

export function createOrderMessage(code) {
  return CREATE_ORDER_MESSAGES[code] ?? "Something went wrong. Please try again or WhatsApp us.";
}
