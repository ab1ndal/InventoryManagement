import { assertEquals } from "@std/assert";
import { authorized, type ClaimedJob, handler, type RunJobsDeps, toOrderJob } from "./handler.ts";
import { confirmLikeDb, CRON_SECRET, dbRaise, FakeStore, order, SERVICE_KEY, testDeps, testEnv } from "../_shared/pay_testing.ts";
import type { JobContext, JobHandler, OrderJob } from "../_shared/jobs/types.ts";
import { handlerFor as realHandlerFor } from "../_shared/jobs/index.ts";

const ctx = { env: { siteUrl: "s", shopEmail: "" } } as unknown as JobContext;

function deps(
  store = new FakeStore(),
  handlerFor?: (kind: string) => JobHandler | null,
): RunJobsDeps & ReturnType<typeof testDeps> {
  return { ...testDeps({ store }), jobContext: ctx, handlerFor };
}

const cron = (body = "{}", path = "") =>
  new Request(`https://fn.test/run-jobs${path}`, { method: "POST", headers: { "x-cron-secret": CRON_SECRET }, body });

const row = (over: Partial<ClaimedJob>): ClaimedJob => ({ id: "j", order_id: "o-1", kind: "email_confirmed", ref_id: "", attempts: 1, ...over });

Deno.test("run-jobs auth: cron secret or service-role bearer only", () => {
  const r = (h: Record<string, string>) => new Request("https://fn.test/run-jobs", { method: "POST", headers: h });
  assertEquals(authorized(r({ "x-cron-secret": CRON_SECRET }), testEnv), true);
  assertEquals(authorized(r({ authorization: `Bearer ${SERVICE_KEY}` }), testEnv), true);
  assertEquals(authorized(r({ "x-cron-secret": "nope" }), testEnv), false);
  assertEquals(authorized(r({ authorization: "Bearer anon-key" }), testEnv), false);
  assertEquals(authorized(r({}), testEnv), false);
  assertEquals(authorized(r({ "x-cron-secret": "" }), { ...testEnv, cronSecret: "" }), false, "empty secret never matches");
});

Deno.test("run-jobs: 401 without auth, no DB call", async () => {
  const store = new FakeStore();
  const res = await handler(new Request("https://fn.test/run-jobs", { method: "POST", body: "{}" }), deps(store));
  assertEquals(res.status, 401);
  assertEquals(store.calls, []);
});

Deno.test("toOrderJob: kind + ref_id → kind:ref_id; empty ref_id keeps the kind", () => {
  assertEquals(toOrderJob(row({ kind: "refund_notify", ref_id: "r-1:completed" })).kind, "refund_notify:r-1:completed");
  assertEquals(toOrderJob(row({ kind: "email_shop", ref_id: "" })).kind, "email_shop");
  assertEquals(toOrderJob(row({ kind: "email_shop", ref_id: null })).kind, "email_shop");
  assertEquals(realHandlerFor(toOrderJob(row({ kind: "refund_notify", ref_id: "r-1" })).kind) !== null, true);
  assertEquals(realHandlerFor("email_ready_for_pickup") !== null, true);
});

Deno.test("run-jobs: dispatch by kind, finish(true) on success, finish(false) on throw / no handler", async () => {
  const store = new FakeStore({
    online_jobs_claim: () => [
      row({ id: "j1", kind: "email_confirmed" }),
      row({ id: "j2", kind: "refund_notify", ref_id: "r-9" }),
      row({ id: "j3", kind: "mystery" }),
    ],
  });
  const seen: string[] = [];
  const handlerFor = (kind: string): JobHandler | null => {
    if (kind === "email_confirmed") return (_c, j: OrderJob) => (seen.push(j.kind), Promise.resolve());
    if (kind.startsWith("refund_notify")) return (_c, j: OrderJob) => (seen.push(j.kind), Promise.reject(new Error("smtp down")));
    return null;
  };
  const res = await handler(cron(), deps(store, handlerFor));
  assertEquals(await res.json(), { mode: "jobs", claimed: 3, ok: 1, failed: 2 });
  assertEquals(seen, ["email_confirmed", "refund_notify:r-9"]);
  assertEquals(store.callsTo("online_job_finish"), [
    { p_job_id: "j1", p_ok: true, p_error: null },
    { p_job_id: "j2", p_ok: false, p_error: "smtp down" },
    { p_job_id: "j3", p_ok: false, p_error: "no handler" },
  ]);
});

Deno.test("run-jobs: unknown mode 400, bad JSON 400", async () => {
  assertEquals((await handler(cron('{"mode":"nope"}'), deps())).status, 400);
  assertEquals((await handler(cron("{x"), deps())).status, 400);
});

