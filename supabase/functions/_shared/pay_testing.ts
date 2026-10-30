/** Test doubles for the Pay slice (Store, Cashfree, Shiprocket, deps). No network, no database. */

import type { AppDeps, AppEnv, OrderItemRow, OrderRow, Store, VariantRow } from "./context.ts";
import { DbError } from "./context.ts";
import {
  type CashfreeClient,
  CashfreeError,
  type CfOrder,
  type CfPayment,
  type CfRefund,
  type CreateOrderInput,
  verifyCashfreeSignature,
} from "./cashfree.ts";
import type { RateQuote, ShiprocketClient } from "./shiprocket.ts";

export const ANON_KEY = "anon-key";
export const SERVICE_KEY = "service-key";
export const CRON_SECRET = "cron-secret";
export const WEBHOOK_SECRET = "cf-secret";
export const ORIGIN = "https://www.bindalscreations.com";

export const V1 = "11111111-1111-4111-8111-111111111111";
export const V2 = "22222222-2222-4222-8222-222222222222";
export const ATTEMPT = "33333333-3333-4333-8333-333333333333";
export const USER = "44444444-4444-4444-8444-444444444444";

export const testEnv: AppEnv = {
  supabaseUrl: "https://proj.supabase.co",
  serviceRoleKey: SERVICE_KEY,
  anonKey: ANON_KEY,
  allowedOrigins: [ORIGIN],
  siteUrl: "https://www.bindalscreations.com",
  ipHashSalt: "salt",
  cronSecret: CRON_SECRET,
  cashfreeMode: "sandbox",
  shopEmail: "shop@example.com",
};

export function variant(over: Partial<VariantRow> = {}): VariantRow {
  return {
    variantId: V1,
    productId: "BC25001",
    name: "Silk Kurti",
    size: "M",
    color: "Red",
    stock: 5,
    retailPrice: 1000,
    categoryId: "KUR",
    categoryName: "Kurti",
    ...over,
  };
}

export function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o-1",
    order_ref: "WEB-000001",
    attempt_key: ATTEMPT,
    status: "pending_payment",
    fulfilment: "ship",
    customerid: 7,
    auth_user_id: null,
    contact_name: "Asha Gupta",
    contact_phone: "+919876543210",
    contact_email: "asha@example.com",
    address: { line1: "1 MG Road", city: "Ghaziabad", state: "Uttar Pradesh", pincode: "201001" },
    subtotal: 1000,
    promo_discount: 0,
    shipping: 80,
    voucher_applied: 0,
    credit_applied: 0,
    gateway_amount: 1080,
    cf_order_id: "cf-1",
    cf_payment_id: null,
    awb: null,
    courier: null,
    courier_name: null,
    manual_tracking_url: null,
    leftover_voucher_id: null,
    problem: null,
    created_at: "2026-10-23T10:00:00Z",
    ...over,
  };
}

export function item(over: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: "i-1",
    line_no: 1,
    product_name: "Silk Kurti",
    size: "M",
    color: "Red",
    qty: 1,
    unit_price: 1000,
    paid_value: 1000,
    status: "ordered",
    refunded_qty: 0,
    ...over,
  };
}

export type RpcCall = { fn: string; args: Record<string, unknown> };
type RpcImpl = (args: Record<string, unknown>) => unknown;

export class FakeStore implements Store {
  live = true;
  variantRows: VariantRow[] = [variant()];
  credit = new Map<string, number>();
  orders: OrderRow[] = [];
  items = new Map<string, OrderItemRow[]>();
  vouchers = new Map<string, number>();
  tokenHashes = new Map<string, string>();
  statusFailures = new Map<string, number>();
  calls: RpcCall[] = [];
  impls: Record<string, RpcImpl> = {};

  constructor(impls: Record<string, RpcImpl> = {}) {
    this.impls = impls;
  }

