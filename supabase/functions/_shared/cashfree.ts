/**
 * Cashfree Payment Gateway client (PG API, version pinned below).
 * Facts: docs/superpowers/specs/2026-10-23-api-notes-cashfree-gmail.md §1–6.
 * Plan: Task 3, R4 (only order_status PAID means paid), R6 (idempotent
 * create, reconcile with Get Order on an ambiguous failure).
 *
 * Errors: every non-2xx or transport failure becomes a CashfreeError.
 * `ambiguous` = the request may have taken effect (timeout, network error,
 * 5xx), so the caller must reconcile with a read before treating it as
 * failed. A 4xx is definite: Cashfree rejected it.
 *
 * Secrets: the client secret is sent only as a header and used as the
 * webhook HMAC key; it never appears in an error or a log line.
 */

import { type Delay, type FetchFn, fetchWithTimeout, realDelay, TimeoutError } from "./timeout.ts";

export const CASHFREE_API_VERSION = "2026-01-01";
export const CASHFREE_BASE_URL = {
  sandbox: "https://sandbox.cashfree.com/pg",
  production: "https://api.cashfree.com/pg",
} as const;
export const CASHFREE_TIMEOUT_MS = 15_000;
/** Cashfree's minimum order_amount (INR). */
export const CASHFREE_MIN_AMOUNT = 1;

export type CashfreeEnv = keyof typeof CASHFREE_BASE_URL;

export class CashfreeError extends Error {
  readonly ambiguous: boolean;
  constructor(
    /** HTTP status; 0 when no response arrived (timeout or network). */
    readonly status: number,
    /** Cashfree's `code` from the error body, or our own tag (`timeout`, `network`, `bad_response`). */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CashfreeError";
    this.ambiguous = status === 0 || status >= 500;
  }
}

/** customer_id must be alphanumeric, 3–50 chars (notes §2). */
export function cfCustomerId(customerid: number): string {
  if (!Number.isSafeInteger(customerid) || customerid <= 0) {
    throw new RangeError(`customerid must be a positive integer, got ${customerid}`);
  }
  // Pad so single-digit ids still meet the 3-char minimum ("C05").
  // Unambiguous: real ids never have a leading zero.
  return "C" + String(customerid).padStart(2, "0");
}

export type CfOrderStatus = "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED" | "TERMINATION_REQUESTED";
export type CfPaymentStatus =
  | "SUCCESS"
  | "NOT_ATTEMPTED"
  | "FAILED"
  | "USER_DROPPED"
  | "VOID"
  | "CANCELLED"
  | "PENDING";
export type CfRefundStatus =
  | "SUCCESS"
  | "PENDING"
  | "PENDING_APPROVAL"
  | "CANCELLED"
  | "ONHOLD"
  | "REJECTED";

export type CreateOrderInput = {
  orderRef: string;
  amount: number;
  customer: { id: number; name: string; phone: string; email: string | null };
  returnUrl: string;
  notifyUrl: string;
  expiresAt: Date;
  /** R6: the checkout attemptKey (UUID); same key on retry = no duplicate. */
  idempotencyKey: string;
};

export type CreatedOrder = {
  cfOrderId: string;
  paymentSessionId: string;
  status: CfOrderStatus;
  /** true when the create call failed ambiguously and Get Order found it. */
  recovered: boolean;
};

export type CfOrder = {
  cfOrderId: string;
  orderRef: string;
  status: CfOrderStatus;
  amount: number;
  currency: string;
  paymentSessionId: string | null;
};

export type CfPayment = {
  cfPaymentId: string;
  status: CfPaymentStatus;
  amount: number;
  currency: string;
  time: string | null;
};

export type CfRefund = {
  cfRefundId: string;
  refundId: string;
  status: CfRefundStatus;
  amount: number;
};

export type CashfreeClient = {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  /** null when Cashfree has no such order. */
  getOrder(orderRef: string): Promise<CfOrder | null>;
  getPayments(orderRef: string): Promise<CfPayment[]>;
  createRefund(
    orderRef: string,
    refund: { refundId: string; amount: number; note?: string },
  ): Promise<CfRefund>;
  /** null when Cashfree has no such refund. */
  getRefund(orderRef: string, refundId: string): Promise<CfRefund | null>;
  verifyWebhook(rawBody: string, signature: string, timestamp: string): Promise<boolean>;
};

export type CashfreeConfig = {
  clientId: string;
  clientSecret: string;
  env: CashfreeEnv;
  fetch: FetchFn;
  delay?: Delay;
  timeoutMs?: number;
};

