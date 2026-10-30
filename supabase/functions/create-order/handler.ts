/**
 * POST create-order (plan Task 4, R4, R6, R8, R9, R10; HTTP contract).
 *
 * 1. Same attemptKey again → the same order (fresh access token, session
 *    re-fetched from Cashfree), never a second order (R6).
 * 2. Re-quotes from the database; client totals are never read.
 * 3. online_order_create holds credit/voucher/promo; the DB re-checks sums.
 * 4. Zero gateway → confirmed at once ('NO_GATEWAY', 0). Otherwise a
 *    Cashfree order (idempotency key = attemptKey, 30 min expiry) whose
 *    return URL carries the access token.
 * 5. Definite Cashfree failure → online_order_fail (holds released), 502.
 *    Ambiguous failure (the client's own reconcile couldn't tell) → 502 but
 *    the order stays pending; a retry with the same attemptKey resumes it and
 *    the expiry sweep settles it otherwise.
 */

import { CashfreeError, type CfOrder } from "../_shared/cashfree.ts";
import { hashIp, optionalUser } from "../_shared/http.ts";
import {
  ApiError,
  type AppDeps,
  browserEndpoint,
  DbError,
  errorMessage,
  logEvent,
  type OrderRow,
  newAccessToken,
  readJsonBody,
} from "../_shared/context.ts";
import {
  buildQuote,
  type Fulfilment,
  optionalString,
  orderPayload,
  parseCredit,
  parseFulfilment,
  parseItems,
} from "../_shared/quote.ts";
import { confirmNoGateway, reconcilePayment } from "../_shared/confirm.ts";

export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CreateOrderDeps = AppDeps & { randomBytes?: (n: number) => Uint8Array };

export type CreateOrderResponse = {
  orderRef: string;
  accessToken: string;
  paymentSessionId: string | null;
  cashfreeMode: "sandbox" | "production";
  paid: boolean;
};

type Contact = { name: string; phone: string; email: string | null };
type Address = Contact & {
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
};

/** Pickup needs only the contact: nothing is delivered, so address lines are not read. */
function parseAddress(raw: unknown, fulfilment: Fulfilment): Contact | Address {
  const a = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string, max: number, required: boolean): string | null => {
    const v = a[k];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      if (required) throw new ApiError(422, "invalid_address", `address.${k} is required`);
      return null;
    }
    if (typeof v !== "string" || v.trim().length > max) {
      throw new ApiError(422, "invalid_address", `address.${k} must be text up to ${max} characters`);
    }
    return v.trim();
  };
  if (!raw || typeof raw !== "object") throw new ApiError(422, "invalid_address", "address is required");
  const phone = str("phone", 20, true)!;
  const digits = phone.replace(/\D/g, "");
  if (!(digits.length === 10 || (digits.length === 12 && digits.startsWith("91")))) {
    throw new ApiError(422, "invalid_address", "phone must be a 10-digit Indian mobile number");
  }
  const email = str("email", 100, false);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, "invalid_address", "email is not valid");
  }
  const contact = { name: str("name", 100, true)!, phone, email };
  if (fulfilment === "pickup") return contact;
  return {
    ...contact,
    line1: str("line1", 200, true)!,
    line2: str("line2", 200, false),
    landmark: str("landmark", 100, false),
    city: str("city", 60, true)!,
    state: str("state", 60, true)!,
    pincode: str("pincode", 10, true)!,
  };
}

/** Cashfree customer_phone: 10 digits for +91, else the full +E.164 form. */
function cfPhone(normalized: string): string {
  return normalized.startsWith("+91") && normalized.length === 13 ? normalized.slice(3) : normalized;
}

/** Maps a raise from online_order_create to the contract's error codes. */
function createError(err: DbError): ApiError | null {
  const m = err.message;
  if (err.code === "42501" || m.includes("checkout is not live")) return new ApiError(403, "checkout_off", "checkout is not open");
  if (m.includes("code not valid")) return new ApiError(422, "invalid_code", "That code isn't valid.");
  if (/invalid phone|invalid pincode|name is required|address is required/.test(m)) {
    return new ApiError(422, "invalid_address", "Please check your name, phone and address.");
  }
  if (/price changed|mismatch|not found|balance is lower|exceeds amount due|must be 0 or at least/.test(m)) {
    return new ApiError(409, "price_changed", "Prices or balances changed. Please review your order.");
  }
  return null;
}

