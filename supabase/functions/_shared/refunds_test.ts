import { assert, assertEquals } from "@std/assert";
import { CashfreeError } from "./cashfree.ts";
import { cashfreeFromEnv, pollGatewayLegs, submitGatewayLegs } from "./refunds.ts";
import { FakeCashfree, FakeClock, FakeRefundDb, HOUR, silentLog } from "./refunds_testing.ts";

function setup() {
  const clock = new FakeClock();
  const db = new FakeRefundDb(clock);
  const cf = new FakeCashfree();
  const ctx = { db, cashfree: cf.client(), log: silentLog };
  return { clock, db, cf, ctx };
}

async function chosenOriginal(db: FakeRefundDb, gateway = 1000, shippingGateway = 0) {
  const r = db.add({ gateway, shippingGateway });
  const res = await db.choose(r.token!, "original");
  return { r, legs: res.gatewayLegs };
}

Deno.test("submit: refund_id = leg id, amount = leg amount; PENDING stays processing with cf id", async () => {
  const { db, cf, ctx } = setup();
  const { legs } = await chosenOriginal(db, 1234.5);
  const out = await submitGatewayLegs(ctx, legs);
  assertEquals(out, [{ legId: legs[0].legId, result: "processing" }]);
  assertEquals(cf.createCalls, [{ orderRef: legs[0].orderRef, refundId: legs[0].legId, amount: 1234.5 }]);
  const leg = db.leg(legs[0].legId);
  assertEquals(leg.status, "processing");
  assert(leg.cfRefundId?.startsWith("cf_"));
});

Deno.test("submit: SUCCESS completes the leg and the refund", async () => {
  const { db, cf, ctx } = setup();
  const { r, legs } = await chosenOriginal(db);
  cf.nextStatus = "SUCCESS";
  const out = await submitGatewayLegs(ctx, legs);
  assertEquals(out[0].result, "completed");
  assertEquals(r.status, "completed");
});

Deno.test("submit: REJECTED fails the leg and flags the order", async () => {
  const { db, cf, ctx } = setup();
  const { r, legs } = await chosenOriginal(db);
  cf.nextStatus = "REJECTED";
  const out = await submitGatewayLegs(ctx, legs);
  assertEquals(out[0].result, "failed");
  assertEquals(db.leg(legs[0].legId).status, "failed");
  assertEquals(db.problems.length, 1);
  assertEquals(db.problems[0].orderRef, r.orderRef);
});

Deno.test("submit: ambiguous timeout writes nothing; the retry reconciles to one Cashfree refund", async () => {
  const { db, cf, ctx } = setup();
  const { legs } = await chosenOriginal(db);
  cf.createErrors = [new CashfreeError(0, "timeout", "timed out")];
  cf.errorTookEffect = true; // the request reached Cashfree before the timeout
  const first = await submitGatewayLegs(ctx, legs);
  assertEquals(first[0].result, "pending");
  assertEquals(db.leg(legs[0].legId).cfRefundId, null);
  assertEquals(db.statusWrites.length, 0);
  // Retry: Cashfree refuses the repeated refund_id, the engine looks it up instead.
  const second = await submitGatewayLegs(ctx, legs);
  assertEquals(second[0].result, "processing");
  assertEquals(cf.refunds.size, 1);
  assertEquals(cf.accepted(legs[0].legId), 1000);
  assertEquals(db.problems.length, 0);
});

Deno.test("submit: definite 4xx with no refund at Cashfree → failed + problem", async () => {
  const { db, cf, ctx } = setup();
  const { legs } = await chosenOriginal(db);
  cf.createErrors = [new CashfreeError(400, "refund_amount_invalid", "too much")];
  const out = await submitGatewayLegs(ctx, legs);
  assertEquals(out[0], { legId: legs[0].legId, result: "failed", error: "refund_amount_invalid" });
  assertEquals(db.leg(legs[0].legId).status, "failed");
  assertEquals(db.problems.length, 1);
});

Deno.test("submit: a leg listed twice is sent once; each leg of a refund is its own Cashfree refund", async () => {
  const { db, cf, ctx } = setup();
  const { legs } = await chosenOriginal(db, 1000, 99);
  assertEquals(legs.length, 2);
  await submitGatewayLegs(ctx, [...legs, legs[0]]);
  assertEquals(cf.createCalls.length, 2);
  assertEquals(new Set(cf.createCalls.map((c) => c.refundId)).size, 2);
  assertEquals(cf.createCalls.map((c) => c.amount).sort((a, b) => a - b), [99, 1000]);
});

Deno.test("submit: a non-positive amount is never sent", async () => {
  const { cf, ctx } = setup();
  const out = await submitGatewayLegs(ctx, [{ legId: crypto.randomUUID(), orderRef: "WEB-000001", amount: 0 }]);
  assertEquals(out[0].result, "pending");
  assertEquals(cf.createCalls.length, 0);
});

Deno.test("poll: SUCCESS completes, PENDING writes nothing, missing refund flags a problem", async () => {
  const { clock, db, cf, ctx } = setup();
  const a = await chosenOriginal(db);
  const b = await chosenOriginal(db);
  await submitGatewayLegs(ctx, [...a.legs, ...b.legs]);
  clock.advance(2 * HOUR);
  cf.refunds.get(a.legs[0].legId)!.status = "SUCCESS";
  const writesBefore = db.statusWrites.length;
  const out = await pollGatewayLegs(ctx, [...a.legs, ...b.legs]);
  assertEquals(out.map((o) => o.result), ["completed", "processing"]);
  assertEquals(db.statusWrites.length, writesBefore + 1);
  assertEquals(a.r.status, "completed");
  cf.refunds.delete(b.legs[0].legId);
  const missing = await pollGatewayLegs(ctx, b.legs);
  assertEquals(missing[0].error, "not_found");
  assertEquals(db.problems.length, 1);
});

Deno.test("cashfreeFromEnv: null without credentials; unknown env fails loudly", () => {
  assertEquals(cashfreeFromEnv(() => undefined), null);
  assertEquals(cashfreeFromEnv((k) => (k === "CASHFREE_CLIENT_ID" ? "id" : undefined)), null);
  let threw = false;
  try {
    cashfreeFromEnv((k) => ({ CASHFREE_CLIENT_ID: "id", CASHFREE_CLIENT_SECRET: "s" } as Record<string, string>)[k]);
  } catch {
    threw = true;
  }
  assert(threw, "missing CASHFREE_ENV must throw");
  assert(
    cashfreeFromEnv((k) =>
      ({ CASHFREE_CLIENT_ID: "id", CASHFREE_CLIENT_SECRET: "s", CASHFREE_ENV: "sandbox" } as Record<string, string>)[k]
    ),
  );
});
