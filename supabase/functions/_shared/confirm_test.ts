import { assertEquals } from "@std/assert";
import { autoRefundId, confirmNoGateway, reconcilePayment } from "./confirm.ts";
import { confirmLikeDb, dbRaise, FakeCashfree, FakeStore, order, testDeps } from "./pay_testing.ts";
import type { OrderRow } from "./context.ts";

function setup(o: OrderRow = order(), opts: { holdsGone?: boolean } = {}) {
  const store = new FakeStore();
  store.orders.push(o);
  store.impls.online_order_confirm_payment = confirmLikeDb(store, opts);
  const cashfree = new FakeCashfree();
  const deps = testDeps({ store, cashfree });
  return { store, cashfree, deps, o };
}

Deno.test("autoRefundId: AUTO-<ref>, payment-specific ids capped at 40 chars", () => {
  assertEquals(autoRefundId("WEB-000001", null), "AUTO-WEB-000001");
  assertEquals(autoRefundId("WEB-000001", "1234567890123456789012345678"), "AUTO-WEB-000001-1234567890123456789012345678".slice(0, 40));
  assertEquals(autoRefundId("WEB-000001", "1234567890123456789012345678").length, 40);
});

Deno.test("reconcile: unknown order → not_found, Cashfree never asked", async () => {
  const { deps, cashfree } = setup();
  assertEquals(await reconcilePayment(deps, "WEB-999999"), { outcome: "not_found" });
  assertEquals(cashfree.getOrderCalls, 0);
});

Deno.test("reconcile: Cashfree not configured → not_configured", async () => {
  const { store } = setup();
  const deps = { ...testDeps({ store }), cashfree: null };
  assertEquals(await reconcilePayment(deps, "WEB-000001"), { outcome: "not_configured" });
});

Deno.test("reconcile: ACTIVE / missing Cashfree order → not_paid, no confirm", async () => {
  const { deps, store, cashfree, o } = setup();
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "not_paid", cfStatus: null });
  cashfree.orders.set(o.order_ref, { cfOrderId: "cf-1", orderRef: o.order_ref, status: "ACTIVE", amount: 1080, currency: "INR", paymentSessionId: "s" });
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "not_paid", cfStatus: "ACTIVE" });
  assertEquals(store.callsTo("online_order_confirm_payment").length, 0);
});

Deno.test("reconcile: PAID → confirm with the SUCCESS payment's id, amount and currency; jobs kicked", async () => {
  const { deps, store, cashfree, o } = setup();
  cashfree.pay(o);
  cashfree.payments.get(o.order_ref)!.unshift({ cfPaymentId: "pay-0", status: "FAILED", amount: 1080, currency: "INR", time: "2026-10-23T09:59:00Z" });
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "confirmed", status: "paid" });
  assertEquals(store.callsTo("online_order_confirm_payment"), [
    { p_order_ref: "WEB-000001", p_cf_payment_id: "pay-1", p_amount: 1080, p_currency: "INR" },
  ]);
  assertEquals(deps.kicks.n, 1);
  // Twice: idempotent ("already"), still kicks run-jobs (R2).
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "already", status: "paid" });
  assertEquals(deps.kicks.n, 2);
  assertEquals(cashfree.createdRefunds, []);
});

Deno.test("reconcile: late payment on an expired order whose holds are gone → exactly one AUTO refund, even when retried", async () => {
  const { deps, store, cashfree, o } = setup(order({ status: "expired" }), { holdsGone: true });
  cashfree.pay(o);
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "refund_required", refunds: ["AUTO-WEB-000001"] });
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "refund_required", refunds: ["AUTO-WEB-000001"] });
  assertEquals(cashfree.createdRefunds, [{ orderRef: "WEB-000001", refundId: "AUTO-WEB-000001", amount: 1080 }]);
  assertEquals(store.callsTo("online_order_log_event").filter((a) => a.p_kind === "auto_refund_created").length, 1);
});

Deno.test("reconcile R5: expired order with holds re-takeable → confirmed", async () => {
  const { deps, cashfree, o } = setup(order({ status: "expired" }));
  cashfree.pay(o);
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "confirmed", status: "paid" });
  assertEquals(cashfree.createdRefunds, []);
});

Deno.test("reconcile: a second successful payment on a paid order is refunded under its own id", async () => {
  const { deps, cashfree, o } = setup();
  cashfree.pay(o, "pay-1");
  cashfree.pay(o, "pay-2");
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "confirmed", status: "paid" });
  assertEquals(cashfree.createdRefunds, [{ orderRef: "WEB-000001", refundId: "AUTO-WEB-000001-pay-2", amount: 1080 }]);
});

Deno.test("reconcile R4: amount / currency / cf_order_id mismatch → no confirm, problem flagged, captured money refunded", async () => {
  for (
    const [name, tweak] of [
      ["amount", (cf: FakeCashfree, ref: string) => (cf.orders.get(ref)!.amount = 999)],
      ["currency", (cf: FakeCashfree, ref: string) => (cf.orders.get(ref)!.currency = "USD")],
      ["cf_order_id", (cf: FakeCashfree, ref: string) => (cf.orders.get(ref)!.cfOrderId = "cf-other")],
    ] as const
  ) {
    const { deps, store, cashfree, o } = setup();
    cashfree.pay(o);
    tweak(cashfree, o.order_ref);
    const r = await reconcilePayment(deps, o.order_ref);
    assertEquals(r, { outcome: "refund_required", refunds: ["AUTO-WEB-000001"] }, name);
    assertEquals(store.callsTo("online_order_confirm_payment").length, 0, name);
    assertEquals(store.callsTo("online_order_set_problem").length, 1, name);
    assertEquals(cashfree.createdRefunds.length, 1, name);
  }
});

Deno.test("reconcile: no stored cf_order_id (checkpoint lost) still confirms", async () => {
  const { deps, cashfree, o } = setup(order({ cf_order_id: null }));
  cashfree.pay(o);
  assertEquals((await reconcilePayment(deps, o.order_ref)).outcome, "confirmed");
});

Deno.test("reconcile: DB 'payment mismatch' raise → refunded, not thrown", async () => {
  const { deps, store, cashfree, o } = setup();
  store.impls.online_order_confirm_payment = dbRaise("payment mismatch: amount 1080 for order WEB-000001 (expected 1000)");
  cashfree.pay(o);
  assertEquals(await reconcilePayment(deps, o.order_ref), { outcome: "refund_required", refunds: ["AUTO-WEB-000001"] });
  assertEquals(cashfree.createdRefunds.length, 1);
});

Deno.test("confirmNoGateway: NO_GATEWAY, 0, INR and a jobs kick", async () => {
  const { deps, store } = setup(order({ gateway_amount: 0 }));
  const r = await confirmNoGateway(deps, "WEB-000001");
  assertEquals(r, { result: "confirmed", status: "paid" });
  assertEquals(store.callsTo("online_order_confirm_payment"), [
    { p_order_ref: "WEB-000001", p_cf_payment_id: "NO_GATEWAY", p_amount: 0, p_currency: "INR" },
  ]);
  assertEquals(deps.kicks.n, 1);
});