Deno.test("run-jobs expire (R5): PAID → confirm, EXPIRED/TERMINATED/missing → fail expired, ACTIVE>24h → problem once", async () => {
  const store = new FakeStore();
  const mk = (ref: string, created_at = "2026-10-23T09:00:00Z", problem: string | null = null) =>
    order({ id: ref, order_ref: ref, created_at, problem, cf_order_id: `cf-${ref}` });
  const paid = mk("WEB-000001");
  const expired = mk("WEB-000002");
  const terminated = mk("WEB-000003");
  const missing = mk("WEB-000004");
  const activeOld = mk("WEB-000005", "2026-10-21T09:00:00Z");
  const activeOldFlagged = mk("WEB-000006", "2026-10-21T09:00:00Z", "already flagged");
  const activeNew = mk("WEB-000007");
  store.orders.push(paid, expired, terminated, missing, activeOld, activeOldFlagged, activeNew);
  store.impls.online_order_list_stale = () =>
    store.orders.map((o) => ({ order_id: o.id, order_ref: o.order_ref, cf_order_id: o.cf_order_id, created_at: o.created_at }));
  store.impls.online_order_confirm_payment = confirmLikeDb(store);
  const d = deps(store);
  d.cashfree.pay(paid);
  const cfo = (ref: string, status: "EXPIRED" | "TERMINATED" | "ACTIVE") =>
    d.cashfree.orders.set(ref, { cfOrderId: `cf-${ref}`, orderRef: ref, status, amount: 1080, currency: "INR", paymentSessionId: null });
  cfo("WEB-000002", "EXPIRED");
  cfo("WEB-000003", "TERMINATED");
  cfo("WEB-000005", "ACTIVE");
  cfo("WEB-000006", "ACTIVE");
  cfo("WEB-000007", "ACTIVE");

  const res = await handler(cron('{"mode":"expire"}'), d);
  assertEquals(await res.json(), { mode: "expire", checked: 7, confirmed: 1, expired: 3, flagged: 1, errors: 0 });
  assertEquals(store.callsTo("online_order_fail").map((a) => [a.p_order_ref, a.p_status]), [
    ["WEB-000002", "expired"],
    ["WEB-000003", "expired"],
    ["WEB-000004", "expired"],
  ]);
  assertEquals(store.callsTo("online_order_set_problem").map((a) => a.p_order_ref), ["WEB-000005"]);
  assertEquals(paid.status, "paid");
  assertEquals(store.callsTo("stock_holds_purge"), [{}]);
});

Deno.test("run-jobs expire: a failed stock-hold purge doesn't stop the sweep", async () => {
  const store = new FakeStore();
  store.impls.stock_holds_purge = dbRaise("purge down");
  store.impls.online_order_list_stale = () => [];
  const res = await handler(cron('{"mode":"expire"}'), deps(store));
  assertEquals(await res.json(), { mode: "expire", checked: 0, confirmed: 0, expired: 0, flagged: 0, errors: 0 });
});

Deno.test("run-jobs expire: R5 failed attempt then late success still confirms (not failed while ACTIVE)", async () => {
  const store = new FakeStore();
  const o = order();
  store.orders.push(o);
  store.impls.online_order_list_stale = () => [{ order_id: o.id, order_ref: o.order_ref, cf_order_id: o.cf_order_id, created_at: o.created_at }];
  store.impls.online_order_confirm_payment = confirmLikeDb(store);
  const d = deps(store);
  d.cashfree.orders.set(o.order_ref, { cfOrderId: "cf-1", orderRef: o.order_ref, status: "ACTIVE", amount: 1080, currency: "INR", paymentSessionId: null });
  d.cashfree.payments.set(o.order_ref, [{ cfPaymentId: "p0", status: "FAILED", amount: 1080, currency: "INR", time: null }]);
  await (await handler(cron("", "?mode=expire"), d)).body?.cancel();
  assertEquals(store.callsTo("online_order_fail").length, 0);
  d.cashfree.pay(o);
  await (await handler(cron("", "?mode=expire"), d)).body?.cancel();
  assertEquals(o.status, "paid");
});

Deno.test("run-jobs expire: one Cashfree error doesn't stop the sweep", async () => {
  const store = new FakeStore();
  store.orders.push(order(), order({ id: "o-2", order_ref: "WEB-000002" }));
  store.impls.online_order_list_stale = () =>
    store.orders.map((o) => ({ order_id: o.id, order_ref: o.order_ref, cf_order_id: o.cf_order_id, created_at: o.created_at }));
  const d = deps(store);
  const real = d.cashfree.getOrder.bind(d.cashfree);
  d.cashfree.getOrder = (ref) => (ref === "WEB-000001" ? Promise.reject(new Error("timeout")) : real(ref));
  const j = await (await handler(cron('{"mode":"expire"}'), d)).json();
  assertEquals([j.errors, j.expired], [1, 1]);
});
