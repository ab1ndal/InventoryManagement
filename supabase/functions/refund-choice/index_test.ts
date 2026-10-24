import { assert, assertEquals } from "@std/assert";
import { type Deps, handler } from "./index.ts";
import { handler as sweep } from "../refund-sweeper/index.ts";
import { FakeCashfree, FakeClock, FakeRefundDb, HOUR, silentLog } from "../_shared/refunds_testing.ts";

const ORIGIN = "https://www.bindalscreations.com";

function setup(opts: { cashfree?: boolean } = {}) {
  const clock = new FakeClock();
  const db = new FakeRefundDb(clock);
  const cf = new FakeCashfree();
  const deps: Deps = {
    db,
    cashfree: opts.cashfree === false ? null : cf.client(),
    allowedOrigins: [ORIGIN],
    ipSalt: "salt",
    now: () => new Date(clock.now()),
    log: silentLog,
  };
  return { clock, db, cf, deps };
}

const call = (deps: Deps, body: unknown, ip = "203.0.113.7") =>
  handler(
    new Request("https://fn.test/refund-choice", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps,
  );

Deno.test("preview: valid token → contract shape with CORS", async () => {
  const { db, deps } = setup();
  const r = db.add({ gateway: 1000 });
  const res = await call(deps, { token: r.token, action: "preview" });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), [
    "amount",
    "creditPart",
    "expiresAt",
    "gatewayPart",
    "isGuest",
    "items",
    "orderRef",
    "status",
  ]);
  assertEquals(body.status, "awaiting_choice");
  assertEquals(body.amount, 1000);
  assertEquals(body.gatewayPart, 1000);
  assertEquals(body.items, [{ name: "Test Kurti", size: "M", color: "Red", units: 1 }]);
  assertEquals(body.isGuest, true);
});

Deno.test("preview: expired token → 410 expired; already chosen still previews after expiry", async () => {
  const { clock, db, deps } = setup();
  const a = db.add({ gateway: 1000 });
  const b = db.add({ gateway: 500 });
  await db.choose(b.token!, "store_credit");
  clock.advance(49 * HOUR);
  const res = await call(deps, { token: a.token, action: "preview" });
  assertEquals(res.status, 410);
  assertEquals((await res.json()).code, "expired");
  const done = await call(deps, { token: b.token, action: "preview" });
  assertEquals(done.status, 200);
  assertEquals((await done.json()).status, "completed");
  assertEquals(db.failures.length, 0, "expired is not a guess");
});

Deno.test("preview: unknown or malformed token → 404 invalid_token, counted per IP; 10 → 429", async () => {
  const { db, deps } = setup();
  const res = await call(deps, { token: "f".repeat(64), action: "preview" });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "This refund link isn't valid.", code: "invalid_token" });
  const bad = await call(deps, { token: "../../etc", action: "preview" });
  assertEquals(bad.status, 404);
  assertEquals(db.failures.length, 2);
  assert(/^[0-9a-f]{64}$/.test(db.failures[0]!), "stores a hash, never the IP");
  for (let i = 0; i < 8; i++) await call(deps, { token: "e".repeat(64), action: "choose", choice: "original" });
  const limited = await call(deps, { token: db.add({ gateway: 1 }).token, action: "preview" });
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).code, "rate_limited");
  const other = await call(deps, { token: db.add({ gateway: 1 }).token, action: "preview" }, "198.51.100.1");
  assertEquals(other.status, 200, "another IP is unaffected");
});

Deno.test("choose store_credit as guest → voucher codes, no Cashfree call", async () => {
  const { db, cf, deps } = setup();
  const r = db.add({ gateway: 1000 });
  const res = await call(deps, { token: r.token, action: "choose", choice: "store_credit" });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["choice", "creditAdded", "status", "vouchers"]);
  assertEquals(body.status, "completed");
  assertEquals(body.choice, "store_credit");
  assertEquals(body.creditAdded, 0);
  assertEquals(body.vouchers.length, 1);
  assertEquals(body.vouchers[0].value, 1000);
  assert(body.vouchers[0].code.length >= 12);
  assertEquals(cf.createCalls.length, 0);
});