/** Resumes a pending order on retry: its live Cashfree session, or a new Cashfree order. */
async function sessionFor(
  deps: CreateOrderDeps,
  order: OrderRow,
  attemptKey: string,
  returnUrl: string,
): Promise<{ paymentSessionId: string | null; paid: boolean }> {
  const cashfree = deps.cashfree;
  if (!cashfree) throw new ApiError(502, "gateway_error", "payments are not available right now");
  let cf: CfOrder | null;
  try {
    cf = await cashfree.getOrder(order.order_ref);
  } catch (err) {
    logEvent("error", "cashfree_get_order_failed", { orderRef: order.order_ref, error: errorMessage(err) });
    throw new ApiError(502, "gateway_error", "payment service unavailable, please try again");
  }
  if (!cf) {
    // No Cashfree order yet (the first attempt failed before creating it).
    return { paymentSessionId: await createCashfreeOrder(deps, order, attemptKey, returnUrl), paid: false };
  }
  if (order.cf_order_id === null) {
    await deps.store.rpc("online_order_checkpoint", {
      p_order_id: order.id,
      p_step: "cf_order",
      p_data: { cf_order_id: cf.cfOrderId },
    });
  }
  if (cf.status === "PAID") {
    const r = await reconcilePayment(deps, order.order_ref);
    return { paymentSessionId: null, paid: r.outcome === "confirmed" || r.outcome === "already" };
  }
  if (cf.status === "ACTIVE" && cf.paymentSessionId) return { paymentSessionId: cf.paymentSessionId, paid: false };
  throw new ApiError(502, "gateway_error", "this payment attempt has ended, please start again");
}

async function createCashfreeOrder(deps: CreateOrderDeps, order: OrderRow, attemptKey: string, returnUrl: string) {
  const cashfree = deps.cashfree;
  if (!cashfree || order.customerid === null) {
    await deps.store.rpc("online_order_fail", {
      p_order_ref: order.order_ref,
      p_status: "payment_failed",
      p_reason: cashfree ? "no customer on order" : "Cashfree not configured",
    });
    throw new ApiError(502, "gateway_error", "payments are not available right now");
  }
  try {
    const created = await cashfree.createOrder({
      orderRef: order.order_ref,
      amount: order.gateway_amount,
      customer: {
        id: order.customerid,
        name: order.contact_name,
        phone: cfPhone(order.contact_phone),
        email: order.contact_email,
      },
      returnUrl,
      notifyUrl: `${deps.env.supabaseUrl}/functions/v1/cashfree-webhook`,
      expiresAt: new Date(deps.now().getTime() + PAYMENT_WINDOW_MS),
      idempotencyKey: attemptKey,
    });
    await deps.store.rpc("online_order_checkpoint", {
      p_order_id: order.id,
      p_step: "cf_order",
      p_data: { cf_order_id: created.cfOrderId },
    });
    return created.paymentSessionId;
  } catch (err) {
    if (err instanceof CashfreeError && err.ambiguous) {
      logEvent("error", "cashfree_create_ambiguous", { orderRef: order.order_ref, code: err.code, status: err.status });
      throw new ApiError(502, "gateway_error", "payment service unavailable, please try again");
    }
    if (err instanceof CashfreeError || err instanceof RangeError) {
      logEvent("error", "cashfree_create_failed", { orderRef: order.order_ref, error: errorMessage(err) });
      await deps.store.rpc("online_order_fail", {
        p_order_ref: order.order_ref,
        p_status: "payment_failed",
        p_reason: `Cashfree create failed: ${errorMessage(err)}`.slice(0, 300),
      });
      throw new ApiError(502, "gateway_error", "could not start the payment, please try again");
    }
    throw err;
  }
}

