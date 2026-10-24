import { assert, assertEquals } from "@std/assert";
import { type Deps, handler } from "./index.ts";
import { FakeDb, FakeShiprocket, FULL_PLAN, ITEM_A, ITEM_B, ORDER_ID } from "../_shared/process_fakes.ts";
import type { ProcessPlan } from "../_shared/process.ts";
import type { SrOrderInput } from "../_shared/shiprocket.ts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const SUPER = "22222222-2222-4222-8222-222222222222";
const SHOPPER = "33333333-3333-4333-8333-333333333333";
const TOKENS: Record<string, string> = { "admin-jwt": ADMIN, "super-jwt": SUPER, "shopper-jwt": SHOPPER };
const ORIGIN = "https://www.bindalscreations.com";

function setup(order: ConstructorParameters<typeof FakeDb>[0] = {}, plan: ProcessPlan = FULL_PLAN) {
  const db = new FakeDb(order, plan);
  const sr = new FakeShiprocket();
  const deps: Deps = {
    db,
    shiprocket: sr,
    shopEmail: "shop@example.com",
    verifyJwt: (jwt) => Promise.resolve(TOKENS[jwt] ? { id: TOKENS[jwt] } : null),
    isAdmin: (id) => Promise.resolve(id === ADMIN || id === SUPER),
    isSuperadmin: (id) => Promise.resolve(id === SUPER),
    publicKeys: ["anon-key"],
    allowedOrigins: [ORIGIN],
  };
  const call = async (body: unknown, jwt = "admin-jwt") => {
    const res = await handler(
      new Request("http://local/admin-order-action", {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      }),
      deps,
    );
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return { db, sr, deps, call };
}

const PROCESS = { action: "process", orderId: ORDER_ID, opKey: "op-1" };
const STEPS = ["assignAwb", "pickup", "manifest", "label"] as const;

Deno.test("non-admin JWT → 403, no DB call", async () => {
  const { db, call } = setup();
  const r = await call(PROCESS, "shopper-jwt");
  assertEquals(r.status, 403);
  assertEquals(r.body.code, "forbidden");
  assertEquals(db.calls.length, 0);
});

Deno.test("anon key bearer → 401", async () => {
  const { call } = setup();
  assertEquals((await call(PROCESS, "anon-key")).status, 401);
});

Deno.test("preflight from the allowed origin → 204 with CORS; CORS echoed on POST", async () => {
  const { deps, call } = setup();
  const pre = await handler(new Request("http://local/x", { method: "OPTIONS", headers: { origin: ORIGIN } }), deps);
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get("access-control-allow-origin"), ORIGIN);
  const r = await call({ action: "nope" });
  assertEquals(r.status, 400);
  assertEquals(r.headers.get("access-control-allow-origin"), ORIGIN);
});

Deno.test("set_availability → DB function with actor; returns the order", async () => {
  const { db, call } = setup();
  const r = await call({ action: "set_availability", orderId: ORDER_ID, itemId: ITEM_B, availableQty: 1 });
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.order.id, ORDER_ID);
  assertEquals(db.calls, [{
    fn: "online_order_set_availability",
    args: { p_order_id: ORDER_ID, p_item_id: ITEM_B, p_available_qty: 1, p_actor: ADMIN },
  }]);
});

Deno.test("set_availability refused by the DB → 409 bad_state; bad qty → 400", async () => {
  const { call } = setup({ status: "packed" });
  const r = await call({ action: "set_availability", orderId: ORDER_ID, itemId: ITEM_B, availableQty: 1 });
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
  const bad = await call({ action: "set_availability", orderId: ORDER_ID, itemId: ITEM_B, availableQty: -1 });
  assertEquals([bad.status, bad.body.code], [400, "invalid_request"]);
});

Deno.test("process happy path: steps in order, checkpoints after each, marks packed", async () => {
  const { db, sr, call } = setup();
  const r = await call(PROCESS);
  assertEquals(r.status, 200);
  assertEquals(r.body.billId, 9001);
  assertEquals(r.body.order.status, "packed");
  assertEquals(sr.methods(), ["assignAwb", "pickup", "manifest", "label"]);
  assertEquals(sr.calls[0].args, [222, 10]); // quoted courier preferred
  assertEquals(sr.calls[2].args, [222, 111]);
  assertEquals(db.fns(), [
    "online_order_claim",
    "online_order_prepare_process",
    "checkpoint:awb",
    "checkpoint:pickup",
    "checkpoint:manifest",
    "checkpoint:label",
    "online_order_mark_packed",
  ]);
  const packed = db.calls.at(-1)!.args;
  assertEquals(packed.p_shipment, {
    awb: "AWB1",
    courier_id: 10,
    courier_name: "Delhivery",
    manifest_url: "https://example.test/manifest.pdf",
    label_url: "https://example.test/label.pdf",
  });
});

