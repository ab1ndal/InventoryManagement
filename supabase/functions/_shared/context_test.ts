import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  ApiError,
  browserEndpoint,
  cashfreeFromEnv,
  createStore,
  DbError,
  jobKicker,
  newAccessToken,
  readEnv,
  sha256Hex,
  shiprocketFromEnv,
} from "./context.ts";
import { fakeFetch, jsonResponse } from "./testing.ts";
import { ORIGIN, testEnv } from "./pay_testing.ts";

const env = (vars: Record<string, string>) => (n: string) => vars[n];
const base = { SUPABASE_URL: "https://p.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "svc" };

Deno.test("readEnv: required vars, defaults, CASHFREE_ENV validation", () => {
  const e = readEnv(env({ ...base, ALLOWED_ORIGIN: "https://a.com, http://localhost:3000", IP_HASH_SALT: "s", CRON_SECRET: "c", GMAIL_USER: "g@x.com" }));
  assertEquals(e.supabaseUrl, "https://p.supabase.co");
  assertEquals(e.allowedOrigins, ["https://a.com", "http://localhost:3000"]);
  assertEquals([e.cashfreeMode, e.siteUrl, e.ipHashSalt, e.cronSecret, e.shopEmail], [
    "sandbox",
    "https://www.bindalscreations.com",
    "s",
    "c",
    "g@x.com",
  ]);
  assertThrows(() => readEnv(env({ SUPABASE_URL: "x" })), Error, "SUPABASE_SERVICE_ROLE_KEY");
  assertThrows(() => readEnv(env({ ...base, CASHFREE_ENV: "live" })), Error, "CASHFREE_ENV");
  assertEquals(readEnv(env({ ...base, CASHFREE_ENV: "production" })).cashfreeMode, "production");
});

Deno.test("clients are null when their secrets are missing", () => {
  assertEquals(cashfreeFromEnv(env({ CASHFREE_CLIENT_ID: "id" }), "sandbox"), null);
  assert(cashfreeFromEnv(env({ CASHFREE_CLIENT_ID: "id", CASHFREE_CLIENT_SECRET: "s" }), "sandbox") !== null);
  const ts = { get: () => Promise.resolve(null), set: () => Promise.resolve() };
  assertEquals(shiprocketFromEnv(env({ SHIPROCKET_API_EMAIL: "e" }), ts), null);
  assert(shiprocketFromEnv(env({ SHIPROCKET_API_EMAIL: "e", SHIPROCKET_API_PASSWORD: "p" }), ts) !== null);
});

Deno.test("newAccessToken: 43-char base64url token, stored as its SHA-256 hex", async () => {
  const { token, hash } = await newAccessToken(() => new Uint8Array(32).fill(255));
  assertEquals(token, "_".repeat(42) + "8");
  assertEquals(hash, await sha256Hex(token));
  assert(/^[0-9a-f]{64}$/.test(hash));
});

function storeWith(handler: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(handler);
  const db = createClient("https://p.supabase.co", "svc", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: f.fetch as unknown as typeof fetch },
  });
  return { store: createStore(db), calls: f.calls };
}

Deno.test("store.rpc: POSTs /rest/v1/rpc/<fn>; a SQL raise becomes DbError with message and code", async () => {
  const ok = storeWith(() => jsonResponse(200, { result: "confirmed" }));
  assertEquals(await ok.store.rpc("online_order_confirm_payment", { p_order_ref: "WEB-000001" }), { result: "confirmed" });
  assertEquals(new URL(ok.calls[0].url).pathname, "/rest/v1/rpc/online_order_confirm_payment");
  assertEquals(ok.calls[0].body, { p_order_ref: "WEB-000001" });
  const bad = storeWith(() => jsonResponse(400, { message: "checkout is not live", code: "42501" }));
  const e = await assertRejects(() => bad.store.rpc("online_order_create", {}), DbError);
  assertEquals([e.message, e.code], ["checkout is not live", "42501"]);
});

Deno.test("store.variants / orderByRef: PostgREST queries and numeric coercion", async () => {
  const { store, calls } = storeWith((c) => {
    const u = new URL(c.url);
    if (u.pathname.endsWith("/productsizecolors")) {
      return jsonResponse(200, [{
        variantid: "v1",
        productid: "BC25001",
        size: "M",
        color: "Red",
        stock: "3.000",
        products: { name: "Kurti", retailprice: "1299.00", categoryid: "KUR", categories: { name: "Kurti" } },
      }]);
    }
    return jsonResponse(200, [{ id: "o-1", order_ref: "WEB-000001", subtotal: "1000.00", gateway_amount: "1080.00", shipping: "80" }]);
  });
  assertEquals(await store.variants(["v1"]), [{
    variantId: "v1",
    productId: "BC25001",
    name: "Kurti",
    size: "M",
    color: "Red",
    stock: 3,
    retailPrice: 1299,
    categoryId: "KUR",
    categoryName: "Kurti",
  }]);
  assert(decodeURIComponent(calls[0].url).includes("variantid=in.(v1)"));
  const o = await store.orderByRef("WEB-000001");
  assertEquals([o?.subtotal, o?.gateway_amount, o?.shipping], [1000, 1080, 80]);
  assert(decodeURIComponent(calls[1].url).includes("order_ref=eq.WEB-000001"));
});

Deno.test("jobKicker: POSTs run-jobs with the service-role bearer and never throws", async () => {
  const f = fakeFetch(() => jsonResponse(200, {}));
  jobKicker(testEnv, f.fetch as unknown as typeof fetch)();
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(f.calls[0].url, "https://proj.supabase.co/functions/v1/run-jobs");
  assertEquals(f.calls[0].headers.get("authorization"), "Bearer service-key");
  const failing = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
  jobKicker(testEnv, failing)();
  await new Promise((r) => setTimeout(r, 0));
});

Deno.test("browserEndpoint: ApiError → {error, code}; unexpected → bare 500 without details", async () => {
  const req = () => new Request("https://fn.test/x", { method: "POST", headers: { origin: ORIGIN } });
  const a = await browserEndpoint(req(), [ORIGIN], "x", () => Promise.reject(new ApiError(409, "busy", "held")));
  assertEquals([a.status, await a.json()], [409, { error: "held", code: "busy" }]);
  const b = await browserEndpoint(req(), [ORIGIN], "x", () => Promise.reject(new Error("secret detail")));
  assertEquals([b.status, await b.json()], [500, { error: "internal error", code: "internal" }]);
  assertEquals(b.headers.get("access-control-allow-origin"), ORIGIN);
});
