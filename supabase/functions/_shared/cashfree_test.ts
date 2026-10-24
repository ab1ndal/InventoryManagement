import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CASHFREE_API_VERSION,
  CashfreeError,
  cfCustomerId,
  createCashfree,
  type CreateOrderInput,
  verifyCashfreeSignature,
} from "./cashfree.ts";
import { fakeFetch, hang, instantDelay, jsonResponse, neverDelay, type RecordedCall } from "./testing.ts";

const SECRET = "cfsk_test_secret";

function client(handler: (c: RecordedCall) => Response | Promise<Response>, delay = neverDelay) {
  const f = fakeFetch(handler);
  const cf = createCashfree({ clientId: "cf_id", clientSecret: SECRET, env: "sandbox", fetch: f.fetch, delay });
  return { cf, calls: f.calls };
}

const orderInput: CreateOrderInput = {
  orderRef: "WEB-000001",
  amount: 1234.5,
  customer: { id: 42, name: "Asha Gupta", phone: "9876543210", email: "asha@example.com" },
  returnUrl: "https://www.bindalscreations.com/order/WEB-000001?t=abc",
  notifyUrl: "https://example.supabase.co/functions/v1/cashfree-webhook",
  expiresAt: new Date("2026-10-23T10:30:00Z"),
  idempotencyKey: "6f1c1f0e-7a1b-4f43-9c1e-2b9f8a7d6c5e",
};

const createdBody = {
  cf_order_id: 2149460581,
  order_id: "WEB-000001",
  payment_session_id: "session_abc",
  order_status: "ACTIVE",
  order_amount: 1234.5,
  order_currency: "INR",
};

async function sign(ts: string, body: string, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(ts + body)));
  return btoa(String.fromCharCode(...mac));
}

Deno.test("cfCustomerId is alphanumeric and at least 3 chars", () => {
  assertEquals(cfCustomerId(1234), "C1234");
  assertEquals(cfCustomerId(5), "C05");
  assert(/^[A-Za-z0-9]{3,50}$/.test(cfCustomerId(987654321)));
  assertThrows(() => cfCustomerId(0), RangeError);
  assertThrows(() => cfCustomerId(1.5), RangeError);
});

Deno.test("createOrder: sandbox URL, auth + version + idempotency headers, 2 dp amount, body fields", async () => {
  const { cf, calls } = client(() => jsonResponse(200, createdBody));
  const res = await cf.createOrder({ ...orderInput, amount: 1234.499999 });
  assertEquals(res, { cfOrderId: "2149460581", paymentSessionId: "session_abc", status: "ACTIVE", recovered: false });
  assertEquals(calls.length, 1);
  const c = calls[0];
  assertEquals(c.method, "POST");
  assertEquals(c.url, "https://sandbox.cashfree.com/pg/orders");
  assertEquals(c.headers.get("x-client-id"), "cf_id");
  assertEquals(c.headers.get("x-client-secret"), SECRET);
  assertEquals(c.headers.get("x-api-version"), "2026-01-01");
  assertEquals(CASHFREE_API_VERSION, "2026-01-01");
  assertEquals(c.headers.get("x-idempotency-key"), orderInput.idempotencyKey);
  // UNVERIFIED pin: we send JSON with an explicit content type.
  assertEquals(c.headers.get("content-type"), "application/json");
  const body = c.body as Record<string, unknown>;
  assertEquals(body.order_amount, 1234.5);
  assertEquals(body.order_currency, "INR");
  assertEquals(body.order_id, "WEB-000001");
  assertEquals(body.order_expiry_time, "2026-10-23T10:30:00.000Z");
  assertEquals(body.customer_details, {
    customer_id: "C42",
    customer_phone: "9876543210",
    customer_name: "Asha Gupta",
    customer_email: "asha@example.com",
  });
  assertEquals(body.order_meta, { return_url: orderInput.returnUrl, notify_url: orderInput.notifyUrl });
});

Deno.test("createOrder: production base URL", async () => {
  const f = fakeFetch(() => jsonResponse(200, createdBody));
  const cf = createCashfree({ clientId: "a", clientSecret: "b", env: "production", fetch: f.fetch, delay: neverDelay });
  await cf.createOrder(orderInput);
  assertEquals(f.calls[0].url, "https://api.cashfree.com/pg/orders");
});

Deno.test("createOrder: amount rounded to paise; below ₹1 refused locally", async () => {
  const { cf, calls } = client(() => jsonResponse(200, createdBody));
  await cf.createOrder({ ...orderInput, amount: 10.005 + 0.0000001 });
  assertEquals((calls[0].body as Record<string, unknown>).order_amount, 10.01);
  await assertRejects(() => cf.createOrder({ ...orderInput, amount: 0.99 }), RangeError);
  await assertRejects(() => cf.createOrder({ ...orderInput, orderRef: "WEB 1" }), RangeError);
  assertEquals(calls.length, 1);
});