const ORDER_REF_RE = /^[A-Za-z0-9_-]{3,45}$/;
const REFUND_ID_RE = /^[A-Za-z0-9_-]{3,40}$/;

/** Rounds to paise; Cashfree takes up to 2 decimals. */
export function toCfAmount(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError(`amount must be finite, got ${amount}`);
  return Math.round(amount * 100) / 100;
}

function assertRef(ref: string, re: RegExp, what: string): void {
  if (!re.test(ref)) throw new RangeError(`invalid ${what}: ${JSON.stringify(ref)}`);
}

export function createCashfree(config: CashfreeConfig): CashfreeClient {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Cashfree is not configured (client id/secret missing)");
  }
  const base = CASHFREE_BASE_URL[config.env];
  if (!base) throw new Error(`unknown Cashfree env: ${config.env}`);
  const delay = config.delay ?? realDelay;
  const timeoutMs = config.timeoutMs ?? CASHFREE_TIMEOUT_MS;

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": CASHFREE_API_VERSION,
      accept: "application/json",
    };
    // UNVERIFIED: the docs imply but never state application/json bodies.
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;

    let res: Response;
    try {
      res = await fetchWithTimeout(
        config.fetch,
        base + path,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        timeoutMs,
        delay,
      );
    } catch (err) {
      if (err instanceof TimeoutError) throw new CashfreeError(0, "timeout", `${method} ${path}: ${err.message}`);
      throw new CashfreeError(0, "network", `${method} ${path}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (res.ok) throw new CashfreeError(res.status, "bad_response", `${method} ${path}: non-JSON body`);
      }
    }
    if (!res.ok) {
      // UNVERIFIED: error body shape `{ message, code, type }` (not in our notes).
      const e = (data ?? {}) as { message?: unknown; code?: unknown };
      const code = typeof e.code === "string" ? e.code : `http_${res.status}`;
      const message = typeof e.message === "string" ? e.message : `HTTP ${res.status}`;
      throw new CashfreeError(res.status, code, `${method} ${path}: ${message}`);
    }
    return { status: res.status, data };
  }

  function parseOrder(d: Record<string, unknown>): CfOrder {
    return {
      cfOrderId: String(d.cf_order_id ?? ""),
      orderRef: String(d.order_id ?? ""),
      status: String(d.order_status) as CfOrderStatus,
      amount: Number(d.order_amount),
      currency: String(d.order_currency ?? ""),
      // UNVERIFIED: Get Order returns payment_session_id (R6 relies on it to
      // resume a session after an ambiguous create).
      paymentSessionId: typeof d.payment_session_id === "string" && d.payment_session_id
        ? d.payment_session_id
        : null,
    };
  }

  function parseRefund(d: Record<string, unknown>): CfRefund {
    return {
      cfRefundId: String(d.cf_refund_id ?? ""),
      refundId: String(d.refund_id ?? ""),
      status: String(d.refund_status) as CfRefundStatus,
      amount: Number(d.refund_amount),
    };
  }

  async function getOrder(orderRef: string): Promise<CfOrder | null> {
    assertRef(orderRef, ORDER_REF_RE, "order ref");
    try {
      const { data } = await call("GET", `/orders/${encodeURIComponent(orderRef)}`);
      return parseOrder(data as Record<string, unknown>);
    } catch (err) {
      // UNVERIFIED: an unknown order_id returns 404.
      if (err instanceof CashfreeError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    async createOrder(input) {
      assertRef(input.orderRef, ORDER_REF_RE, "order ref");
      const amount = toCfAmount(input.amount);
      if (amount < CASHFREE_MIN_AMOUNT) {
        throw new RangeError(`order amount ${amount} is below Cashfree's minimum ${CASHFREE_MIN_AMOUNT}`);
      }
      if (!input.idempotencyKey) throw new RangeError("idempotencyKey is required");
      const customer: Record<string, string> = {
        customer_id: cfCustomerId(input.customer.id),
        customer_phone: input.customer.phone,
      };
      if (input.customer.name) customer.customer_name = input.customer.name;
      if (input.customer.email) customer.customer_email = input.customer.email;
      const body = {
        order_id: input.orderRef,
        order_amount: amount,
        order_currency: "INR",
        customer_details: customer,
        order_meta: { return_url: input.returnUrl, notify_url: input.notifyUrl },
        order_expiry_time: input.expiresAt.toISOString(),
      };
      try {
        const { data } = await call("POST", "/orders", body, input.idempotencyKey);
        const d = data as Record<string, unknown>;
        if (typeof d.payment_session_id !== "string" || !d.payment_session_id) {
          throw new CashfreeError(200, "bad_response", "POST /orders: no payment_session_id");
        }
        return {
          cfOrderId: String(d.cf_order_id ?? ""),
          paymentSessionId: d.payment_session_id,
          status: String(d.order_status) as CfOrderStatus,
          recovered: false,
        };
      } catch (err) {
        // R6: timeout/5xx may have created it; 409 = this order_id already exists.
        if (!(err instanceof CashfreeError) || !(err.ambiguous || err.status === 409)) throw err;
        const existing = await getOrder(input.orderRef);
        if (!existing) {
          if (err.status === 409) throw err;
          // Cashfree confirms it never created the order: the failure is now definite.
          throw new CashfreeError(404, "order_not_created", `${err.message} (order not found on reconcile)`);
        }
        if (toCfAmount(existing.amount) !== amount || existing.currency !== "INR") {
          throw new CashfreeError(409, "order_mismatch", `order ${input.orderRef} exists with a different amount`);
        }
        if (!existing.paymentSessionId) {
          throw new CashfreeError(409, "no_session", `order ${input.orderRef} exists without a payment session`);
        }
        return {
          cfOrderId: existing.cfOrderId,
          paymentSessionId: existing.paymentSessionId,
          status: existing.status,
          recovered: true,
        };
      }
    },

    getOrder,

    async getPayments(orderRef) {
      assertRef(orderRef, ORDER_REF_RE, "order ref");
      const { data } = await call("GET", `/orders/${encodeURIComponent(orderRef)}/payments`);
      if (!Array.isArray(data)) {
        throw new CashfreeError(200, "bad_response", "GET payments: expected an array");
      }
      return data.map((p: Record<string, unknown>) => ({
        cfPaymentId: String(p.cf_payment_id ?? ""),
        status: String(p.payment_status) as CfPaymentStatus,
        amount: Number(p.payment_amount),
        currency: String(p.payment_currency ?? ""),
        time: typeof p.payment_time === "string" ? p.payment_time : null,
      }));
    },

    async createRefund(orderRef, refund) {
      assertRef(orderRef, ORDER_REF_RE, "order ref");
      assertRef(refund.refundId, REFUND_ID_RE, "refund id");
      const amount = toCfAmount(refund.amount);
      if (amount <= 0) throw new RangeError(`refund amount must be positive, got ${amount}`);
      const body: Record<string, unknown> = { refund_id: refund.refundId, refund_amount: amount };
      if (refund.note) body.refund_note = refund.note.slice(0, 100);
      // Idempotency key = refund id, so a retried refund never pays out twice.
      const { data } = await call(
        "POST",
        `/orders/${encodeURIComponent(orderRef)}/refunds`,
        body,
        refund.refundId,
      );
      return parseRefund(data as Record<string, unknown>);
    },

    async getRefund(orderRef, refundId) {
      assertRef(orderRef, ORDER_REF_RE, "order ref");
      assertRef(refundId, REFUND_ID_RE, "refund id");
      try {
        // UNVERIFIED: GET /orders/{order_id}/refunds/{refund_id} (not in our notes).
        const { data } = await call(
          "GET",
          `/orders/${encodeURIComponent(orderRef)}/refunds/${encodeURIComponent(refundId)}`,
        );
        return parseRefund(data as Record<string, unknown>);
      } catch (err) {
        if (err instanceof CashfreeError && err.status === 404) return null;
        throw err;
      }
    },

    verifyWebhook(rawBody, signature, timestamp) {
      return verifyCashfreeSignature(config.clientSecret, rawBody, signature, timestamp);
    },
  };
}

/**
 * signature = base64(HMAC-SHA256(key = client secret, msg = timestamp + rawBody)),
 * plain concatenation, no separator (notes §5). rawBody must be the exact
 * request text: re-serialised JSON breaks the signature.
 *
 * No replay window: the timestamp's unit is UNVERIFIED, and a replay is
 * harmless because confirmation is idempotent and re-checked with Get Order (R4).
 */
export async function verifyCashfreeSignature(
  secret: string,
  rawBody: string,
  signature: string,
  timestamp: string,
): Promise<boolean> {
  if (!secret || !signature || !timestamp) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + rawBody)));
  return constantTimeEqual(enc.encode(base64(mac)), enc.encode(signature.trim()));
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Time depends only on the longer length, not on where the inputs differ. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
