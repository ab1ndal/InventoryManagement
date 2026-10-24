import { assertEquals } from "@std/assert";
import { handler, legStatus } from "./handler.ts";
import { confirmLikeDb, FakeStore, order, signedWebhook, testDeps } from "../_shared/pay_testing.ts";

const LEG = "55555555-5555-4555-8555-555555555555";

const success = {
  type: "PAYMENT_SUCCESS_WEBHOOK",
  event_time: "2026-10-23T10:05:00+05:30",
  data: {
    order: { order_id: "WEB-000001", order_amount: 1080.0, order_currency: "INR" },
    payment: { cf_payment_id: "pay-1", payment_status: "SUCCESS", payment_amount: 1080.0, payment_currency: "INR" },
  },
};

function setup(o = order(), opts: { holdsGone?: boolean } = {}) {
  const store = new FakeStore();
  store.orders.push(o);
  store.impls.online_order_confirm_payment = confirmLikeDb(store, opts);
  return { store, deps: testDeps({ store }), o };
}

Deno.test("webhook: success twice → 200 both, confirmed once, then 'already' (idempotent)", async () => {
  const { deps, store, o } = setup();
  deps.cashfree.pay(o);
  assertEquals((await handler(await signedWebhook(success), deps)).status, 200);
  assertEquals((await handler(await signedWebhook(success), deps)).status, 200);
  assertEquals(store.callsTo("online_order_confirm_payment").length, 2);
  assertEquals(store.orders[0].status, "paid");
  assertEquals(deps.cashfree.createdRefunds, []);
});

Deno.test("webhook: bad signature or tampered body → 401 and no DB/Cashfree call", async () => {
  const { deps, store } = setup();
  const bad = await signedWebhook(success, "wrong-secret");
  assertEquals((await handler(bad, deps)).status, 401);
  const good = await signedWebhook(success);
  const tampered = new Request(good.url, { method: "POST", headers: good.headers, body: (await good.text()).replace("1080", "1") });
  assertEquals((await handler(tampered, deps)).status, 401);
  const unsigned = new Request(good.url, { method: "POST", body: JSON.stringify(success) });
  assertEquals((await handler(unsigned, deps)).status, 401);
  assertEquals(store.calls, []);
  assertEquals(deps.cashfree.getOrderCalls, 0);
});

Deno.test("webhook: success for an expired order with holds gone → one AUTO refund across retries", async () => {
  const { deps } = setup(order({ status: "expired" }), { holdsGone: true });
  deps.cashfree.pay(deps.store.orders[0]);
  for (let i = 0; i < 2; i++) assertEquals((await handler(await signedWebhook(success), deps)).status, 200);
  assertEquals(deps.cashfree.createdRefunds, [{ orderRef: "WEB-000001", refundId: "AUTO-WEB-000001", amount: 1080 }]);
});

Deno.test("webhook R5: failed then success → failure only logged, order confirmed afterwards", async () => {
  const { deps, store, o } = setup();
  const failed = {
    type: "PAYMENT_FAILED_WEBHOOK",
    data: {
      order: { order_id: "WEB-000001" },
      payment: { cf_payment_id: "pay-0", payment_status: "FAILED", payment_message: "declined" },
      error_details: { error_code: "TRANSACTION_DECLINED", error_reason: "bank" },
    },
  };
  assertEquals((await handler(await signedWebhook(failed), deps)).status, 200);
  assertEquals(store.callsTo("online_order_fail").length, 0);
  assertEquals(store.callsTo("online_order_log_event")[0].p_kind, "payment_attempt_failed");
  assertEquals(store.orders[0].status, "pending_payment");
  deps.cashfree.pay(o);
  await handler(await signedWebhook(success), deps);
  assertEquals(store.orders[0].status, "paid");
});

Deno.test("webhook: user dropped → event only", async () => {
  const { deps, store } = setup();
  const dropped = { type: "PAYMENT_USER_DROPPED_WEBHOOK", data: { order: { order_id: "WEB-000001" }, payment: { payment_status: "USER_DROPPED" } } };
  assertEquals((await handler(await signedWebhook(dropped), deps)).status, 200);
  assertEquals(store.calls.map((c) => c.fn), ["online_order_log_event"]);
});

Deno.test("webhook: refund status → online_refund_set_status on the leg; AUTO- refunds only logged", async () => {
  const { deps, store } = setup();
  const refund = (refund_id: string, refund_status: string) => ({
    type: "REFUND_STATUS_WEBHOOK",
    data: { refund: { refund_id, cf_refund_id: "cfr-9", order_id: "WEB-000001", refund_status, refund_amount: 500 } },
  });
  await handler(await signedWebhook(refund(LEG, "SUCCESS")), deps);
  assertEquals(store.callsTo("online_refund_set_status"), [
    { p_leg_id: LEG, p_status: "completed", p_cf_refund_id: "cfr-9", p_note: "Cashfree SUCCESS" },
  ]);
  await handler(await signedWebhook(refund("AUTO-WEB-000001", "SUCCESS")), deps);
  assertEquals(store.callsTo("online_refund_set_status").length, 1);
  assertEquals(store.callsTo("online_order_log_event").at(-1)?.p_kind, "auto_refund_status");
  assertEquals([legStatus("SUCCESS"), legStatus("CANCELLED"), legStatus("REJECTED"), legStatus("PENDING"), legStatus("ONHOLD")], [
    "completed",
    "failed",
    "failed",
    "processing",
    "processing",
  ]);
});

Deno.test("webhook: verified but failing processing still answers 200; unknown order / type ignored", async () => {
  const { deps, store } = setup();
  store.impls.online_refund_set_status = () => {
    throw new Error("leg not found");
  };
  const refund = { type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_id: LEG, refund_status: "SUCCESS" } } };
  assertEquals((await handler(await signedWebhook(refund), deps)).status, 200);
  const other = { ...success, data: { ...success.data, order: { order_id: "WEB-777777" } } };
  assertEquals((await handler(await signedWebhook(other), deps)).status, 200);
  assertEquals((await handler(await signedWebhook({ type: "PAYMENT_CHARGES_WEBHOOK", data: {} }), deps)).status, 200);
});

Deno.test("webhook: Cashfree not configured → 503 (Cashfree retries later)", async () => {
  const { store } = setup();
  const deps = { ...testDeps({ store }), cashfree: null };
  assertEquals((await handler(await signedWebhook(success), deps)).status, 503);
});
