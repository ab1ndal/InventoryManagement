import { assert, assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  handlePreflight,
  hashIp,
  HttpError,
  json,
  optionalUser,
  parseAllowedOrigins,
  profileAdminCheck,
  requireAdmin,
  supabaseVerifier,
  type VerifyJwt,
} from "./http.ts";

const ALLOWED = ["https://www.bindalscreations.com", "http://localhost:3000"];
const ANON = "anon.jwt.key";

const req = (headers: Record<string, string> = {}, method = "POST") =>
  new Request("https://fn.test/checkout-quote", { method, headers });

/** Only "valid.jwt" verifies, as user u-1. */
const verify: VerifyJwt = (jwt) => Promise.resolve(jwt === "valid.jwt" ? { id: "u-1" } : null);

Deno.test("parseAllowedOrigins splits the comma list", () => {
  assertEquals(parseAllowedOrigins(" https://a.com, http://localhost:3000 ,,"), ["https://a.com", "http://localhost:3000"]);
  assertEquals(parseAllowedOrigins(undefined), []);
});

Deno.test("CORS: exact allowed origin is echoed, with Vary and no credentials", () => {
  const h = corsHeaders(req({ origin: "https://www.bindalscreations.com" }), ALLOWED);
  assertEquals(h["Access-Control-Allow-Origin"], "https://www.bindalscreations.com");
  assertEquals(h.Vary, "Origin");
  assert(h["Access-Control-Allow-Headers"].includes("authorization"));
  assertEquals(h["Access-Control-Allow-Credentials"], undefined);
});

Deno.test("CORS: hostile, look-alike and missing origins get no Access-Control-Allow-Origin", () => {
  for (
    const origin of [
      "https://evil.example",
      "https://www.bindalscreations.com.evil.example",
      "https://bindalscreations.com",
      "http://www.bindalscreations.com",
      "null",
    ]
  ) {
    const h = corsHeaders(req({ origin }), ALLOWED);
    assertEquals(h["Access-Control-Allow-Origin"], undefined, origin);
    assertEquals(h.Vary, "Origin");
  }
  assertEquals(corsHeaders(req(), ALLOWED)["Access-Control-Allow-Origin"], undefined);
  // "*" in the config is not a wildcard.
  assertEquals(corsHeaders(req({ origin: "https://evil.example" }), ["*"])["Access-Control-Allow-Origin"], undefined);
});

Deno.test("preflight: allowed → 204 with CORS; hostile → 403 without; non-OPTIONS → null", async () => {
  const ok = handlePreflight(req({ origin: "http://localhost:3000" }, "OPTIONS"), ALLOWED)!;
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert(ok.headers.get("access-control-allow-methods")!.includes("POST"));
  await ok.body?.cancel();
  const bad = handlePreflight(req({ origin: "https://evil.example" }, "OPTIONS"), ALLOWED)!;
  assertEquals(bad.status, 403);
  assertEquals(bad.headers.get("access-control-allow-origin"), null);
  assertEquals(handlePreflight(req({ origin: "http://localhost:3000" }), ALLOWED), null);
});

Deno.test("json helper sets status, content type and extra headers", async () => {
  const r = json(201, { a: 1 }, { Vary: "Origin" });
  assertEquals(r.status, 201);
  assertEquals(r.headers.get("content-type"), "application/json; charset=utf-8");
  assertEquals(r.headers.get("vary"), "Origin");
  assertEquals(await r.json(), { a: 1 });
});

Deno.test("optionalUser: absent → null; anon/public key → null", async () => {
  assertEquals(await optionalUser(req(), verify), null);
  assertEquals(await optionalUser(req({ authorization: `Bearer ${ANON}` }), verify, [ANON]), null);
});

