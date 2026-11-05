import { assert, assertEquals } from "@std/assert";
import { authorized, BATCH_LIMIT, type Deps, handler, type SweepOrder } from "./index.ts";
import { FakeDb, FakeShiprocket } from "../_shared/process_fakes.ts";

type LogLine = {
  level: string;
  event: string;
  fields: Record<string, unknown>;
};

function setup(
  orders: SweepOrder[] = [{ order_ref: "WEB-000001", awb: "AWB1" }, {
    order_ref: "WEB-000002",
    awb: "AWB2",
  }],
) {
  const db = new FakeDb({ status: "packed", awb: "AWB1" });
  const sr = new FakeShiprocket();
  const logs: LogLine[] = [];
  const sourceCalls: { limit: number; staleBefore: Date; now: Date }[] = [];
  const now = new Date("2026-11-04T12:00:00Z");
  const pauses: number[] = [];
  const deps: Deps = {
    db,
    source: {
      due: (limit, staleBefore, at) => {
        sourceCalls.push({ limit, staleBefore, now: at });
        return Promise.resolve(orders);
      },
    },
    shiprocket: sr,
    cronSecret: "cron-secret",
    serviceKey: "service-key",
    log: (level, event, fields) => logs.push({ level, event, fields }),
    pause: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
    now: () => now,
  };
  const run = (
    headers: Record<string, string> = { "x-cron-secret": "cron-secret" },
  ) =>
    handler(
      new Request("https://fn.test/tracking-sweeper", {
        method: "POST",
        headers,
      }),
      deps,
    );
  return { db, sr, logs, sourceCalls, pauses, deps, run };
}

Deno.test("auth: cron secret or service-role bearer; anything else 401 with no work", async () => {
  const { run, db, sr, sourceCalls } = setup();
  assertEquals((await run({})).status, 401);
  assertEquals((await run({ "x-cron-secret": "nope" })).status, 401);
  assertEquals((await run({ authorization: "Bearer anon-key" })).status, 401);
  assertEquals(sourceCalls.length + sr.calls.length + db.calls.length, 0);
  assertEquals((await run()).status, 200);
  assertEquals(
    (await run({ authorization: "Bearer service-key" })).status,
    200,
  );
  const req = (h: Record<string, string>) => new Request("https://x", { headers: h });
  assert(
    !authorized(req({ "x-cron-secret": "" }), "", "svc"),
    "empty secret never matches",
  );
  assert(
    !authorized(req({ authorization: "Bearer " }), "cron", ""),
    "empty key never matches",
  );
});

Deno.test("non-POST is refused", async () => {
  const { deps } = setup();
  const res = await handler(
    new Request("https://x", {
      method: "GET",
      headers: { "x-cron-secret": "cron-secret" },
    }),
    deps,
  );
  assertEquals(res.status, 405);
});

Deno.test("asks for a batch of 25 orders stale for 3 hours", async () => {
  const { run, sourceCalls } = setup();
  await run();
  assertEquals(sourceCalls[0].limit, BATCH_LIMIT);
  assertEquals(BATCH_LIMIT, 25);
  assertEquals(
    sourceCalls[0].staleBefore.toISOString(),
    "2026-11-04T09:00:00.000Z",
  );
});

Deno.test("no scans yet: skipped, nothing applied, not counted failed", async () => {
  const { run, sr, db } = setup();
  sr.trackResult = {
    hasData: false,
    shipmentStatusId: null,
    currentStatus: null,
    trackUrl: null,
    etd: null,
  };
  const body = await (await run()).json();
  assertEquals(body, { checked: 2, changed: 0, failed: 0 });
  assertEquals(db.calls.length, 0);
});