async function respondForExisting(
  deps: CreateOrderDeps,
  order: OrderRow,
  attemptKey: string,
): Promise<CreateOrderResponse> {
  const { token, hash } = await newAccessToken(deps.randomBytes);
  await deps.store.setAccessTokenHash(order.id, hash);
  const base = { orderRef: order.order_ref, accessToken: token, cashfreeMode: deps.env.cashfreeMode };
  if (order.status === "pending_payment") {
    if (order.gateway_amount === 0) {
      await confirmNoGateway(deps, order.order_ref);
      return { ...base, paymentSessionId: null, paid: true };
    }
    const returnUrl = `${deps.env.siteUrl}/order/${order.order_ref}?t=${token}`;
    return { ...base, ...(await sessionFor(deps, order, attemptKey, returnUrl)) };
  }
  if (order.status === "payment_failed" || order.status === "expired") {
    throw new ApiError(502, "gateway_error", "this payment attempt has ended, please start again");
  }
  return { ...base, paymentSessionId: null, paid: true };
}

export function handler(req: Request, deps: CreateOrderDeps): Promise<Response> {
  return browserEndpoint(req, deps.env.allowedOrigins, "create_order", async () => {
    const body = await readJsonBody(req);
    const attemptKey = body.attemptKey;
    if (typeof attemptKey !== "string" || !UUID_V4_RE.test(attemptKey)) {
      throw new ApiError(400, "bad_request", "attemptKey must be a UUID v4");
    }
    const items = parseItems(body.items);
    const fulfilment = parseFulfilment(body.fulfilment);
    const address = parseAddress(body.address, fulfilment);
    const code = optionalString(body.code, "code");
    const creditRequested = parseCredit(body.creditRequested);
    const user = await optionalUser(req, deps.verifyJwt, deps.env.anonKey ? [deps.env.anonKey] : []);

    if (!(await deps.store.checkoutLive())) throw new ApiError(403, "checkout_off", "checkout is not open");

    const existing = await deps.store.orderByAttemptKey(attemptKey);
    if (existing) return await respondForExisting(deps, existing, attemptKey);

    const ipHash = deps.env.ipHashSalt ? await hashIp(req, deps.env.ipHashSalt) : null;
    const result = await buildQuote(
      deps,
      { items, pincode: "pincode" in address ? address.pincode : null, code, creditRequested, phone: address.phone, fulfilment },
      { authUserId: user?.id ?? null, ipHash },
    );
    const r = result.response;
    if (r.pincode && !r.pincode.ok) throw new ApiError(422, "invalid_address", "Pincode must be 6 digits.");
    if (r.code?.status === "rate_limited") throw new ApiError(429, "rate_limited", "Too many attempts. Please try later.");
    if (r.code?.status === "invalid") throw new ApiError(422, "invalid_code", "That code isn't valid.");
    if (r.unavailable.length > 0) throw new ApiError(409, "out_of_stock", "Some items are no longer in stock.");

    const { token, hash } = await newAccessToken(deps.randomBytes);
    const payload = orderPayload(result, {
      attemptKey,
      contact: { name: address.name, phone: address.phone, email: address.email },
      address: "pincode" in address
        ? {
          name: address.name,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2,
          landmark: address.landmark,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
        }
        : { name: address.name, phone: address.phone },
      accessTokenHash: hash,
      fulfilment,
    });

    let created: { order_id: string; order_ref: string; created: boolean } | undefined;
    try {
      const rows = await deps.store.rpc<{ order_id: string; order_ref: string; created: boolean }[]>(
        "online_order_create",
        { ...payload, p_auth_user: user?.id ?? null },
      );
      created = rows?.[0];
    } catch (err) {
      if (err instanceof DbError) throw createError(err) ?? err;
      throw err;
    }
    if (!created) throw new Error("online_order_create returned no row");

    const order = await deps.store.orderById(created.order_id);
    if (!order) throw new Error(`order ${created.order_ref} vanished after create`);
    // A concurrent request with the same attemptKey won the insert.
    if (!created.created) return await respondForExisting(deps, order, attemptKey);

    const base = { orderRef: order.order_ref, accessToken: token, cashfreeMode: deps.env.cashfreeMode };
    if (order.gateway_amount === 0) {
      await confirmNoGateway(deps, order.order_ref);
      return { ...base, paymentSessionId: null, paid: true } satisfies CreateOrderResponse;
    }
    const returnUrl = `${deps.env.siteUrl}/order/${order.order_ref}?t=${token}`;
    const paymentSessionId = await createCashfreeOrder(deps, order, attemptKey, returnUrl);
    return { ...base, paymentSessionId, paid: false } satisfies CreateOrderResponse;
  });
}