// The project's SUPABASE_ANON_KEY is now the sb_publishable_ key, while the
// storefront still sends the legacy anon JWT; its role claim marks it public.
Deno.test("optionalUser: legacy anon-role JWT not in publicKeys → null", async () => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const legacyAnon = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role: "anon" })}.sig`;
  assertEquals(await optionalUser(req({ authorization: `Bearer ${legacyAnon}` }), verify, ["sb_publishable_x"]), null);
  const authed = `${b64({ alg: "HS256" })}.${b64({ role: "authenticated", sub: "u-9" })}.sig`;
  assertEquals((await assertRejects(() => optionalUser(req({ authorization: `Bearer ${authed}` }), verify), HttpError)).status, 401);
});

Deno.test("optionalUser: valid → user", async () => {
  assertEquals(await optionalUser(req({ authorization: "Bearer valid.jwt" }), verify), { id: "u-1" });
});

Deno.test("optionalUser: forged/expired token → 401 (never downgraded to guest)", async () => {
  for (const auth of ["Bearer forged.jwt", "Bearer expired.jwt", "Basic abc", "Bearer", "valid.jwt"]) {
    const err = await assertRejects(() => optionalUser(req({ authorization: auth }), verify, [ANON]), HttpError);
    assertEquals(err.status, 401, auth);
  }
});

Deno.test("requireAdmin: absent → 401, non-admin → 403, admin → user", async () => {
  const isAdmin = (id: string) => Promise.resolve(id === "u-admin");
  const verifyAny: VerifyJwt = (jwt) => Promise.resolve(jwt.startsWith("ok-") ? { id: jwt.slice(3) } : null);
  assertEquals((await assertRejects(() => requireAdmin(req(), verifyAny, isAdmin), HttpError)).status, 401);
  assertEquals(
    (await assertRejects(() => requireAdmin(req({ authorization: `Bearer ${ANON}` }), verifyAny, isAdmin, [ANON]), HttpError))
      .status,
    401,
  );
  assertEquals(
    (await assertRejects(() => requireAdmin(req({ authorization: "Bearer ok-u-shopper" }), verifyAny, isAdmin), HttpError))
      .status,
    403,
  );
  assertEquals(
    (await assertRejects(() => requireAdmin(req({ authorization: "Bearer bad" }), verifyAny, isAdmin), HttpError)).status,
    401,
  );
  assertEquals(await requireAdmin(req({ authorization: "Bearer ok-u-admin" }), verifyAny, isAdmin), { id: "u-admin" });
});

Deno.test("hashIp: first x-forwarded-for hop, salted SHA-256 hex", async () => {
  const expected = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("salt1:203.0.113.7"))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const h = await hashIp(req({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1, 10.0.0.2" }), "salt1");
  assertEquals(h, expected);
  assert(/^[0-9a-f]{64}$/.test(h!));
  assertEquals(await hashIp(req({ "x-forwarded-for": "203.0.113.7" }), "salt1"), expected);
  assert((await hashIp(req({ "x-forwarded-for": "203.0.113.7" }), "salt2")) !== expected);
  assertEquals(await hashIp(req(), "salt1"), null);
  await assertRejects(() => hashIp(req({ "x-forwarded-for": "1.2.3.4" }), ""));
});

Deno.test("hashIp: preferCfConnectingIp uses cf-connecting-ip over a spoofable x-forwarded-for", async () => {
  const viaXff = await hashIp(req({ "x-forwarded-for": "203.0.113.7" }), "salt1");
  const spoofed = req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 203.0.113.7" });
  assertEquals(await hashIp(spoofed, "salt1", { preferCfConnectingIp: true }), viaXff);
  assert((await hashIp(spoofed, "salt1")) !== viaXff, "default keeps the first x-forwarded-for hop");
  assertEquals(await hashIp(req({ "x-forwarded-for": "203.0.113.7" }), "salt1", { preferCfConnectingIp: true }), viaXff);
});

Deno.test("supabaseVerifier maps auth.getUser; error/no user → null", async () => {
  const fake = (result: unknown) => ({ auth: { getUser: () => Promise.resolve(result) } }) as unknown as SupabaseClient;
  assertEquals(await supabaseVerifier(fake({ data: { user: { id: "u-9" } }, error: null }))("t"), { id: "u-9" });
  assertEquals(await supabaseVerifier(fake({ data: { user: null }, error: { message: "bad jwt" } }))("t"), null);
});

Deno.test("profileAdminCheck: admin/superadmin and active only; query error throws", async () => {
  const fake = (result: unknown) => {
    const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve(result) };
    return { from: () => q } as unknown as SupabaseClient;
  };
  assertEquals(await profileAdminCheck(fake({ data: { role: "admin", is_active: true }, error: null }))("u"), true);
  assertEquals(await profileAdminCheck(fake({ data: { role: "superadmin", is_active: null }, error: null }))("u"), true);
  assertEquals(await profileAdminCheck(fake({ data: { role: "admin", is_active: false }, error: null }))("u"), false);
  assertEquals(await profileAdminCheck(fake({ data: { role: "staff" }, error: null }))("u"), false);
  assertEquals(await profileAdminCheck(fake({ data: null, error: null }))("u"), false);
  await assertRejects(() => profileAdminCheck(fake({ data: null, error: { message: "boom" } }))("u"));
});
