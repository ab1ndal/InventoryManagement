import { assertEquals } from "@std/assert";
import { type Deps, handler, tokenMatches } from "./index.ts";
import { FakeDb, FakeShiprocket } from "../_shared/process_fakes.ts";

const TOKEN = "hook-secret-123";

function setup(token = TOKEN) {
  const db = new FakeDb({ status: "packed", awb: "AWB1" });
  const sr = new FakeShiprocket();
  const deps: Deps = { token, db, shiprocket: sr };
  const call = async (body: unknown, key: string | null = TOKEN) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key !== null) headers["x-api-key"] = key;
    const res = await handler(
      new Request("http://local/courier-status", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      deps,
    );
    return { status: res.status, body: await res.json() };
  };
  return { db, sr, call };
}

// Shiprocket webhook sample shape (notes §9)
const EVENT = {
  awb: "AWB1",
  current_status: "DELIVERED",
  current_status_id: 7,
  shipment_status: "DELIVERED",
  shipment_status_id: 7,
  order_id: "WEB-000123",
};

Deno.test("wrong or missing x-api-key → 401, no Shiprocket or DB call", async () => {
  const { db, sr, call } = setup();
  assertEquals((await call(EVENT, "nope")).status, 401);
  assertEquals((await call(EVENT, null)).status, 401);
  assertEquals(sr.calls.length + db.calls.length, 0);
});

Deno.test("unset SHIPROCKET_WEBHOOK_TOKEN refuses everything", async () => {
  const { call } = setup("");
  assertEquals((await call(EVENT, "")).status, 401);
  assertEquals(tokenMatches("", ""), false);
});

Deno.test("delivered: re-fetched track maps 7 → delivered and is applied", async () => {
  const { db, sr, call } = setup();
  const r = await call(EVENT);
  assertEquals(r.status, 200);
  assertEquals(sr.calls, [{ method: "track", args: ["AWB1"] }]);
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].fn, "online_order_apply_tracking");
  assertEquals(db.calls[0].args.p_awb, "AWB1");
  assertEquals(db.calls[0].args.p_status, "delivered");
  const payload = db.calls[0].args.p_payload as Record<string, unknown>;
  assertEquals(payload.shipment_status_id, 7);
  assertEquals(payload.shipment_status, "DELIVERED");
});

Deno.test("payload status is ignored in favour of track(): payload 7, Shiprocket says 18 → shipped", async () => {
  const { db, sr, call } = setup();
  sr.trackResult = { hasData: true, shipmentStatusId: 18, currentStatus: "IN TRANSIT", trackUrl: null, etd: null };
  const r = await call(EVENT);
  assertEquals(r.status, 200);
  assertEquals(db.calls[0].args.p_status, "shipped");
  assertEquals((db.calls[0].args.p_payload as Record<string, unknown>).shipment_status_id, 18);
});

Deno.test("unmapped shipment id still stores the raw status (p_status null)", async () => {
  const { db, sr, call } = setup();
  sr.trackResult = { hasData: true, shipmentStatusId: 3, currentStatus: "PICKUP SCHEDULED", trackUrl: null, etd: null };
  await call(EVENT);
  assertEquals(db.calls[0].args.p_status, null);
});

Deno.test("no scans yet → 200, nothing applied", async () => {
  const { db, sr, call } = setup();
  sr.trackResult = { hasData: false, shipmentStatusId: null, currentStatus: null, trackUrl: null, etd: null };
  const r = await call(EVENT);
  assertEquals([r.status, r.body.applied], [200, false]);
  assertEquals(db.calls.length, 0);
});

Deno.test("track() fails → 200, payload never applied", async () => {
  const { db, sr, call } = setup();
  sr.failOnce.add("track");
  const r = await call(EVENT);
  assertEquals([r.status, r.body.applied], [200, false]);
  assertEquals(db.calls.length, 0);
});

Deno.test("no awb or non-JSON body → 200 without calls", async () => {
  const { db, sr, call } = setup();
  assertEquals((await call({ ping: true })).status, 200);
  assertEquals((await call("not json")).status, 200);
  assertEquals(sr.calls.length + db.calls.length, 0);
});
