import { assert, assertEquals } from "@std/assert";
import { handler } from "./handler.ts";
import { sha256Hex } from "../_shared/context.ts";
import {
  ambiguousCfError,
  ATTEMPT,
  confirmLikeDb,
  dbRaise,
  definiteCfError,
  fakeShiprocket,
  FakeStore,
  order,
  ORIGIN,
  post,
  testDeps,
  V1,
} from "../_shared/pay_testing.ts";

const URL_ = "https://fn.test/create-order";
const address = {
  name: "Asha Gupta",
  phone: "98765 43210",
  email: "asha@example.com",
  line1: "1 MG Road",
  city: "Ghaziabad",
  state: "Uttar Pradesh",
  pincode: "201001",
};
const body = (over: Record<string, unknown> = {}) => ({ attemptKey: ATTEMPT, items: [{ variantId: V1, qty: 1 }], address, ...over });

/** online_order_create stand-in: stores the order the way the DB would. */
function withCreate(store: FakeStore, gateway?: number) {
  store.impls.online_order_create = (args) => {
    const p = args.p_order as Record<string, number | string>;
    const o = order({
      id: "o-new",
      order_ref: "WEB-000042",
      attempt_key: String(p.attempt_key),
      cf_order_id: null,
      subtotal: Number(p.subtotal),
      shipping: Number(p.shipping),
      gateway_amount: gateway ?? Number(p.gateway_amount),
    });
    store.orders.push(o);
    return [{ order_id: o.id, order_ref: o.order_ref, created: true }];
  };
  store.impls.online_order_confirm_payment = confirmLikeDb(store);
  return store;
}

async function call(b: unknown, depsOver: Parameters<typeof testDeps>[0] = {}, headers: Record<string, string> = {}) {
  const deps = testDeps({ store: withCreate(new FakeStore()), ...depsOver });
  const res = await handler(post(URL_, b, headers), deps);
  return { res, json: await res.json(), deps };
}