Deno.test("createOrder: 400 is a definite CashfreeError with Cashfree's code", async () => {
  const { cf, calls } = client(() =>
    jsonResponse(400, { message: "order_amount : invalid value", code: "order_amount_invalid", type: "invalid_request_error" })
  );
  const err = await assertRejects(() => cf.createOrder(orderInput), CashfreeError);
  assertEquals(err.status, 400);
  // UNVERIFIED pin: error body shape { message, code, type }.
  assertEquals(err.code, "order_amount_invalid");
  assertEquals(err.ambiguous, false);
  assert(!err.message.includes(SECRET));
  assertEquals(calls.length, 1, "definite failure: no reconcile call");
});

Deno.test("error classification: timeout, network and 5xx are ambiguous; 4xx definite", () => {
  assertEquals(new CashfreeError(0, "timeout", "x").ambiguous, true);
  assertEquals(new CashfreeError(0, "network", "x").ambiguous, true);
  assertEquals(new CashfreeError(500, "http_500", "x").ambiguous, true);
  assertEquals(new CashfreeError(503, "http_503", "x").ambiguous, true);
  assertEquals(new CashfreeError(400, "x", "x").ambiguous, false);
  assertEquals(new CashfreeError(404, "x", "x").ambiguous, false);
  assertEquals(new CashfreeError(409, "x", "x").ambiguous, false);
  assertEquals(new CashfreeError(422, "x", "x").ambiguous, false);
});

Deno.test("getOrder: timeout surfaces as ambiguous CashfreeError(0, 'timeout')", async () => {
  const { delay, requested } = instantDelay();
  const { cf } = client(hang, delay);
  const err = await assertRejects(() => cf.getOrder("WEB-000001"), CashfreeError);
  assertEquals([err.status, err.code, err.ambiguous], [0, "timeout", true]);
  assertEquals(requested, [15_000]);
});

Deno.test("getOrder: network error is ambiguous", async () => {
  const { cf } = client(() => Promise.reject(new TypeError("connection reset")));
  const err = await assertRejects(() => cf.getOrder("WEB-000001"), CashfreeError);
  assertEquals([err.status, err.code, err.ambiguous], [0, "network", true]);
});

Deno.test("R6: ambiguous create (500) reconciles with Get Order and resumes the session", async () => {
  const { cf, calls } = client((c) =>
    c.method === "POST"
      ? jsonResponse(500, { message: "internal", code: "internal_error" })
      : jsonResponse(200, { ...createdBody, payment_session_id: "session_from_get" })
  );
  const res = await cf.createOrder(orderInput);
  assertEquals(res, {
    cfOrderId: "2149460581",
    paymentSessionId: "session_from_get",
    status: "ACTIVE",
    recovered: true,
  });
  assertEquals(calls.map((c) => `${c.method} ${c.url}`), [
    "POST https://sandbox.cashfree.com/pg/orders",
    "GET https://sandbox.cashfree.com/pg/orders/WEB-000001",
  ]);
});

Deno.test("R6: 409 duplicate order_id also reconciles", async () => {
  const { cf } = client((c) =>
    c.method === "POST" ? jsonResponse(409, { message: "order already exists", code: "order_already_exists" }) : jsonResponse(200, createdBody)
  );
  assertEquals((await cf.createOrder(orderInput)).recovered, true);
});

Deno.test("R6: ambiguous create + Get Order 404 → definite failure (safe to fail the order)", async () => {
  const { cf } = client((c) =>
    c.method === "POST" ? jsonResponse(502, {}) : jsonResponse(404, { message: "order not found", code: "order_not_found" })
  );
  const err = await assertRejects(() => cf.createOrder(orderInput), CashfreeError);
  assertEquals([err.status, err.code, err.ambiguous], [404, "order_not_created", false]);
});

Deno.test("R6: ambiguous create + Get Order also ambiguous → stays ambiguous", async () => {
  const { cf } = client(() => jsonResponse(503, {}));
  const err = await assertRejects(() => cf.createOrder(orderInput), CashfreeError);
  assertEquals(err.ambiguous, true);
});

Deno.test("R6: reconciled order with a different amount is refused", async () => {
  const { cf } = client((c) =>
    c.method === "POST" ? jsonResponse(500, {}) : jsonResponse(200, { ...createdBody, order_amount: 99 })
  );
  const err = await assertRejects(() => cf.createOrder(orderInput), CashfreeError);
  assertEquals(err.code, "order_mismatch");
});

Deno.test("getOrder parses status/amount; 404 → null", async () => {
  const { cf } = client((c) =>
    c.url.endsWith("WEB-000001")
      ? jsonResponse(200, { ...createdBody, order_status: "PAID", order_amount: "1234.50" })
      : jsonResponse(404, { message: "not found", code: "order_not_found" })
  );
  const o = await cf.getOrder("WEB-000001");
  assertEquals(o?.status, "PAID");
  assertEquals(o?.amount, 1234.5);
  assertEquals(o?.currency, "INR");
  assertEquals(await cf.getOrder("WEB-000002"), null);
});

