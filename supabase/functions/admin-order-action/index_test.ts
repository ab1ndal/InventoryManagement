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

function setup(
  order: ConstructorParameters<typeof FakeDb>[0] = {},
  plan: ProcessPlan = FULL_PLAN,
  rebookApiCancel = false,
) {
  const db = new FakeDb(order, plan);
  const sr = new FakeShiprocket();
  const storageCalls: Record<string, unknown>[] = [];
  const deps: Deps = {
    db,
    shiprocket: sr,
    shopEmail: "shop@example.com",
    verifyJwt: (jwt) => Promise.resolve(TOKENS[jwt] ? { id: TOKENS[jwt] } : null),
    isAdmin: (id) => Promise.resolve(id === ADMIN || id === SUPER),
    isSuperadmin: (id) => Promise.resolve(id === SUPER),
    storage: {
      createUploadUrl: (path) => {
        storageCalls.push({ fn: "upload", path });
        return Promise.resolve({
          uploadUrl: `https://storage.test/upload/${path}?token=t`,
          token: "t",
        });
      },
      createViewUrl: (path, seconds) => {
        storageCalls.push({ fn: "view", path, seconds });
        return Promise.resolve(path.startsWith("gone/") ? null : `https://storage.test/view/${path}`);
      },
    },
    publicKeys: ["anon-key"],
    allowedOrigins: [ORIGIN],
    rebookApiCancel,
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
  return { db, sr, deps, call, storageCalls };
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
  // the lease is renewed (same op key) right before each Shiprocket call
  assertEquals(db.fns(), [
    "online_order_claim",
    "online_order_prepare_process",
    "online_order_claim",
    "checkpoint:awb",
    "online_order_claim",
    "checkpoint:pickup",
    "online_order_claim",
    "checkpoint:manifest",
    "online_order_claim",
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
  assertEquals(db.fns().slice(2, 4), ["online_order_claim", "checkpoint:sr_update"]);
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
    // A timeout: assignAwb must not fall back to another courier after one.
    sr.failStatus = 0;
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
    // retry reused the stored op key (initial claims and per-step renewals alike)
    const claims = db.calls.filter((c) => c.fn === "online_order_claim").map((c) => c.args.p_op_key);
    assertEquals(new Set(claims), new Set(["op-1"]));
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

Deno.test("cancel on an order a rebook already cancelled → 200 with the order, no refundId", async () => {
  const { db, sr, call } = setup({ status: "cancelled" });
  const r = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "customer asked" });
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.order.status, "cancelled");
  assert(!("refundId" in r.body));
  assertEquals(db.fns(), ["online_order_claim"]);
  assertEquals(sr.calls.length, 0);
});

const STUCK = { status: "processing", op_key: "op-1", op_action: "process", op_lease_until: "2026-10-26T00:00:00Z" };
const PACKED = { status: "packed", awb: "AWB1", label_url: "https://example.test/label.pdf", bill_id: 9001 };
const SEND_BACK = { action: "send_back", orderId: ORDER_ID, opKey: "sb-1" };
const REBOOK = { action: "rebook", orderId: ORDER_ID, opKey: "rb-1", parcelLost: false, note: "wrong item packed" };

Deno.test("send_back: cancels the AWB and returns the order back in paid", async () => {
  const { db, sr, call } = setup({ ...STUCK, awb: "AWB1" }, FULL_PLAN, true);
  const r = await call(SEND_BACK);
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.order.status, "paid");
  assert(!("refundId" in r.body));
  assertEquals(sr.methods(), ["cancelAwbs"]);
  assertEquals(db.fns(), ["online_order_claim", "checkpoint:sr_cancelled", "online_order_send_back"]);
});

Deno.test("send_back: live Process → 409 busy; paid order → 409 bad_state; missing opKey → 400", async () => {
  const live = setup({ ...STUCK, op_lease_until: new Date(Date.now() + 60_000).toISOString() });
  const busy = await live.call(SEND_BACK);
  assertEquals([busy.status, busy.body.code], [409, "busy"]);
  const paid = setup();
  const r = await paid.call(SEND_BACK);
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
  assertEquals((await paid.call({ action: "send_back", orderId: ORDER_ID })).status, 400);
});