Deno.test("create-order: happy path creates the DB order then the Cashfree order", async () => {
  const { res, json, deps } = await call(body({ items: [{ variantId: V1, qty: 1, unitPrice: 1 }], total: 1 }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(json.orderRef, "WEB-000042");
  assertEquals([json.paymentSessionId, json.cashfreeMode, json.paid], ["session-WEB-000042", "sandbox", false]);
  assert(/^[A-Za-z0-9_-]{43}$/.test(json.accessToken), "32 bytes base64url");

  const [create] = deps.store.callsTo("online_order_create");
  const p = create.p_order as Record<string, unknown>;
  assertEquals(p.access_token_hash, await sha256Hex(json.accessToken));
  assertEquals([p.subtotal, p.shipping, p.gateway_amount, p.attempt_key], [1000, 80, 1080, ATTEMPT]);
  assertEquals((create.p_items as Record<string, unknown>[])[0].unit_price, 1000, "client price ignored");
  assertEquals(create.p_auth_user, null);

  const [cf] = deps.cashfree.created;
  assertEquals(cf.amount, 1080);
  assertEquals(cf.idempotencyKey, ATTEMPT);
  assertEquals(cf.customer, { id: 7, name: "Asha Gupta", phone: "9876543210", email: "asha@example.com" });
  assertEquals(cf.returnUrl, `https://www.bindalscreations.com/order/WEB-000042?t=${json.accessToken}`);
  assertEquals(cf.notifyUrl, "https://proj.supabase.co/functions/v1/cashfree-webhook");
  assertEquals(cf.expiresAt.toISOString(), "2026-10-23T10:30:00.000Z");
  assertEquals(deps.store.callsTo("online_order_checkpoint"), [
    { p_order_id: "o-new", p_step: "cf_order", p_data: { cf_order_id: "cf-WEB-000042" } },
  ]);
});

Deno.test("create-order: an address outside Uttar Pradesh is accepted", async () => {
  const outside = { ...address, city: "Mumbai", state: "Maharashtra", pincode: "400001" };
  const { res, deps } = await call(body({ address: outside }), { shiprocket: fakeShiprocket({ rate: null }).client });
  assertEquals(res.status, 200);
  const [create] = deps.store.callsTo("online_order_create");
  assertEquals((create.p_order as Record<string, unknown>).shipping, 250, "national fallback slab");
});

Deno.test("create-order: store pickup needs only the contact; ₹0 shipping, no pincode, no courier", async () => {
  const sr = fakeShiprocket();
  const contact = { name: "Asha Gupta", phone: "98765 43210", email: "" };
  const { res, deps } = await call(body({ fulfilment: "pickup", address: contact }), { shiprocket: sr.client });
  assertEquals(res.status, 200);
  const [create] = deps.store.callsTo("online_order_create");
  const p = create.p_order as Record<string, unknown>;
  assertEquals([p.fulfilment, p.shipping, p.gateway_amount], ["pickup", 0, 1000]);
  assertEquals(p.address, { name: "Asha Gupta", phone: "98765 43210" });
  assertEquals([sr.calls.postcode, sr.calls.rate], [[], []]);
  const bad = await call(body({ fulfilment: "drone" }));
  assertEquals([bad.res.status, bad.json.code], [400, "bad_request"]);
  const noPhone = await call(body({ fulfilment: "pickup", address: { name: "Asha" } }));
  assertEquals([noPhone.res.status, noPhone.json.code], [422, "invalid_address"]);
});

Deno.test("create-order: ship still requires the address lines", async () => {
  const { res, json } = await call(body({ address: { name: "Asha", phone: "9876543210" } }));
  assertEquals([res.status, json.code], [422, "invalid_address"]);
});

Deno.test("create-order: signed-in user id goes to online_order_create (R8)", async () => {
  const { json, deps } = await call(body(), {}, { authorization: "Bearer user.jwt" });
  assertEquals(json.paid, false);
  assertEquals(deps.store.callsTo("online_order_create")[0].p_auth_user, "44444444-4444-4444-8444-444444444444");
});

Deno.test("create-order: zero gateway confirms with NO_GATEWAY and never calls Cashfree", async () => {
  const store = withCreate(new FakeStore(), 0);
  const { json, deps } = await call(body(), { store });
  assertEquals([json.paid, json.paymentSessionId], [true, null]);
  assertEquals(deps.cashfree.created.length, 0);
  assertEquals(deps.store.callsTo("online_order_confirm_payment")[0].p_cf_payment_id, "NO_GATEWAY");
  assertEquals(deps.kicks.n, 1);
});

Deno.test("create-order R6: repeated attemptKey returns the same order and session, fresh token, no new order", async () => {
  const store = withCreate(new FakeStore());
  const existing = order({ id: "o-1", order_ref: "WEB-000001" });
  store.orders.push(existing);
  const deps = testDeps({ store });
  deps.cashfree.orders.set("WEB-000001", {
    cfOrderId: "cf-1",
    orderRef: "WEB-000001",
    status: "ACTIVE",
    amount: 1080,
    currency: "INR",
    paymentSessionId: "session-old",
  });
  const res = await handler(post(URL_, body()), deps);
  const json = await res.json();
  assertEquals([res.status, json.orderRef, json.paymentSessionId, json.paid], [200, "WEB-000001", "session-old", false]);
  assertEquals(store.callsTo("online_order_create").length, 0);
  assertEquals(deps.cashfree.created.length, 0);
  assertEquals(store.tokenHashes.get("o-1"), await sha256Hex(json.accessToken));
});

Deno.test("create-order R6: DB says created=false (concurrent twin) → existing order's session", async () => {
  const store = new FakeStore();
  const existing = order({ id: "o-1", order_ref: "WEB-000001", attempt_key: "other" });
  store.orders.push(existing);
  store.impls.online_order_create = () => [{ order_id: "o-1", order_ref: "WEB-000001", created: false }];
  const deps = testDeps({ store });
  deps.cashfree.orders.set("WEB-000001", { cfOrderId: "cf-1", orderRef: "WEB-000001", status: "ACTIVE", amount: 1080, currency: "INR", paymentSessionId: "s1" });
  const json = await (await handler(post(URL_, body()), deps)).json();
  assertEquals([json.orderRef, json.paymentSessionId], ["WEB-000001", "s1"]);
});

Deno.test("create-order R6: retry of an order whose Cashfree create never happened creates it now", async () => {
  const store = withCreate(new FakeStore());
  store.orders.push(order({ id: "o-1", order_ref: "WEB-000001", cf_order_id: null }));
  const deps = testDeps({ store });
  const json = await (await handler(post(URL_, body()), deps)).json();
  assertEquals([json.orderRef, json.paymentSessionId], ["WEB-000001", "session-WEB-000001"]);
  assertEquals(deps.cashfree.created.length, 1);
});

Deno.test("create-order: definite Cashfree failure → online_order_fail + 502 gateway_error", async () => {
  const deps = testDeps({ store: withCreate(new FakeStore()) });
  deps.cashfree.createError = definiteCfError();
  const res = await handler(post(URL_, body()), deps);
  assertEquals([res.status, (await res.json()).code], [502, "gateway_error"]);
  const [fail] = deps.store.callsTo("online_order_fail");
  assertEquals([fail.p_order_ref, fail.p_status], ["WEB-000042", "payment_failed"]);
});

Deno.test("create-order: ambiguous Cashfree failure → 502 but the order is NOT failed", async () => {
  const deps = testDeps({ store: withCreate(new FakeStore()) });
  deps.cashfree.createError = ambiguousCfError();
  const res = await handler(post(URL_, body()), deps);
  assertEquals([res.status, (await res.json()).code], [502, "gateway_error"]);
  assertEquals(deps.store.callsTo("online_order_fail").length, 0);
});

Deno.test("create-order: Cashfree not configured → order failed, 502", async () => {
  const deps = { ...testDeps({ store: withCreate(new FakeStore()) }), cashfree: null };
  const res = await handler(post(URL_, body()), deps);
  assertEquals([res.status, (await res.json()).code], [502, "gateway_error"]);
});

async function expectError(b: unknown, status: number, code: string, setup: (s: FakeStore) => void = () => {}, over = {}) {
  const store = withCreate(new FakeStore());
  setup(store);
  const { res, json, deps } = await call(b, { store, ...over });
  assertEquals([res.status, json.code], [status, code], JSON.stringify(json));
  return deps;
}

Deno.test("create-order: checkout_live false → 403 checkout_off, nothing written", async () => {
  const deps = await expectError(body(), 403, "checkout_off", (s) => (s.live = false));
  assertEquals(deps.store.callsTo("online_order_create").length, 0);
  await expectError(body(), 403, "checkout_off", (s) => (s.impls.online_order_create = dbRaise("checkout is not live", "42501")));
});

Deno.test("create-order: every contract error code", async () => {
  await expectError(body({ attemptKey: "not-a-uuid" }), 400, "bad_request");
  await expectError("{oops", 400, "bad_request");
  await expectError(body({ address: { ...address, line1: "" } }), 422, "invalid_address");
  await expectError(body({ address: { ...address, phone: "12345" } }), 422, "invalid_address");
  await expectError(body({ address: { ...address, pincode: "2010" } }), 422, "invalid_address");
  await expectError(body({ address: { ...address, pincode: "012345" } }), 422, "invalid_address");
  await expectError(body({ code: "NOPE" }), 422, "invalid_code", (s) => (s.impls.online_code_check = () => ({ status: "invalid" })));
  await expectError(body({ code: "NOPE" }), 429, "rate_limited", (s) => (s.impls.online_code_check = () => ({ status: "rate_limited" })));
  await expectError(body({ items: [{ variantId: V1, qty: 9 }] }), 409, "out_of_stock");
  await expectError(body(), 409, "price_changed", (s) => (s.impls.online_order_create = dbRaise("line 1: price changed (1000 vs 1200)")));
  await expectError(body(), 409, "price_changed", (s) => (s.impls.online_order_create = dbRaise("store credit balance is lower than requested")));
  await expectError(body(), 422, "invalid_code", (s) => (s.impls.online_order_create = dbRaise("code not valid")));
  await expectError(body(), 422, "invalid_address", (s) => (s.impls.online_order_create = dbRaise("invalid pincode 012345")));
  // 502 gateway_error: see the Cashfree failure tests above.
});

Deno.test("create-order: forged JWT → 401, preflight and GET handled", async () => {
  const { res } = await call(body(), {}, { authorization: "Bearer forged" });
  assertEquals(res.status, 401);
  const deps = testDeps();
  const pre = await handler(new Request(URL_, { method: "OPTIONS", headers: { origin: ORIGIN } }), deps);
  assertEquals(pre.status, 204);
  const get = await handler(new Request(URL_, { headers: { origin: ORIGIN } }), deps);
  assertEquals(get.status, 405);
});