Deno.test("process with partial availability updates the Shiprocket order first", async () => {
  const plan: ProcessPlan = {
    shippable_items: [{ item_id: ITEM_A, units: 1, paid_value: 3000 }, { item_id: ITEM_B, units: 1, paid_value: 500 }],
    all_unavailable: false,
    refund_id: "refund-unavail",
  };
  const { db, sr, call } = setup({}, plan);
  const r = await call(PROCESS);
  assertEquals(r.status, 200);
  assertEquals(r.body.refundId, "refund-unavail");
  assertEquals(sr.methods(), ["updateOrder", "assignAwb", "pickup", "manifest", "label"]);
  const input = sr.calls[0].args[0] as SrOrderInput;
  assertEquals(input.items.map((i) => [i.sku, i.units, i.sellingPrice]), [["BC25001-M-Red", 1, 3000], [
    "BC25002-L-Blue",
    1,
    500,
  ]]);
  assertEquals(input.subTotal, 3500);
  assertEquals(input.weightKg, 2.5);
  assertEquals(db.fns().slice(2, 3), ["checkpoint:sr_update"]);
});

Deno.test("process when the create job never succeeded runs it inline first", async () => {
  const { sr, call } = setup({ sr_order_id: null, sr_shipment_id: null });
  const r = await call(PROCESS);
  assertEquals(r.status, 200);
  assertEquals(sr.methods(), ["createOrder", "assignAwb", "pickup", "manifest", "label"]);
});

for (const failing of STEPS) {
  Deno.test(`process: ${failing} fails → 502 courier_error; retry resumes without repeating earlier calls`, async () => {
    const { db, sr, call } = setup();
    sr.failOnce.add(failing);
    const first = await call(PROCESS);
    assertEquals([first.status, first.body.code], [502, "courier_error"]);
    assertEquals(db.order.status, "processing");
    assert(String(db.order.process_error).includes("injected failure"));
    assertEquals(db.fns().at(-1), "checkpoint:error");

    const retry = await call({ action: "retry", orderId: ORDER_ID });
    assertEquals(retry.status, 200, JSON.stringify(retry.body));
    assertEquals(retry.body.order.status, "packed");
    assertEquals(retry.body.billId, 9001);
    for (const step of STEPS) {
      assertEquals(sr.count(step), step === failing ? 2 : 1, `${step} calls after ${failing} failed`);
    }
    // retry reused the stored op key
    const claims = db.calls.filter((c) => c.fn === "online_order_claim").map((c) => c.args.p_op_key);
    assertEquals(claims, ["op-1", "op-1"]);
  });
}

Deno.test("concurrent process with another op key → 409 busy, first still completes", async () => {
  const { sr, call } = setup();
  let release!: () => void;
  sr.gates.set("assignAwb", new Promise<void>((r) => (release = r)));
  const first = call(PROCESS);
  while (sr.count("assignAwb") === 0) await new Promise((r) => setTimeout(r, 0));
  const second = await call({ ...PROCESS, opKey: "op-2" });
  assertEquals([second.status, second.body.code], [409, "busy"]);
  release();
  const done = await first;
  assertEquals(done.status, 200);
  assertEquals(sr.count("assignAwb"), 1);
});

Deno.test("retry while a live process holds the lease → 409 busy, no Shiprocket call", async () => {
  const { sr, call } = setup({
    status: "processing",
    op_key: "op-1",
    op_action: "process",
    op_lease_until: new Date(Date.now() + 60_000).toISOString(),
  });
  const r = await call({ action: "retry", orderId: ORDER_ID });
  assertEquals([r.status, r.body.code], [409, "busy"]);
  assertEquals(sr.calls.length, 0);
});

Deno.test("process on a non-paid order → 409 bad_state", async () => {
  const { call } = setup({ status: "packed" });
  const r = await call(PROCESS);
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
});