  callsTo(fn: string): Record<string, unknown>[] {
    return this.calls.filter((c) => c.fn === fn).map((c) => c.args);
  }

  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ fn, args });
    const impl = this.impls[fn];
    if (!impl) return Promise.resolve(null as T);
    try {
      return Promise.resolve(impl(args) as T);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  checkoutLive() {
    return Promise.resolve(this.live);
  }
  variants(ids: string[]) {
    return Promise.resolve(this.variantRows.filter((v) => ids.includes(v.variantId)));
  }
  creditBalance(authUserId: string) {
    return Promise.resolve(this.credit.has(authUserId) ? this.credit.get(authUserId)! : null);
  }
  orderByRef(ref: string) {
    return Promise.resolve(this.orders.find((o) => o.order_ref === ref) ?? null);
  }
  orderByAttemptKey(key: string) {
    return Promise.resolve(this.orders.find((o) => o.attempt_key === key) ?? null);
  }
  orderById(id: string) {
    return Promise.resolve(this.orders.find((o) => o.id === id) ?? null);
  }
  orderItems(orderId: string) {
    return Promise.resolve(this.items.get(orderId) ?? []);
  }
  voucherValue(code: string) {
    return Promise.resolve(this.vouchers.get(code) ?? null);
  }
  setAccessTokenHash(orderId: string, hash: string) {
    this.tokenHashes.set(orderId, hash);
    return Promise.resolve();
  }
  recentStatusFailures(key: string) {
    return Promise.resolve(this.statusFailures.get(key) ?? 0);
  }
  recordStatusFailure(key: string) {
    this.statusFailures.set(key, (this.statusFailures.get(key) ?? 0) + 1);
    return Promise.resolve();
  }
}

export const dbRaise = (message: string, code: string | null = "P0001") => () => {
  throw new DbError(message, code);
};

export class FakeCashfree implements CashfreeClient {
  orders = new Map<string, CfOrder>();
  payments = new Map<string, CfPayment[]>();
  refunds = new Map<string, CfRefund>();
  created: CreateOrderInput[] = [];
  createdRefunds: { orderRef: string; refundId: string; amount: number }[] = [];
  getOrderCalls = 0;
  createError: Error | null = null;

  createOrder(input: CreateOrderInput) {
    this.created.push(input);
    if (this.createError) return Promise.reject(this.createError);
    const o: CfOrder = {
      cfOrderId: `cf-${input.orderRef}`,
      orderRef: input.orderRef,
      status: "ACTIVE",
      amount: input.amount,
      currency: "INR",
      paymentSessionId: `session-${input.orderRef}`,
    };
    this.orders.set(input.orderRef, o);
    return Promise.resolve({ cfOrderId: o.cfOrderId, paymentSessionId: o.paymentSessionId!, status: o.status, recovered: false });
  }
  getOrder(orderRef: string) {
    this.getOrderCalls++;
    return Promise.resolve(this.orders.get(orderRef) ?? null);
  }
  getPayments(orderRef: string) {
    return Promise.resolve(this.payments.get(orderRef) ?? []);
  }
  createRefund(orderRef: string, refund: { refundId: string; amount: number; note?: string }) {
    this.createdRefunds.push({ orderRef, refundId: refund.refundId, amount: refund.amount });
    const r: CfRefund = { cfRefundId: `cfr-${refund.refundId}`, refundId: refund.refundId, status: "PENDING", amount: refund.amount };
    this.refunds.set(`${orderRef}/${refund.refundId}`, r);
    return Promise.resolve(r);
  }
  getRefund(orderRef: string, refundId: string) {
    return Promise.resolve(this.refunds.get(`${orderRef}/${refundId}`) ?? null);
  }
  verifyWebhook(rawBody: string, signature: string, timestamp: string) {
    return verifyCashfreeSignature(WEBHOOK_SECRET, rawBody, signature, timestamp);
  }