Deno.test("send_back: courier cancel fails → 502 courier_error with the problem text", async () => {
  const { sr, call } = setup({ ...STUCK, awb: "AWB1" }, FULL_PLAN, true);
  sr.failOnce.add("cancelAwbs");
  const r = await call(SEND_BACK);
  assertEquals([r.status, r.body.code], [502, "courier_error"]);
  assertEquals(r.body.error, "Cancel AWB AWB1 / Shiprocket order 111 in Shiprocket dashboard");
});

Deno.test("manual cancel confirmation by an admin → 403, no DB call", async () => {
  const { db, call } = setup(PACKED);
  const r = await call({ ...REBOOK, manualCancelConfirmed: true });
  assertEquals([r.status, r.body.code], [403, "forbidden"]);
  const sb = await call({ ...SEND_BACK, manualCancelConfirmed: true });
  assertEquals(sb.status, 403);
  assertEquals(db.calls.length, 0);
});

Deno.test("manual cancel confirmation by a superadmin finalizes without the API", async () => {
  const { db, sr, call } = setup(PACKED);
  const r = await call({ ...REBOOK, manualCancelConfirmed: true }, "super-jwt");
  assertEquals(r.status, 200);
  assertEquals(r.body.order.status, "paid");
  assertEquals(sr.calls.length, 0);
  assertEquals(db.fns(), ["online_order_claim", "online_order_confirm_manual_cancel", "online_order_rebook"]);
  assertEquals(db.calls[1].args, { p_order_id: ORDER_ID, p_actor: SUPER, p_op_key: "rb-1" });
});

Deno.test("rebook with REBOOK_API_CANCEL off and no confirmation → 502 asking for manual confirmation", async () => {
  const { db, sr, call } = setup(PACKED);
  const r = await call(REBOOK);
  assertEquals([r.status, r.body.code], [502, "courier_error"]);
  assertEquals(
    r.body.error,
    "Courier booking AWB AWB1 must be cancelled in the Shiprocket dashboard; a superadmin then confirms it here.",
  );
  assertEquals(sr.calls.length, 0);
  assertEquals(db.order.status, "packed");
});

Deno.test("rebook with REBOOK_API_CANCEL on: parcel lost, nothing left → cancelled with refundId", async () => {
  const { sr, call } = setup(PACKED, FULL_PLAN, true);
  const r = await call({ ...REBOOK, parcelLost: true });
  assertEquals(r.status, 200);
  assertEquals(r.body.refundId, "refund-rebook");
  assertEquals(r.body.order.status, "cancelled");
  assertEquals(sr.methods(), ["cancelAwbs"]);
});

Deno.test("rebook note required (400)", async () => {
  const { db, call } = setup(PACKED);
  const r = await call({ ...REBOOK, note: "  " });
  assertEquals([r.status, r.body.code], [400, "invalid_request"]);
  assertEquals((await call({ ...REBOOK, note: undefined })).status, 400);
  assertEquals(db.calls.length, 0);
});

Deno.test("rebook parcelLost must be boolean (400); manualCancelConfirmed must be boolean (400)", async () => {
  const { db, call } = setup(PACKED);
  assertEquals((await call({ ...REBOOK, parcelLost: "yes" })).status, 400);
  assertEquals((await call({ ...REBOOK, parcelLost: undefined })).status, 400);
  assertEquals((await call({ ...REBOOK, manualCancelConfirmed: "true" })).status, 400);
  assertEquals(db.calls.length, 0);
});

const RELEASE = { action: "release_op", orderId: ORDER_ID, opKey: "rb-1" };

Deno.test("release_op: abandons a rebook claim (any admin) → 200 with the order, op cleared", async () => {
  const { db, sr, call } = setup({ ...PACKED, op_key: "rb-1", op_action: "rebook", op_lease_until: new Date(Date.now() + 60_000).toISOString() });
  const r = await call(RELEASE);
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.order.status, "packed");
  assertEquals(r.body.order.op_action, null);
  assertEquals(db.calls, [{ fn: "online_order_release_op", args: { p_order_id: ORDER_ID, p_actor: ADMIN, p_op_key: "rb-1" } }]);
  assertEquals(sr.calls.length, 0);
});

