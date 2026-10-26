import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createShiprocket,
  selectCourier,
  ShiprocketError,
  type SrOrderInput,
  srOrderDate,
  type TokenStore,
} from "./shiprocket.ts";
import { fakeFetch, hang, instantDelay, jsonResponse, neverDelay, type RecordedCall } from "./testing.ts";
import type { Delay } from "./timeout.ts";

const NOW = new Date("2026-10-23T06:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const BASE = "https://apiv2.shiprocket.in/v1/external";

function memoryStore(initial: { token: string; expiresAt: Date } | null = null) {
  let value = initial;
  const sets: { token: string; expiresAt: Date }[] = [];
  const store: TokenStore = {
    get: () => Promise.resolve(value),
    set: (token, expiresAt) => {
      value = { token, expiresAt };
      sets.push(value);
      return Promise.resolve();
    },
  };
  return { store, sets };
}

/** Login returns tok-1, tok-2, ...; everything else goes to `api`. */
function setup(
  api: (c: RecordedCall) => Response | Promise<Response>,
  opts: { token?: { token: string; expiresAt: Date } | null; delay?: Delay } = {},
) {
  let logins = 0;
  const f = fakeFetch((c) => {
    if (c.url === `${BASE}/auth/login`) return jsonResponse(200, { token: `tok-${++logins}` });
    return api(c);
  });
  const mem = memoryStore(opts.token === undefined ? { token: "cached", expiresAt: new Date(NOW.getTime() + 5 * DAY) } : opts.token);
  const sr = createShiprocket({
    email: "api@shop.test",
    password: "pw-secret",
    fetch: f.fetch,
    tokenStore: mem.store,
    now: () => NOW,
    delay: opts.delay ?? neverDelay,
  });
  const apiCalls = () => f.calls.filter((c) => !c.url.endsWith("/auth/login"));
  const loginCalls = () => f.calls.filter((c) => c.url.endsWith("/auth/login"));
  return { sr, calls: f.calls, apiCalls, loginCalls, sets: mem.sets };
}

// ---------- token ----------

Deno.test("token: no cached token → one login, stored with 10-day expiry, then cached", async () => {
  const t = setup(() => jsonResponse(200, {}), { token: null });
  assertEquals(await t.sr.token(), "tok-1");
  assertEquals(await t.sr.token(), "tok-1");
  assertEquals(t.loginCalls().length, 1);
  assertEquals(t.loginCalls()[0].body, { email: "api@shop.test", password: "pw-secret" });
  assertEquals(t.sets[0].expiresAt.getTime(), NOW.getTime() + 10 * DAY);
});

Deno.test("token: cached with ≥ 24 h left is reused (no login)", async () => {
  const t = setup(() => jsonResponse(200, {}), { token: { token: "cached", expiresAt: new Date(NOW.getTime() + DAY) } });
  assertEquals(await t.sr.token(), "cached");
  assertEquals(t.loginCalls().length, 0);
});

Deno.test("token: cached with < 24 h left → re-login", async () => {
  const t = setup(() => jsonResponse(200, {}), { token: { token: "old", expiresAt: new Date(NOW.getTime() + DAY - 1) } });
  assertEquals(await t.sr.token(), "tok-1");
});

Deno.test("token: concurrent callers share one login", async () => {
  const t = setup(() => jsonResponse(200, {}), { token: null });
  const [a, b] = await Promise.all([t.sr.token(), t.sr.token()]);
  assertEquals([a, b], ["tok-1", "tok-1"]);
  assertEquals(t.loginCalls().length, 1);
});

Deno.test("UNVERIFIED pin: login token is read from `token`; anything else fails", async () => {
  const f = fakeFetch(() => jsonResponse(200, { access_token: "x" }));
  const sr = createShiprocket({
    email: "api@shop.test",
    password: "pw-secret-xyz",
    fetch: f.fetch,
    tokenStore: memoryStore().store,
    delay: neverDelay,
  });
  const err = await assertRejects(() => sr.token(), ShiprocketError);
  assertEquals(err.status, 200);
  assert(!err.message.includes("pw-secret-xyz"));
});

Deno.test("401 → re-login and retry once with the new token", async () => {
  const t = setup((c) =>
    c.headers.get("authorization") === "Bearer cached"
      ? jsonResponse(401, { message: "Token has expired" })
      : jsonResponse(200, { tracking_data: { track_status: 1, shipment_status: 7, track_url: "https://shiprocket.co//tracking/AWB1" } })
  );
  const r = await t.sr.track("AWB1");
  assertEquals(r.shipmentStatusId, 7);
  assertEquals(t.loginCalls().length, 1);
  assertEquals(t.apiCalls().map((c) => c.headers.get("authorization")), ["Bearer cached", "Bearer tok-1"]);
});

Deno.test("401 twice → throws, only one retry", async () => {
  const t = setup(() => jsonResponse(401, { message: "Unauthenticated" }));
  const err = await assertRejects(() => t.sr.track("AWB1"), ShiprocketError);
  assertEquals(err.status, 401);
  assertEquals(t.apiCalls().length, 2);
});

// ---------- postcodeState ----------

Deno.test("postcodeState: returns state; sends bearer token", async () => {
  const t = setup(() =>
    jsonResponse(200, { success: true, postcode_details: { postcode: "201001", state: "Uttar Pradesh", state_code: "UP" } })
  );
  assertEquals(await t.sr.postcodeState("201001"), "Uttar Pradesh");
  const c = t.apiCalls()[0];
  assertEquals(c.url, `${BASE}/open/postcode/details?postcode=201001`);
  // UNVERIFIED pin: we always send the token to the /open/ endpoint.
  assertEquals(c.headers.get("authorization"), "Bearer cached");
});

Deno.test("postcodeState: null on 403 unknown, success false, timeout, network, login failure", async () => {
  assertEquals(
    await setup(() => jsonResponse(403, { message: "Mapped City-State details not found for 999999", status_code: 403 }))
      .sr.postcodeState("999999"),
    null,
  );
  assertEquals(await setup(() => jsonResponse(200, { success: false })).sr.postcodeState("201001"), null);
  const { delay, requested } = instantDelay();
  assertEquals(await setup(hang, { delay }).sr.postcodeState("201001"), null);
  assertEquals(requested, [5_000]);
  assertEquals(await setup(() => Promise.reject(new TypeError("dns"))).sr.postcodeState("201001"), null);
  const noLogin = createShiprocket({
    email: "a",
    password: "b",
    fetch: fakeFetch(() => jsonResponse(500, {})).fetch,
    tokenStore: memoryStore().store,
    delay: neverDelay,
  });
  assertEquals(await noLogin.postcodeState("201001"), null);
});

// ---------- rate (R18) ----------

const courier = (id: number, rate: number | string, etdHours: number | string, extra: Record<string, unknown> = {}) => ({
  courier_company_id: id,
  courier_name: `Courier ${id}`,
  rate,
  etd_hours: etdHours,
  estimated_delivery_days: "3",
  blocked: 0,
  ...extra,
});
const serviceability = (data: Record<string, unknown>) => ({ status: 200, currency: "INR", data });

Deno.test("rate: query params and recommended courier picked", async () => {
  const t = setup(() =>
    jsonResponse(
      200,
      serviceability({
        recommended_courier_company_id: 2,
        available_courier_companies: [courier(1, 40, 24), courier(2, 73, 72), courier(3, 50, 48)],
      }),
    )
  );
  const r = await t.sr.rate({ deliveryPincode: "226001", weightKg: 1.5, declaredValue: 2499 });
  assertEquals(r, { rate: 73, courierId: 2, courierName: "Courier 2", etdDays: 3 });
  const u = new URL(t.apiCalls()[0].url);
  assertEquals(u.pathname, "/v1/external/courier/serviceability/");
  assertEquals(Object.fromEntries(u.searchParams), {
    pickup_postcode: "201001",
    delivery_postcode: "226001",
    cod: "0",
    weight: "1.5",
    declared_value: "2499",
  });
});

Deno.test("R18: recommended missing from list → lowest etd_hours, ties lowest rate", () => {
  const r = selectCourier(serviceability({
    recommended_courier_company_id: 99,
    available_courier_companies: [courier(1, 80, 48), courier(2, 60, 48), courier(3, 40, 72)],
  }));
  assertEquals(r?.courierId, 2);
});

Deno.test("R18: recommended but blocked (flag or blocked list) → fallback", () => {
  assertEquals(
    selectCourier(serviceability({
      recommended_courier_company_id: 1,
      available_courier_companies: [courier(1, 30, 24, { blocked: 1 }), courier(2, 60, 48)],
    }))?.courierId,
    2,
  );
  assertEquals(
    selectCourier(serviceability({
      recommended_courier_company_id: 1,
      blocked_courier_companies: [{ courier_company_id: 1, block_reason: "x" }],
      available_courier_companies: [courier(1, 30, 24), courier(2, 60, 48)],
    }))?.courierId,
    2,
  );
});

Deno.test("R18: string numbers are parsed", () => {
  const r = selectCourier({
    status: "200",
    data: {
      recommended_courier_company_id: "7",
      available_courier_companies: [courier(7, "54.5", "96", { courier_company_id: "7", estimated_delivery_days: "4" })],
    },
  });
  assertEquals(r, { rate: 54.5, courierId: 7, courierName: "Courier 7", etdDays: 4 });
});

Deno.test("R18: missing etd_hours sorts last", () => {
  const r = selectCourier(serviceability({
    available_courier_companies: [courier(1, 10, ""), courier(2, 90, 72)],
  }));
  assertEquals(r?.courierId, 2);
});

Deno.test("R18: none usable → null (all blocked, bad rate, empty, missing data, body status 404)", () => {
  assertEquals(selectCourier(serviceability({ available_courier_companies: [courier(1, 50, 24, { blocked: 1 })] })), null);
  assertEquals(selectCourier(serviceability({ available_courier_companies: [courier(1, "n/a", 24), courier(2, 0, 24)] })), null);
  assertEquals(selectCourier(serviceability({ available_courier_companies: [] })), null);
  assertEquals(selectCourier({ status: 200 }), null);
  assertEquals(selectCourier({ status: 404, message: "Order does not exist!" }), null);
  assertEquals(selectCourier(null), null);
});

Deno.test("rate: HTTP 200 with body status 404 → null", async () => {
  assertEquals(
    await setup(() => jsonResponse(200, { status: 404, message: "Order does not exist!" }))
      .sr.rate({ deliveryPincode: "226001", weightKg: 1, declaredValue: 100 }),
    null,
  );
});

Deno.test("rate: 422 → null", async () => {
  assertEquals(
    await setup(() => jsonResponse(422, { message: "Required field missing", status_code: 422 }))
      .sr.rate({ deliveryPincode: "226001", weightKg: 1, declaredValue: 100 }),
    null,
  );
});

Deno.test("rate: hung upstream → null after the 5 s timeout", async () => {
  const { delay, requested } = instantDelay();
  const t = setup(hang, { delay });
  assertEquals(await t.sr.rate({ deliveryPincode: "226001", weightKg: 1, declaredValue: 100 }), null);
  assertEquals(requested, [5_000]);
});

// ---------- createOrder / updateOrder (R17) ----------

const orderInput: SrOrderInput = {
  orderRef: "WEB-000001",
  orderDate: new Date("2026-10-23T06:00:00Z"),
  billing: {
    name: "Asha Gupta",
    address: "12 Raj Nagar",
    city: "Ghaziabad District Extended Long City Name",
    pincode: "201002",
    state: "Uttar Pradesh",
    phone: "9876543210",
    email: "asha@example.com",
  },
  items: [{ name: "Silk Saree", sku: "BC25001-RED-FREE", units: 1, sellingPrice: 2499 }],
  subTotal: 2499,
  lengthCm: 32,
  breadthCm: 28,
  heightCm: 5,
  weightKg: 1,
};

Deno.test("srOrderDate formats IST yyyy-mm-dd HH:MM", () => {
  assertEquals(srOrderDate(new Date("2026-10-23T20:00:00Z")), "2026-10-24 01:30");
});

Deno.test("createOrder: payload fields and ids", async () => {
  const t = setup(() => jsonResponse(200, { order_id: 16161616, shipment_id: 15151515, status: "NEW", status_code: 1 }));
  const r = await t.sr.createOrder(orderInput, "shop@gmail.com");
  assertEquals(r, { srOrderId: 16161616, shipmentId: 15151515 });
  const c = t.apiCalls()[0];
  assertEquals(c.url, `${BASE}/orders/create/adhoc`);
  const b = c.body as Record<string, unknown>;
  assertEquals(b.order_id, "WEB-000001");
  assertEquals(b.order_date, "2026-10-23 11:30");
  assertEquals(b.pickup_location, "Shop");
  assertEquals(b.payment_method, "Prepaid");
  assertEquals(b.shipping_is_billing, true);
  assertEquals(b.billing_country, "India");
  assertEquals(b.billing_email, "asha@example.com");
  assertEquals((b.billing_city as string).length, 30);
  assertEquals(b.order_items, [{ name: "Silk Saree", sku: "BC25001-RED-FREE", units: 1, selling_price: 2499 }]);
  assertEquals([b.sub_total, b.length, b.breadth, b.height, b.weight], [2499, 32, 28, 5, 1]);
});

Deno.test("R17: no shopper email → billing_email = fallback; both empty → refused before calling", async () => {
  const t = setup(() => jsonResponse(200, { order_id: 1, shipment_id: 2 }));
  await t.sr.createOrder({ ...orderInput, billing: { ...orderInput.billing, email: null } }, "shop@gmail.com");
  assertEquals((t.apiCalls()[0].body as Record<string, unknown>).billing_email, "shop@gmail.com");
  await t.sr.createOrder({ ...orderInput, billing: { ...orderInput.billing, email: "  " } }, "shop@gmail.com");
  assertEquals((t.apiCalls()[1].body as Record<string, unknown>).billing_email, "shop@gmail.com");
  await assertRejects(
    () => t.sr.createOrder({ ...orderInput, billing: { ...orderInput.billing, email: "" } }, ""),
    RangeError,
  );
  assertEquals(t.apiCalls().length, 2);
});

Deno.test("createOrder: 422 and 200-without-ids throw ShiprocketError", async () => {
  const e1 = await assertRejects(
    () => setup(() => jsonResponse(422, { message: "Oops! Invalid Data.", errors: {} })).sr.createOrder(orderInput, "s@x"),
    ShiprocketError,
  );
  assertEquals(e1.status, 422);
  const e2 = await assertRejects(
    () => setup(() => jsonResponse(200, { message: "weird" })).sr.createOrder(orderInput, "s@x"),
    ShiprocketError,
  );
  assertEquals(e2.status, 200);
});

Deno.test("updateOrder posts the same payload to update/adhoc", async () => {
  const t = setup(() => jsonResponse(200, { success: true, order_id: 16161616, shipment_id: 15151515 }));
  assertEquals(await t.sr.updateOrder(orderInput, "s@x"), { srOrderId: 16161616, shipmentId: 15151515 });
  assertEquals(t.apiCalls()[0].url, `${BASE}/orders/update/adhoc`);
  assertEquals((t.apiCalls()[0].body as Record<string, unknown>).order_id, "WEB-000001");
});

// ---------- AWB, pickup ----------

Deno.test("assignAwb: with courier id; parses awb + courier", async () => {
  const t = setup(() =>
    jsonResponse(200, {
      awb_assign_status: 1,
      response: { data: { awb_code: "AWB123", courier_company_id: 2, courier_name: "Delhivery" } },
    })
  );
  assertEquals(await t.sr.assignAwb(15151515, 2), { awb: "AWB123", courierId: 2, courierName: "Delhivery" });
  assertEquals(t.apiCalls()[0].body, { shipment_id: 15151515, courier_id: 2 });
});

Deno.test("assignAwb: courier omitted; awb_assign_status 0 → throws", async () => {
  const t = setup(() => jsonResponse(200, { awb_assign_status: 0, response: { data: { awb_assign_error: "low balance" } } }));
  await assertRejects(() => t.sr.assignAwb(1), ShiprocketError);
  assertEquals(t.apiCalls()[0].body, { shipment_id: 1 });
});

Deno.test("pickup: array shipment id; pickup_status must be 1", async () => {
  const t = setup(() =>
    jsonResponse(200, { pickup_status: 1, response: { pickup_scheduled_date: "2026-10-24 10:00:00", pickup_token_number: 777 } })
  );
  assertEquals(await t.sr.pickup(5), { scheduledDate: "2026-10-24 10:00:00", tokenNumber: "777" });
  assertEquals(t.apiCalls()[0].body, { shipment_id: [5] });
  await assertRejects(() => setup(() => jsonResponse(200, { pickup_status: 0 })).sr.pickup(5), ShiprocketError);
  await assertRejects(() => setup(() => jsonResponse(400, { message: "Invalid shipment id" })).sr.pickup(5), ShiprocketError);
});

// ---------- manifest / label (R19) ----------

Deno.test("manifest: status 1 + url → url", async () => {
  const t = setup(() => jsonResponse(200, { status: 1, manifest_url: "https://s3/manifest.pdf" }));
  assertEquals(await t.sr.manifest(5, 16161616), "https://s3/manifest.pdf");
  assertEquals(t.apiCalls()[0].body, { shipment_id: [5] });
});

Deno.test("R19: manifest HTTP 200 failures throw (empty url, status 0)", async () => {
  await assertRejects(
    () => setup(() => jsonResponse(200, { status: 1, manifest_url: "" })).sr.manifest(5, 1),
    ShiprocketError,
  );
  await assertRejects(
    () => setup(() => jsonResponse(200, { status: 0, manifest_url: "https://s3/m.pdf" })).sr.manifest(5, 1),
    ShiprocketError,
  );
});

Deno.test("R19: manifest 400 already manifested → print succeeds → url", async () => {
  const t = setup((c) =>
    c.url.endsWith("/manifests/generate")
      ? jsonResponse(400, { message: "Manifest already generated", already_manifested_shipment_ids: [5] })
      : jsonResponse(200, { manifest_url: "https://s3/reprint.pdf" })
  );
  assertEquals(await t.sr.manifest(5, 16161616), "https://s3/reprint.pdf");
  // UNVERIFIED pin: print takes { order_ids: [sr_order_id] }.
  assertEquals(t.apiCalls()[1].url, `${BASE}/manifests/print`);
  assertEquals(t.apiCalls()[1].body, { order_ids: [16161616] });
});

Deno.test("R19: manifest 400 already manifested but print fails → throws", async () => {
  const t = setup((c) =>
    c.url.endsWith("/manifests/generate")
      ? jsonResponse(400, { already_manifested_shipment_ids: [5] })
      : jsonResponse(200, { manifest_url: "" })
  );
  await assertRejects(() => t.sr.manifest(5, 1), ShiprocketError);
});

Deno.test("R19: manifest 400 for another shipment's ids → throws without print", async () => {
  const t = setup(() => jsonResponse(400, { already_manifested_shipment_ids: [6] }));
  await assertRejects(() => t.sr.manifest(5, 1), ShiprocketError);
  assertEquals(t.apiCalls().length, 1);
});

Deno.test("label: label_created 1 + url → url", async () => {
  const t = setup(() => jsonResponse(200, { label_created: 1, label_url: "https://kr-ship.s3/label.pdf", not_created: [] }));
  assertEquals(await t.sr.label(5), "https://kr-ship.s3/label.pdf");
  assertEquals(t.apiCalls()[0].url, `${BASE}/courier/generate/label`);
  assertEquals(t.apiCalls()[0].body, { shipment_id: [5] });
});

Deno.test("R19: label HTTP 200 failures throw (label_created 0, falsy, empty url)", async () => {
  const e = await assertRejects(
    () =>
      setup(() => jsonResponse(200, { label_created: 0, response: "No valid shipment ids to print label" })).sr.label(5),
    ShiprocketError,
  );
  assert(e.message.includes("No valid shipment ids"));
  await assertRejects(() => setup(() => jsonResponse(200, { label_url: "https://x" })).sr.label(5), ShiprocketError);
  await assertRejects(() => setup(() => jsonResponse(200, { label_created: 1, label_url: "" })).sr.label(5), ShiprocketError);
});

// ---------- cancel, track ----------

Deno.test("cancel: 204 ok; 500 throws; empty list makes no call", async () => {
  const t = setup(() => new Response(null, { status: 204 }));
  await t.sr.cancel([16161616]);
  assertEquals(t.apiCalls()[0].body, { ids: [16161616] });
  await t.sr.cancel([]);
  assertEquals(t.apiCalls().length, 1);
  await assertRejects(
    () => setup(() => jsonResponse(500, { message: "Trying to get property of non-object" })).sr.cancel([1]),
    ShiprocketError,
  );
});

Deno.test("cancelAwbs posts awbs; empty list makes no call; non-2xx throws", async () => {
  const t = setup(() => new Response(null, { status: 204 }));
  await t.sr.cancelAwbs(["AWB1", "AWB2"]);
  assert(t.apiCalls()[0].url.endsWith("/orders/cancel/shipment/awbs"));
  assertEquals(t.apiCalls()[0].body, { awbs: ["AWB1", "AWB2"] });
  await t.sr.cancelAwbs([]);
  assertEquals(t.apiCalls().length, 1);
  await assertRejects(
    () => setup(() => jsonResponse(422, { message: "bad awb" })).sr.cancelAwbs(["X"]),
    ShiprocketError,
  );
});

Deno.test("track: shipment-scheme status, current status, url", async () => {
  const t = setup(() =>
    jsonResponse(200, {
      tracking_data: {
        track_status: 1,
        shipment_status: 18,
        shipment_track: [{ awb_code: "AWB1", current_status: "IN TRANSIT" }],
        track_url: "https://shiprocket.co//tracking/AWB1",
        etd: "2026-10-26 18:00:00",
      },
    })
  );
  assertEquals(await t.sr.track("AWB1"), {
    hasData: true,
    shipmentStatusId: 18,
    currentStatus: "IN TRANSIT",
    trackUrl: "https://shiprocket.co//tracking/AWB1",
    etd: "2026-10-26 18:00:00",
  });
  assertEquals(t.apiCalls()[0].url, `${BASE}/courier/track/awb/AWB1`);
});

Deno.test("track: no scans yet → hasData false, status null", async () => {
  const t = setup(() => jsonResponse(200, { tracking_data: { track_status: 0, error: "Aahh! There is no activities found" } }));
  const r = await t.sr.track("AWB1");
  assertEquals([r.hasData, r.shipmentStatusId], [false, null]);
});

Deno.test("UNVERIFIED pin: track also accepts payload nested under the AWB key", async () => {
  const t = setup(() => jsonResponse(200, { AWB1: { tracking_data: { track_status: 1, shipment_status: 7 } } }));
  assertEquals((await t.sr.track("AWB1")).shipmentStatusId, 7);
});