  /** Marks the Cashfree order PAID with one SUCCESS payment. */
  pay(o: OrderRow, cfPaymentId = "pay-1", amount = o.gateway_amount) {
    this.orders.set(o.order_ref, {
      cfOrderId: o.cf_order_id ?? `cf-${o.order_ref}`,
      orderRef: o.order_ref,
      status: "PAID",
      amount: o.gateway_amount,
      currency: "INR",
      paymentSessionId: null,
    });
    const list = this.payments.get(o.order_ref) ?? [];
    list.push({ cfPaymentId, status: "SUCCESS", amount, currency: "INR", time: `2026-10-23T10:0${list.length}:00Z` });
    this.payments.set(o.order_ref, list);
  }
}

export const definiteCfError = () => new CashfreeError(400, "order_amount_invalid", "POST /orders: bad amount");
export const ambiguousCfError = () => new CashfreeError(0, "timeout", "POST /orders: timed out");

export function fakeShiprocket(opts: { state?: string | null; rate?: RateQuote | null } = {}) {
  const calls = { postcode: [] as string[], rate: [] as { deliveryPincode: string; weightKg: number; declaredValue: number }[] };
  const notUsed = () => Promise.reject(new Error("not used in Pay tests"));
  const client: ShiprocketClient = {
    token: () => Promise.resolve("t"),
    postcodeState: (pc) => {
      calls.postcode.push(pc);
      return Promise.resolve(opts.state === undefined ? "Uttar Pradesh" : opts.state);
    },
    rate: (input) => {
      calls.rate.push(input);
      return Promise.resolve(
        opts.rate === undefined ? { rate: 73, courierId: 12, courierName: "Delhivery", etdDays: 3 } : opts.rate,
      );
    },
    createOrder: notUsed,
    updateOrder: notUsed,
    assignAwb: notUsed,
    pickup: notUsed,
    manifest: notUsed,
    label: notUsed,
    cancel: notUsed,
    cancelAwbs: notUsed,
    track: notUsed,
  };
  return { client, calls };
}

export function testDeps(
  over: Partial<AppDeps> = {},
): AppDeps & { store: FakeStore; cashfree: FakeCashfree; kicks: { n: number } } {
  const kicks = { n: 0 };
  const store = (over.store as FakeStore | undefined) ?? new FakeStore();
  const cashfree = (over.cashfree as FakeCashfree | undefined) ?? new FakeCashfree();
  return {
    shiprocket: fakeShiprocket().client,
    verifyJwt: (jwt) => Promise.resolve(jwt === "user.jwt" ? { id: USER } : null),
    env: testEnv,
    now: () => new Date("2026-10-23T10:00:00Z"),
    kickJobs: () => {
      kicks.n++;
    },
    ...over,
    store,
    cashfree,
    kicks,
  };
}

export function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "1.2.3.4", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function signedWebhook(body: unknown, secret = WEBHOOK_SECRET): Promise<Request> {
  const raw = JSON.stringify(body);
  const ts = "1729670000";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + raw)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return new Request("https://fn.test/cashfree-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": btoa(bin), "x-webhook-timestamp": ts },
    body: raw,
  });
}

/**
 * Mimics online_order_confirm_payment's contract: first payment confirms,
 * the same payment again is "already", a different payment on a paid order
 * is a duplicate, and an expired order whose holds are gone needs a refund.
 */
export function confirmLikeDb(store: FakeStore, opts: { holdsGone?: boolean } = {}) {
  return (args: Record<string, unknown>) => {
    const o = store.orders.find((x) => x.order_ref === args.p_order_ref) as OrderRow;
    const pay = args.p_cf_payment_id === "NO_GATEWAY" ? null : String(args.p_cf_payment_id);
    if (!["pending_payment", "expired", "payment_failed"].includes(o.status)) {
      if (o.cf_payment_id === pay) return { result: "already", status: o.status };
      return { result: "refund_required", reason: "duplicate_payment", amount: args.p_amount };
    }
    if (o.status === "expired" && (opts.holdsGone || o.cf_payment_id !== null)) {
      o.cf_payment_id = pay;
      return { result: "refund_required", reason: "holds_unavailable", amount: args.p_amount };
    }
    o.status = "paid";
    o.cf_payment_id = pay;
    return { result: "confirmed", status: "paid" };
  };
}