Deno.test("getPayments maps every attempt", async () => {
  const { cf, calls } = client(() =>
    jsonResponse(200, [
      { cf_payment_id: 111, payment_status: "FAILED", payment_amount: 1234.5, payment_currency: "INR" },
      {
        cf_payment_id: 112,
        payment_status: "SUCCESS",
        payment_amount: 1234.5,
        payment_currency: "INR",
        payment_time: "2026-10-23T16:00:00+05:30",
      },
    ])
  );
  const p = await cf.getPayments("WEB-000001");
  assertEquals(calls[0].url, "https://sandbox.cashfree.com/pg/orders/WEB-000001/payments");
  assertEquals(p, [
    { cfPaymentId: "111", status: "FAILED", amount: 1234.5, currency: "INR", time: null },
    { cfPaymentId: "112", status: "SUCCESS", amount: 1234.5, currency: "INR", time: "2026-10-23T16:00:00+05:30" },
  ]);
});

Deno.test("createRefund: idempotency key = refund id, 2 dp amount, note capped at 100", async () => {
  const { cf, calls } = client(() =>
    jsonResponse(200, { cf_refund_id: "9001", refund_id: "RF-abc123", refund_status: "PENDING", refund_amount: 333.33 })
  );
  const r = await cf.createRefund("WEB-000001", { refundId: "RF-abc123", amount: 333.333, note: "x".repeat(150) });
  assertEquals(r, { cfRefundId: "9001", refundId: "RF-abc123", status: "PENDING", amount: 333.33 });
  const c = calls[0];
  assertEquals(c.url, "https://sandbox.cashfree.com/pg/orders/WEB-000001/refunds");
  assertEquals(c.headers.get("x-idempotency-key"), "RF-abc123");
  const body = c.body as Record<string, unknown>;
  assertEquals(body.refund_amount, 333.33);
  assertEquals((body.refund_note as string).length, 100);
  await assertRejects(() => cf.createRefund("WEB-000001", { refundId: "x".repeat(41), amount: 1 }), RangeError);
  await assertRejects(() => cf.createRefund("WEB-000001", { refundId: "RF-1", amount: 0 }), RangeError);
});

Deno.test("getRefund: assumed endpoint, 404 → null", async () => {
  const { cf, calls } = client((c) =>
    c.url.endsWith("/RF-abc123")
      ? jsonResponse(200, { cf_refund_id: 9001, refund_id: "RF-abc123", refund_status: "SUCCESS", refund_amount: 10 })
      : jsonResponse(404, { code: "refund_not_found" })
  );
  assertEquals((await cf.getRefund("WEB-000001", "RF-abc123"))?.status, "SUCCESS");
  // UNVERIFIED pin: GET /orders/{order_id}/refunds/{refund_id}.
  assertEquals(calls[0].url, "https://sandbox.cashfree.com/pg/orders/WEB-000001/refunds/RF-abc123");
  assertEquals(await cf.getRefund("WEB-000001", "RF-zzz"), null);
});

Deno.test("verifyWebhook: good signature over timestamp + raw body", async () => {
  const { cf } = client(() => jsonResponse(200, {}));
  const raw = '{"data":{"order":{"order_id":"WEB-000001","order_amount":170.00}},"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const ts = "1729680000000";
  assertEquals(await cf.verifyWebhook(raw, await sign(ts, raw), ts), true);
});

Deno.test("verifyWebhook: tampered body, wrong timestamp, wrong key, separator, empty → false", async () => {
  const { cf } = client(() => jsonResponse(200, {}));
  const raw = '{"data":{"order":{"order_amount":170.00}}}';
  const ts = "1729680000000";
  const good = await sign(ts, raw);
  assertEquals(await cf.verifyWebhook(raw.replace("170.00", "170"), good, ts), false);
  assertEquals(await cf.verifyWebhook(raw, good, "1729680000001"), false);
  assertEquals(await cf.verifyWebhook(raw, await sign(ts, raw, "other_secret"), ts), false);
  // The docs' bash pseudocode shows a "." separator; the real samples don't.
  assertEquals(await cf.verifyWebhook(raw, await sign(ts + ".", raw), ts), false);
  assertEquals(await cf.verifyWebhook(raw, "", ts), false);
  assertEquals(await cf.verifyWebhook(raw, good, ""), false);
  assertEquals(await cf.verifyWebhook(raw, good.slice(0, -2), ts), false);
});

Deno.test("verifyCashfreeSignature is usable without a client (webhook handler)", async () => {
  const ts = "1729680000";
  assertEquals(await verifyCashfreeSignature(SECRET, "{}", await sign(ts, "{}"), ts), true);
});

Deno.test("createCashfree refuses empty credentials", () => {
  assertThrows(() => createCashfree({ clientId: "", clientSecret: "x", env: "sandbox", fetch: fakeFetch(hang).fetch }));
});