Deno.test("release_op: send_back released → stalled Process again (lease expired, Retry can resume)", async () => {
  const { db, call } = setup({ ...STUCK, op_key: "sb-1", op_action: "send_back", op_lease_until: new Date(Date.now() + 60_000).toISOString() });
  const r = await call({ ...RELEASE, opKey: "sb-1" });
  assertEquals(r.status, 200);
  assertEquals([r.body.order.status, r.body.order.op_action, r.body.order.op_key], ["processing", "process", "sb-1"]);
  assert(Date.parse(db.order.op_lease_until!) < Date.now());
});

Deno.test("release_op refused by the DB (booking already cancelled / other key, live lease) → 409 bad_state", async () => {
  const cancelled = setup({ ...PACKED, op_key: "rb-1", op_action: "rebook", sr_cancelled_op_key: "rb-1", op_lease_until: new Date(Date.now() + 60_000).toISOString() });
  const r = await cancelled.call(RELEASE);
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
  assert(r.body.error.includes("release: courier booking already cancelled — finish the action"), r.body.error);
  assertEquals(cancelled.db.order.op_action, "rebook");
  const live = setup({ ...PACKED, op_key: "rb-other", op_action: "rebook", op_lease_until: new Date(Date.now() + 60_000).toISOString() });
  assertEquals((await live.call(RELEASE)).body.code, "bad_state");
});

Deno.test("release_op: opKey and orderId required (400), no DB call", async () => {
  const { db, call } = setup(PACKED);
  assertEquals((await call({ action: "release_op", orderId: ORDER_ID })).status, 400);
  assertEquals((await call({ action: "release_op", orderId: "x", opKey: "k" })).status, 400);
  assertEquals(db.calls.length, 0);
});
const RETURN_ID = "99999999-9999-4999-8999-999999999999";
const PHOTO_ID = "88888888-8888-4888-8888-888888888888";
const OPEN_RETURN = {
  action: "return_open",
  orderId: ORDER_ID,
  reason: "damaged_wrong",
  contactedAt: "2026-10-20T10:00:00Z",
  items: [{ itemId: ITEM_A, units: 1 }],
  note: "torn seam",
};

Deno.test("mark_delivered: admin → 403, no DB call; superadmin → RPC with actor", async () => {
  const body = {
    action: "mark_delivered",
    orderId: ORDER_ID,
    deliveredAt: "2026-10-20T10:00:00Z",
    reason: "courier confirmed",
  };
  const { db, call } = setup();
  const denied = await call(body);
  assertEquals([denied.status, denied.body.code], [403, "forbidden"]);
  assertEquals(db.calls.length, 0);
  const ok = await call(body, "super-jwt");
  assertEquals(ok.status, 200);
  assertEquals(db.calls, [{
    fn: "online_order_mark_delivered",
    args: {
      p_order_id: ORDER_ID,
      p_actor: SUPER,
      p_delivered_at: "2026-10-20T10:00:00Z",
      p_reason: "courier confirmed",
    },
  }]);
  assertEquals((await call({ ...body, reason: " " }, "super-jwt")).status, 400);
  assertEquals(
    (await call({ ...body, deliveredAt: "yesterday" }, "super-jwt")).status,
    400,
  );
});