Deno.test("applies the mapped status with the courier-status payload shape, source tracking-sweeper", async () => {
  const { run, sr, db } = setup([{ order_ref: "WEB-000001", awb: "AWB1" }]);
  sr.trackResult = {
    hasData: true,
    shipmentStatusId: 18,
    currentStatus: "IN TRANSIT",
    trackUrl: "https://t.test/1",
    etd: null,
  };
  const body = await (await run()).json();
  assertEquals(body, { checked: 1, changed: 1, failed: 0 });
  assertEquals(sr.calls, [{ method: "track", args: ["AWB1"] }]);
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].fn, "online_order_apply_tracking");
  assertEquals(db.calls[0].args.p_awb, "AWB1");
  assertEquals(db.calls[0].args.p_status, "shipped");
  assertEquals(db.calls[0].args.p_payload, {
    shipment_status_id: 18,
    shipment_status: "IN TRANSIT",
    track_url: "https://t.test/1",
    etd: null,
    source: "tracking-sweeper",
  });
});

Deno.test("unmapped status id still records the raw label (p_status null)", async () => {
  const { run, sr, db } = setup([{ order_ref: "WEB-000001", awb: "AWB1" }]);
  sr.trackResult = {
    hasData: true,
    shipmentStatusId: 3,
    currentStatus: "PICKUP SCHEDULED",
    trackUrl: null,
    etd: null,
  };
  await run();
  assertEquals(db.calls[0].args.p_status, null);
  assertEquals(
    (db.calls[0].args.p_payload as Record<string, unknown>).shipment_status,
    "PICKUP SCHEDULED",
  );
});

Deno.test("one failure does not stop the rest; counts and logs carry the order ref, no AWB or contact", async () => {
  const { run, sr, db, logs } = setup([
    { order_ref: "WEB-000001", awb: "AWB1" },
    { order_ref: "WEB-000002", awb: "AWB2" },
    { order_ref: "WEB-000003", awb: "AWB3" },
  ]);
  sr.failOnce.add("track"); // first order's track fails
  const apply = db.rpc.bind(db);
  // second order's apply fails
  db.rpc =
    ((fn: string, args: Record<string, unknown>) =>
      args.p_awb === "AWB2" ? Promise.reject(new Error("boom")) : apply(fn, args)) as typeof db.rpc;
  const first = await (await run()).json();
  assertEquals(first, { checked: 3, changed: 1, failed: 2 });
  assertEquals(sr.count("track"), 3);
  const failures = logs.filter((l) => l.event === "tracking_sweep_order_failed");
  assertEquals(failures.map((l) => [l.fields.order_ref, l.fields.step]), [
    ["WEB-000001", "track_failed"],
    ["WEB-000002", "apply_failed"],
  ]);
  for (const l of failures) assert(!("awb" in l.fields), "awb not logged");
  assertEquals(logs.at(-1)?.fields, { checked: 3, changed: 1, failed: 2 });
});

Deno.test("calls are spaced: one pause between consecutive orders, none before the first", async () => {
  const { run, pauses } = setup();
  await run();
  assertEquals(pauses, [300]);
});

Deno.test("a repeat run changes nothing: apply is forward-only, so the second pass reports changed 0", async () => {
  const { run, db } = setup([{ order_ref: "WEB-000001", awb: "AWB1" }]);
  // Mirror online_order_apply_tracking's forward-only rule (rank must rise) over the fake rpc.
  let rank = 1; // packed
  const rankOf: Record<string, number> = {
    shipped: 2,
    out_for_delivery: 3,
    delivered: 4,
  };
  const forwardOnly = <T>(_fn: string, args: Record<string, unknown>) => {
    const next = rankOf[args.p_status as string] ?? 0;
    const changed = next > rank;
    if (changed) rank = next;
    return Promise.resolve({ matched: true, changed } as T);
  };
  db.rpc = forwardOnly as typeof db.rpc;
  assertEquals(await (await run()).json(), {
    checked: 1,
    changed: 1,
    failed: 0,
  });
  assertEquals(await (await run()).json(), {
    checked: 1,
    changed: 0,
    failed: 0,
  });
});

Deno.test("nothing due: 200 with zero counts and no Shiprocket call", async () => {
  const { run, sr } = setup([]);
  assertEquals(await (await run()).json(), {
    checked: 0,
    changed: 0,
    failed: 0,
  });
  assertEquals(sr.calls.length, 0);
});

Deno.test("a failing selection is a 500, not a silent zero", async () => {
  const { run, deps } = setup();
  deps.source = { due: () => Promise.reject(new Error("db down")) };
  assertEquals((await run()).status, 500);
});
