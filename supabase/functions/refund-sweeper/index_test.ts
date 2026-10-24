import { assert, assertEquals } from "@std/assert";
import { authorized, type Deps, handler } from "./index.ts";
import { FakeCashfree, FakeClock, FakeRefundDb, HOUR, silentLog } from "../_shared/refunds_testing.ts";

function setup(opts: { cashfree?: boolean } = {}) {
  const clock = new FakeClock();
  const db = new FakeRefundDb(clock);
  const cf = new FakeCashfree();
  const deps: Deps = {
    db,
    cashfree: opts.cashfree === false ? null : cf.client(),
    cronSecret: "cron-secret",
    serviceKey: "service-key",
    log: silentLog,
  };
  const run = (headers: Record<string, string> = { "x-cron-secret": "cron-secret" }) =>
    handler(new Request("https://fn.test/refund-sweeper", { method: "POST", headers }), deps);
  return { clock, db, cf, deps, run };
}

Deno.test("auth: cron secret or service-role bearer; anything else 401", async () => {
  const { run } = setup();
  assertEquals((await run({})).status, 401);
  assertEquals((await run({ "x-cron-secret": "nope" })).status, 401);
  assertEquals((await run({ authorization: "Bearer anon-key" })).status, 401);
  assertEquals((await run()).status, 200);
  assertEquals((await run({ authorization: "Bearer service-key" })).status, 200);
  const req = (h: Record<string, string>) => new Request("https://x", { headers: h });
  assert(!authorized(req({ "x-cron-secret": "" }), "", "svc"), "empty secret never matches");
  assert(!authorized(req({ authorization: "Bearer " }), "cron", ""), "empty key never matches");
});

Deno.test("defaults only refunds older than 48 h, then refunds them to the original method", async () => {
  const { clock, db, cf, run } = setup();
  const old = db.add({ gateway: 1000 });
  clock.advance(2 * HOUR);
  const fresh = db.add({ gateway: 500 });
  clock.advance(46 * HOUR + 60_000); // old: 48 h 1 min, fresh: 46 h 1 min
  const res = await run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.defaulted, 1);
  assertEquals(old.choice, "original");
  assertEquals(fresh.choice, null);
  assertEquals(fresh.status, "awaiting_choice");
  assertEquals(cf.createCalls.map((c) => [c.refundId, c.amount]), [[old.legs[0].id, 1000]]);
});

Deno.test("running twice creates exactly one Cashfree refund per leg", async () => {
  const { clock, db, cf, run } = setup();
  const r = db.add({ gateway: 1000, shippingGateway: 99 });
  clock.advance(49 * HOUR);
  await run();
  await run();
  clock.advance(2 * HOUR);
  await run();
  assertEquals(cf.createCalls.length, 2);
  for (const l of r.legs) {
    assertEquals(cf.createCalls.filter((c) => c.refundId === l.id).length, 1);
    assertEquals(cf.accepted(l.id), l.amount);
  }
});

Deno.test("polls processing legs after 1 h and completes them", async () => {
  const { clock, db, cf, run } = setup();
  const r = db.add({ gateway: 800 });
  await db.choose(r.token!, "original");
  clock.advance(11 * 60_000);
  await run(); // submits the stranded leg
  assertEquals(cf.createCalls.length, 1);
  assertEquals(cf.getCalls.length, 0);
  cf.refunds.get(r.legs[0].id)!.status = "SUCCESS";
  clock.advance(30 * 60_000);
  await run();
  assertEquals(cf.getCalls.length, 0, "not polled before 1 h");
  clock.advance(31 * 60_000);
  const body = await (await run()).json();
  assertEquals(cf.getCalls, [r.legs[0].id]);
  assertEquals(body.completed, 1);
  assertEquals(r.status, "completed");
});

Deno.test("Cashfree not configured: still defaults, answers 503", async () => {
  const { clock, db, run } = setup({ cashfree: false });
  const r = db.add({ gateway: 100 });
  clock.advance(49 * HOUR);
  const res = await run();
  assertEquals(res.status, 503);
  assertEquals((await res.json()).defaulted, 1);
  assertEquals(r.choice, "original");
});

Deno.test("GET → 405", async () => {
  const { deps } = setup();
  assertEquals((await handler(new Request("https://fn.test/refund-sweeper"), deps)).status, 405);
});