Deno.test("choose twice → 409 already_chosen", async () => {
  const { db, deps } = setup();
  const r = db.add({ gateway: 1000 });
  assertEquals((await call(deps, { token: r.token, action: "choose", choice: "store_credit" })).status, 200);
  const again = await call(deps, { token: r.token, action: "choose", choice: "original" });
  assertEquals(again.status, 409);
  assertEquals((await again.json()).code, "already_chosen");
});

Deno.test("choose after 48 h → 410 expired; bad choice → 400", async () => {
  const { clock, db, deps } = setup();
  const r = db.add({ gateway: 1000 });
  assertEquals((await call(deps, { token: r.token, action: "choose", choice: "cash" })).status, 400);
  clock.advance(48 * HOUR + 1);
  const res = await call(deps, { token: r.token, action: "choose", choice: "store_credit" });
  assertEquals(res.status, 410);
  assertEquals((await res.json()).code, "expired");
});

Deno.test("choose original → exactly one createRefund per gateway leg, even when the sweeper also runs", async () => {
  const { clock, db, cf, deps } = setup();
  const r = db.add({ gateway: 1000, shippingGateway: 99, credit: 200 });
  const res = await call(deps, { token: r.token, action: "choose", choice: "original" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "processing");
  assertEquals(cf.createCalls.length, 2);
  const sweepDeps = { db, cashfree: cf.client(), cronSecret: "cron", serviceKey: "svc", log: silentLog };
  const cron = () =>
    sweep(
      new Request("https://fn.test/refund-sweeper", { method: "POST", headers: { "x-cron-secret": "cron" } }),
      sweepDeps,
    );
  for (const step of [0, 15 * 60_000, 2 * HOUR, 3 * HOUR]) {
    clock.advance(step);
    assertEquals((await cron()).status, 200);
  }
  assertEquals(cf.createCalls.length, 2, "sweeper never re-submits a submitted leg");
  for (const l of r.legs.filter((x) => x.source !== "credit")) {
    assertEquals(cf.createCalls.filter((c) => c.refundId === l.id).length, 1);
    assert(cf.accepted(l.id) <= l.amount, "Σ submitted ≤ leg amount");
    assertEquals(cf.accepted(l.id), l.amount);
  }
});

Deno.test("choose original with Cashfree down: choice saved, sweeper submits after the grace", async () => {
  const { clock, db, cf, deps } = setup({ cashfree: false });
  const r = db.add({ gateway: 700 });
  const res = await call(deps, { token: r.token, action: "choose", choice: "original" });
  assertEquals(res.status, 200);
  assertEquals(r.choice, "original");
  const sweepDeps = { db, cashfree: cf.client(), cronSecret: "cron", serviceKey: "svc", log: silentLog };
  const cron = () =>
    sweep(
      new Request("https://fn.test/refund-sweeper", { method: "POST", headers: { "x-cron-secret": "cron" } }),
      sweepDeps,
    );
  await cron();
  assertEquals(cf.createCalls.length, 0, "inside grace: a refund-choice request may still be submitting");
  clock.advance(11 * 60_000);
  await cron();
  assertEquals(cf.createCalls.map((c) => c.amount), [700]);
});

Deno.test("CORS preflight: allowed origin 204, hostile 403; GET → 405; bad JSON → 400", async () => {
  const { deps } = setup();
  const pre = (origin: string) =>
    handler(new Request("https://fn.test/refund-choice", { method: "OPTIONS", headers: { origin } }), deps);
  assertEquals((await pre(ORIGIN)).status, 204);
  assertEquals((await pre("https://evil.example")).status, 403);
  assertEquals((await handler(new Request("https://fn.test/refund-choice"), deps)).status, 405);
  assertEquals((await call(deps, "{not json")).status, 400);
  assertEquals((await call(deps, { token: "a".repeat(64), action: "delete" })).status, 400);
});