Deno.test("return_open passes the superadmin flag (false for admin, true for superadmin) and returns returnId", async () => {
  const { db, call } = setup();
  const a = await call(OPEN_RETURN);
  assertEquals(a.status, 200);
  assertEquals(a.body.returnId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assertEquals(db.calls[0].args.p_is_superadmin, false);
  await call({ ...OPEN_RETURN, overrideReason: "VIP" }, "super-jwt");
  assertEquals(db.calls[1].args.p_is_superadmin, true);
  assertEquals(db.calls[1].args.p_override_reason, "VIP");
  assertEquals(db.calls[0].args.p_items, [{ item_id: ITEM_A, units: 1 }]);
});

Deno.test("return_open input validation → 400, no DB call", async () => {
  const { db, call } = setup();
  for (
    const bad of [
      { ...OPEN_RETURN, note: undefined },
      { ...OPEN_RETURN, reason: "regret" },
      { ...OPEN_RETURN, items: [{ itemId: ITEM_A, units: 1.5 }] },
    ]
  ) assertEquals((await call(bad)).status, 400);
  assertEquals(db.calls.length, 0);
});

Deno.test("return_open refused by the DB → 409 bad_state with the message", async () => {
  const { db, call } = setup();
  db.rpcRaises.set("online_return_open", "outside the 48 h window");
  const r = await call(OPEN_RETURN);
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
  assert(r.body.error.includes("outside the 48 h window"));
});

Deno.test("return_photo_url: ext from content type, path from the RPC, orderId/path fields ignored", async () => {
  const { db, call, storageCalls } = setup();
  db.returnOrders.set(RETURN_ID, ORDER_ID);
  const r = await call({
    action: "return_photo_url",
    returnId: RETURN_ID,
    contentType: "image/heif",
    orderId: "other",
    path: "../evil/x.jpg",
  });
  assertEquals(r.status, 200);
  const path = `${ORDER_ID}/${RETURN_ID}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.heic`;
  assertEquals(r.body, {
    ok: true,
    uploadUrl: `https://storage.test/upload/${path}?token=t`,
    path,
    token: "t",
  });
  assertEquals(db.calls, [{
    fn: "online_return_photo_path",
    args: { p_return_id: RETURN_ID, p_ext: "heic" },
  }]);
  assertEquals(storageCalls, [{ fn: "upload", path }]);
});

Deno.test("return_photo_url: application/pdf → 400, nothing called", async () => {
  const { db, call, storageCalls } = setup();
  const r = await call({
    action: "return_photo_url",
    returnId: RETURN_ID,
    contentType: "application/pdf",
  });
  assertEquals(r.status, 400);
  assertEquals(db.calls.length + storageCalls.length, 0);
});

Deno.test("return_photo_add → RPC with actor; the client path is passed through for the DB to validate", async () => {
  const { db, call } = setup();
  db.returnOrders.set(RETURN_ID, ORDER_ID);
  const r = await call({
    action: "return_photo_add",
    returnId: RETURN_ID,
    path: "p.jpg",
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.photoId, "ffffffff-ffff-4fff-8fff-ffffffffffff");
  assertEquals(db.calls, [{
    fn: "online_return_add_photo",
    args: { p_return_id: RETURN_ID, p_path: "p.jpg", p_actor: ADMIN },
  }]);
  assertEquals(
    (await call({ action: "return_photo_add", returnId: RETURN_ID })).status,
    400,
  );
});

Deno.test("return_photo_add replayed path (unique violation 23505) → 409 bad_state, not 500", async () => {
  const { db, call } = setup();
  db.returnOrders.set(RETURN_ID, ORDER_ID);
  db.rpcErrorCodes.set("online_return_add_photo", "23505");
  const r = await call({ action: "return_photo_add", returnId: RETURN_ID, path: "p.jpg" });
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
});

Deno.test("return_photo_view: unknown photo → 404; known → signed url for 10 minutes", async () => {
  const { db, call, storageCalls } = setup();
  const miss = await call({ action: "return_photo_view", photoId: PHOTO_ID });
  assertEquals([miss.status, miss.body.code], [404, "not_found"]);
  assertEquals(storageCalls.length, 0);
  db.photoPaths.set(PHOTO_ID, "o/r/p.jpg");
  const ok = await call({ action: "return_photo_view", photoId: PHOTO_ID });
  assertEquals(ok.body, {
    ok: true,
    url: "https://storage.test/view/o/r/p.jpg",
  });
  assertEquals(storageCalls, [{ fn: "view", path: "o/r/p.jpg", seconds: 600 }]);
});

Deno.test("return_preview and return_receive map camelCase items to RPC jsonb", async () => {
  const { db, call } = setup();
  db.returnOrders.set(RETURN_ID, ORDER_ID);
  const items = [{ itemId: ITEM_A, receivedUnits: 1, restockUnits: 0 }];
  const rpcItems = [{ item_id: ITEM_A, received_units: 1, restock_units: 0 }];
  const prev = await call({
    action: "return_preview",
    returnId: RETURN_ID,
    items,
  });
  assertEquals(prev.body, {
    ok: true,
    preview: { credit_part: 100, gateway_part: 400, shipping: 0, total: 500 },
  });
  const rec = await call({
    action: "return_receive",
    returnId: RETURN_ID,
    items,
    note: " ok ",
  });
  assertEquals(rec.status, 200);
  assertEquals(rec.body.refundId, "refund-return");
  assertEquals(rec.body.order.id, ORDER_ID);
  assertEquals(db.calls[0], {
    fn: "online_return_preview",
    args: { p_return_id: RETURN_ID, p_items: rpcItems },
  });
  assertEquals(db.calls[1], {
    fn: "online_return_receive",
    args: {
      p_return_id: RETURN_ID,
      p_actor: ADMIN,
      p_items: rpcItems,
      p_note: "ok",
    },
  });
});

Deno.test("return_receive DB raise → 409 bad_state; unknown return → 404", async () => {
  const { db, call } = setup();
  db.returnOrders.set(RETURN_ID, ORDER_ID);
  db.rpcRaises.set("online_return_receive", "at least one photo is required");
  const items = [{ itemId: ITEM_A, receivedUnits: 1, restockUnits: 1 }];
  const r = await call({
    action: "return_receive",
    returnId: RETURN_ID,
    items,
  });
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
  assert(r.body.error.includes("at least one photo"));
  const none = await call({
    action: "return_receive",
    returnId: "77777777-7777-4777-8777-777777777777",
    items,
  });
  assertEquals([none.status, none.body.code], [404, "not_found"]);
});

Deno.test("return_cancel → RPC with actor and note; note required", async () => {
  const { db, call } = setup();
  db.returnOrders.set(RETURN_ID, ORDER_ID);
  const r = await call({
    action: "return_cancel",
    returnId: RETURN_ID,
    note: "customer changed mind",
  });
  assertEquals(r.status, 200);
  assertEquals(db.calls, [{
    fn: "online_return_cancel",
    args: {
      p_return_id: RETURN_ID,
      p_actor: ADMIN,
      p_note: "customer changed mind",
    },
  }]);
  assertEquals(
    (await call({ action: "return_cancel", returnId: RETURN_ID })).status,
    400,
  );
});

Deno.test("the order in a response carries its returns", async () => {
  const { db, call } = setup();
  db.returns = [{
    id: RETURN_ID,
    items: [],
    photos: [{ id: PHOTO_ID, uploaded_at: "2026-10-21T00:00:00Z" }],
  }];
  const r = await call({
    action: "set_availability",
    orderId: ORDER_ID,
    itemId: ITEM_B,
    availableQty: 1,
  });
  assertEquals(r.body.order.returns[0].photos[0].id, PHOTO_ID);
});

Deno.test("return_photo_view: object missing in Storage → 404 not_found", async () => {
  const { db, call } = setup();
  db.photoPaths.set(PHOTO_ID, "gone/r/p.jpg");
  const r = await call({ action: "return_photo_view", photoId: PHOTO_ID });
  assertEquals([r.status, r.body.code], [404, "not_found"]);
});

for (
  const [name, order, body] of [
    ["process", {}, PROCESS],
    ["cancel", {}, { action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "customer asked" }],
    ["send_back", { ...STUCK, awb: "AWB1" }, SEND_BACK],
  ] as const
) {
  Deno.test(`${name}: internal reads use getOrder; only the response uses getOrderWithReturns`, async () => {
    const { db, call } = setup({ ...order }, FULL_PLAN, true);
    const r = await call(body);
    assertEquals(r.status, 200);
    // everything before the final response read is a plain getOrder (or no order read at all)
    assertEquals(db.orderReads.at(-1), "getOrderWithReturns");
    assertEquals(db.orderReads.slice(0, -1).filter((x) => x !== "getOrder"), []);
  });
}

// ---------- store pickup ----------

const PICKUP = { fulfilment: "pickup" as const, sr_order_id: null, sr_shipment_id: null, shipping: 0 };

Deno.test("pickup: process → 409 bad_state with a pickup reason, no claim, no Shiprocket", async () => {
  const { db, sr, call } = setup(PICKUP);
  const r = await call(PROCESS);
  assertEquals([r.status, r.body.code], [409, "bad_state"]);
  assert(String(r.body.error).includes("store pickup"));
  assertEquals([db.fns(), sr.methods()], [[], []]);
});

Deno.test("pickup: mark_ready → RPC with actor; returns the order and billId", async () => {
  const { db, sr, call } = setup(PICKUP);
  const r = await call({ action: "mark_ready", orderId: ORDER_ID });
  assertEquals(r.status, 200);
  assertEquals([r.body.order.status, r.body.billId, r.body.refundId], ["ready_for_pickup", 77, undefined]);
  assertEquals(db.calls, [{ fn: "online_order_mark_ready", args: { p_order_id: ORDER_ID, p_actor: ADMIN } }]);
  assertEquals(sr.methods(), []);
});

Deno.test("pickup: mark_ready on a ship order / twice → 409 bad_state; orderId required (400)", async () => {
  const ship = setup();
  assertEquals((await ship.call({ action: "mark_ready", orderId: ORDER_ID })).status, 409);
  const p = setup(PICKUP);
  await p.call({ action: "mark_ready", orderId: ORDER_ID });
  assertEquals((await p.call({ action: "mark_ready", orderId: ORDER_ID })).body.code, "bad_state");
  assertEquals((await p.call({ action: "mark_ready" })).status, 400);
});

Deno.test("pickup: mark_collected → delivered; from paid → 409 bad_state", async () => {
  const { db, call } = setup({ ...PICKUP, status: "ready_for_pickup" });
  const r = await call({ action: "mark_collected", orderId: ORDER_ID });
  assertEquals([r.status, r.body.order.status], [200, "delivered"]);
  assertEquals(db.calls, [{ fn: "online_order_mark_collected", args: { p_order_id: ORDER_ID, p_actor: ADMIN } }]);
  const paid = setup(PICKUP);
  assertEquals((await paid.call({ action: "mark_collected", orderId: ORDER_ID })).body.code, "bad_state");
});

Deno.test("pickup: cancel from ready_for_pickup → claim + DB cancel, no Shiprocket call or problem", async () => {
  const { db, sr, call } = setup({ ...PICKUP, status: "ready_for_pickup", bill_id: 77 });
  const r = await call({ action: "cancel", orderId: ORDER_ID, opKey: "c-1", reason: "not collected" });
  assertEquals([r.status, r.body.order.status, r.body.refundId], [200, "cancelled", "refund-cancel"]);
  assertEquals(db.fns(), ["online_order_claim", "online_order_cancel"]);
  assertEquals([sr.methods(), db.order.problem], [[], null]);
});

Deno.test("pickup: retry never books Shiprocket for a paid pickup order", async () => {
  const { sr, call } = setup(PICKUP);
  const r = await call({ action: "retry", orderId: ORDER_ID });
  assertEquals(r.status, 200);
  assertEquals(sr.methods(), []);
});

// ---------- Porter (dispatched by hand) ----------

const DISPATCH = { action: "dispatch_manual", orderId: ORDER_ID, trackingUrl: " https://porter.in/track/abc " };
const PORTER_SHIPPED = { status: "shipped", courier: "porter" as const, courier_name: "Porter", bill_id: 9001 };

Deno.test("dispatch_manual → RPC with the trimmed link; shipped; Shiprocket order from payment cancelled", async () => {
  const { db, sr, call } = setup();
  const r = await call(DISPATCH);
  assertEquals(r.status, 200);
  assertEquals([r.body.order.status, r.body.order.courier, r.body.billId], ["shipped", "porter", 9001]);
  assertEquals(db.calls[0], {
    fn: "online_order_dispatch_manual",
    args: { p_order_id: ORDER_ID, p_actor: ADMIN, p_tracking_url: "https://porter.in/track/abc" },
  });
  assertEquals(sr.calls, [{ method: "cancel", args: [[111]] }]);
  assertEquals(db.order.problem, null);
});

Deno.test("dispatch_manual: Shiprocket cancel fails → still dispatched, problem recorded for a dashboard cancel", async () => {
  const { db, sr, call } = setup();
  sr.failOnce.add("cancel");
  const r = await call({ action: "dispatch_manual", orderId: ORDER_ID });
  assertEquals([r.status, r.body.order.status], [200, "shipped"]);
  assertEquals(db.calls[0].args.p_tracking_url, null);
  assert(String(db.order.problem).includes("Shiprocket order 111 not cancelled"));
  assertEquals(db.fns(), ["online_order_dispatch_manual", "online_order_set_problem"]);
});

Deno.test("dispatch_manual: no Shiprocket order yet → no courier call; repeat → stored result, no second cancel", async () => {
  const none = setup({ sr_order_id: null, sr_shipment_id: null });
  assertEquals((await none.call(DISPATCH)).status, 200);
  assertEquals(none.sr.methods(), []);
  const { sr, call } = setup();
  await call(DISPATCH);
  const again = await call(DISPATCH);
  assertEquals([again.status, again.body.order.status], [200, "shipped"]);
  assertEquals(sr.count("cancel"), 1);
});

Deno.test("dispatch_manual: nothing on the shelf → cancelled with refund; Shiprocket order cancelled", async () => {
  const { sr, call } = setup({}, { shippable_items: [], all_unavailable: true, refund_id: "refund-unavailable" });
  const r = await call(DISPATCH);
  assertEquals(
    [r.status, r.body.order.status, r.body.refundId, r.body.billId],
    [200, "cancelled", "refund-unavailable", undefined],
  );
  assertEquals(sr.methods(), ["cancel"]);
});

Deno.test("dispatch_manual: bad link → 400 before any DB call; DB refusal → 409 bad_state", async () => {
  for (const trackingUrl of ["http://porter.in/x", "javascript:alert(1)", "porter.in/x", "https://porter.in/a b", 5]) {
    const { db, call } = setup();
    const r = await call({ action: "dispatch_manual", orderId: ORDER_ID, trackingUrl });
    assertEquals([r.status, r.body.code], [400, "invalid_request"], String(trackingUrl));
    assertEquals(db.calls, []);
  }
  const long = setup();
  const tooLong = "https://p.in/" + "a".repeat(500);
  const r = await long.call({ action: "dispatch_manual", orderId: ORDER_ID, trackingUrl: tooLong });
  assertEquals(r.status, 400);
  const pickup = setup(PICKUP);
  assertEquals((await pickup.call(DISPATCH)).body.code, "bad_state");
  assertEquals(pickup.sr.methods(), []);
  assertEquals((await setup({ status: "packed" }).call(DISPATCH)).body.code, "bad_state");
});

Deno.test("Porter order: process / rebook refused (no Shiprocket); retry never creates a Shiprocket order", async () => {
  const { db, sr, call } = setup({ ...PORTER_SHIPPED, sr_order_id: null, sr_shipment_id: null });
  assertEquals((await call(PROCESS)).body.code, "bad_state");
  const rebook = await call({ action: "rebook", orderId: ORDER_ID, opKey: "rb-1", parcelLost: false, note: "x" });
  assertEquals(rebook.body.code, "bad_state");
  assertEquals((await call({ action: "retry", orderId: ORDER_ID })).status, 200);
  assertEquals([sr.methods(), db.order.status], [[], "shipped"]);
});

Deno.test("Porter order: ensureSrOrder skips it even while paid (dispatch raced the shiprocket_create job)", async () => {
  const { sr, call } = setup({ courier: "porter", sr_order_id: null, sr_shipment_id: null });
  assertEquals((await call({ action: "retry", orderId: ORDER_ID })).status, 200);
  assertEquals(sr.methods(), []);
});

Deno.test("mark_delivered: any admin for a Porter order, reason optional; Shiprocket order stays superadmin-only", async () => {
  const { db, call } = setup(PORTER_SHIPPED);
  const md = { action: "mark_delivered", orderId: ORDER_ID, deliveredAt: "2026-10-29T10:00:00Z" };
  const r = await call(md);
  assertEquals(r.status, 200);
  assertEquals(db.calls, [{
    fn: "online_order_mark_delivered",
    args: { p_order_id: ORDER_ID, p_actor: ADMIN, p_delivered_at: "2026-10-29T10:00:00Z", p_reason: null },
  }]);
  const withReason = await call({ ...md, reason: " rider confirmed " });
  assertEquals([withReason.status, db.calls[1].args.p_reason], [200, "rider confirmed"]);
  const ship = setup({ status: "shipped", awb: "AWB1" });
  const denied = await ship.call({ ...md, reason: "x" });
  assertEquals([denied.status, ship.db.calls.length], [403, 0]);
});