Deno.test("all units unavailable → Shiprocket order cancelled, refund returned, no AWB", async () => {
  const { db, sr, call } = setup({}, { shippable_items: [], all_unavailable: true, refund_id: "refund-all" });
  const r = await call(PROCESS);
  assertEquals(r.status, 200);
  assertEquals(r.body.refundId, "refund-all");
  assertEquals(r.body.order.status, "cancelled");
  assertEquals(sr.methods(), ["cancel"]);
  assertEquals(sr.calls[0].args, [[111]]);
  assertEquals(db.order.problem, null);
});

Deno.test("cancel before AWB: DB cancel + refund, then Shiprocket order cancelled", async () => {
  const { db, sr, call } = setup();
  const r = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "customer asked" });
  assertEquals(r.status, 200);
  assertEquals(r.body.refundId, "refund-cancel");
  assertEquals(r.body.order.status, "cancelled");
  assertEquals(db.fns(), ["online_order_claim", "online_order_cancel"]);
  assertEquals(db.calls[1].args, { p_order_id: ORDER_ID, p_actor: ADMIN, p_reason: "customer asked" });
  assertEquals(sr.methods(), ["cancel"]);
  assertEquals(sr.calls[0].args, [[111]]);
});

Deno.test("cancel after AWB: no Shiprocket cancel, problem set, still cancelled + refunded", async () => {
  const { db, sr, call } = setup({ awb: "AWB9" });
  const r = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "customer asked" });
  assertEquals(r.status, 200);
  assertEquals(r.body.refundId, "refund-cancel");
  assertEquals(sr.calls.length, 0);
  assert(String(db.order.problem).startsWith("Cancel the AWB in Shiprocket dashboard"));
  assertEquals(db.order.status, "cancelled");
});

Deno.test("cancel: Shiprocket cancel failure → problem set, order still cancelled", async () => {
  const { db, sr, call } = setup();
  sr.failOnce.add("cancel");
  const r = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "customer asked" });
  assertEquals(r.status, 200);
  assert(String(db.order.problem).includes("Shiprocket cancel failed"));
});

Deno.test("cancel while processing → 409 busy; missing reason → 400", async () => {
  const { call } = setup({
    status: "processing",
    op_key: "op-1",
    op_action: "process",
    op_lease_until: new Date(Date.now() + 60_000).toISOString(),
  });
  const r = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "x" });
  assertEquals([r.status, r.body.code], [409, "busy"]);
  const noReason = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: " " });
  assertEquals(noReason.status, 400);
});

Deno.test("retry on a paid order whose create job failed: resets jobs and creates inline", async () => {
  const { db, sr, call } = setup({ sr_order_id: null, sr_shipment_id: null });
  db.jobsReset = 1;
  const r = await call({ action: "retry", orderId: ORDER_ID });
  assertEquals(r.status, 200);
  assertEquals(db.fns().slice(0, 1), ["online_job_retry"]);
  assertEquals(sr.methods(), ["createOrder"]);
  assertEquals(r.body.order.sr_order_id, "111");
});

Deno.test("retry: inline create fails → 502 courier_error", async () => {
  const { sr, call } = setup({ sr_order_id: null, sr_shipment_id: null });
  sr.failOnce.add("createOrder");
  const r = await call({ action: "retry", orderId: ORDER_ID });
  assertEquals([r.status, r.body.code], [502, "courier_error"]);
});

Deno.test("rto_received → refund id", async () => {
  const { call } = setup({ status: "rto" });
  const r = await call({ action: "rto_received", orderId: ORDER_ID });
  assertEquals(r.status, 200);
  assertEquals(r.body.refundId, "refund-rto");
  assertEquals(r.body.order.status, "rto_received");
});

Deno.test("set_live: admin → 403; superadmin → DB function", async () => {
  const { db, call } = setup();
  const denied = await call({ action: "set_live", live: true });
  assertEquals(denied.status, 403);
  assertEquals(db.calls.length, 0);
  const ok = await call({ action: "set_live", live: true }, "super-jwt");
  assertEquals(ok.status, 200);
  assertEquals(ok.body, { ok: true, order: null, live: true });
  assertEquals(db.calls, [{ fn: "online_set_checkout_live", args: { p_live: true, p_actor: SUPER } }]);
});
