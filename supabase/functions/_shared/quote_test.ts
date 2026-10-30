import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { buildQuote, orderPayload, parseItems, type QuoteRequest } from "./quote.ts";
import { ApiError } from "./context.ts";
import { fakeShiprocket, FakeStore, USER, V1, V2, variant } from "./pay_testing.ts";

const guest = { authUserId: null, ipHash: "iphash" };
const req = (over: Partial<QuoteRequest> = {}): QuoteRequest => ({
  items: [{ variantId: V1, qty: 1 }],
  pincode: "201001",
  code: null,
  creditRequested: 0,
  phone: null,
  ...over,
});

function deps(opts: { state?: string | null; rate?: null } = {}) {
  const store = new FakeStore();
  const sr = fakeShiprocket(opts);
  return { store, sr, deps: { store, shiprocket: sr.client } };
}

Deno.test("parseItems: merges duplicate variants, rejects bad ids and quantities", () => {
  assertEquals(parseItems([{ variantId: V1, qty: 1 }, { variantId: V1.toUpperCase(), qty: 2 }]), [{ variantId: V1, qty: 3 }]);
  for (const bad of [[], null, [{ variantId: "x", qty: 1 }], [{ variantId: V1, qty: 0 }], [{ variantId: V1, qty: 1.5 }], [{ variantId: V1, qty: 21 }]]) {
    const e = assertThrows(() => parseItems(bad), ApiError);
    assertEquals([e.status, e.code], [400, "bad_request"]);
  }
});

Deno.test("quote: prices from the DB, courier rate rounded up, client fields ignored", async () => {
  const { deps: d, sr } = deps();
  const items = [{ variantId: V1, qty: 1, unitPrice: 1, price: 1 }] as unknown as QuoteRequest["items"];
  const r = await buildQuote(d, req({ items }), guest);
  assertEquals(r.response.quote.subtotal, 1000);
  assertEquals(r.response.quote.lines[0].unitPrice, 1000);
  assertEquals(r.response.quote.shipping, 80);
  assertEquals(r.response.shippingSource, "rate");
  assertEquals(r.response.quote.gatewayAmount, 1080);
  assertEquals(r.response.pincode, { ok: true, inUp: true });
  assertEquals(r.courierId, 12);
  // One 0.5 kg unit is quoted at the small bag's 0.96 kg volumetric weight, as couriers bill it.
  assertEquals(sr.calls.rate, [{ deliveryPincode: "201001", weightKg: 0.96, declaredValue: 1000 }]);
  assertEquals(r.response.live, true);
  assertEquals(r.response.unavailable, []);
  assertEquals(r.response.code, null);
});

Deno.test("quote: Uttarakhand pincode 263001 → accepted outside UP, courier rate asked", async () => {
  const { deps: d, sr } = deps({ state: "Uttarakhand" });
  const r = await buildQuote(d, req({ pincode: "263001" }), guest);
  assertEquals(r.response.pincode, { ok: true, inUp: false });
  assertEquals(sr.calls.rate.map((c) => c.deliveryPincode), ["263001"]);
  assertEquals([r.response.shippingSource, r.response.quote.shipping], ["rate", 80]);
});

Deno.test("quote: outside UP with no courier rate → national slab (Kurti ₹250)", async () => {
  const { deps: d } = deps({ rate: null });
  const r = await buildQuote(d, req({ pincode: "400001" }), guest);
  assertEquals(r.response.pincode, { ok: true, inUp: false });
  assertEquals([r.response.shippingSource, r.response.quote.shipping], ["flat", 250]);
});

Deno.test("quote: shared prefix with a failed lookup → accepted, not counted as UP (R16)", async () => {
  const { deps: d } = deps({ state: null, rate: null });
  const r = await buildQuote(d, req({ pincode: "247001" }), guest);
  assertEquals(r.response.pincode, { ok: true, inUp: false });
  assertEquals(r.response.quote.shipping, 250);
});

Deno.test("quote: no pincode → pincode null and flat Kurti slab ₹140; rate failure → flat", async () => {
  const { deps: d } = deps();
  const r = await buildQuote(d, req({ pincode: null }), guest);
  assertEquals([r.response.pincode, r.response.shippingSource, r.response.quote.shipping], [null, "flat", 140]);
  const f = deps({ rate: null });
  const r2 = await buildQuote(f.deps, req(), guest);
  assertEquals([r2.response.shippingSource, r2.response.quote.shipping, r2.courierId], ["flat", 140, null]);
});

Deno.test("quote: ₹5,000+ goods ship free without a rate call", async () => {
  const { deps: d, store, sr } = deps();
  store.variantRows = [variant({ retailPrice: 2500 })];
  const r = await buildQuote(d, req({ items: [{ variantId: V1, qty: 2 }] }), guest);
  assertEquals([r.response.shippingSource, r.response.quote.shipping, sr.calls.rate.length], ["free", 0, 0]);
});

Deno.test("quote: stock below qty and unknown variants are listed as unavailable", async () => {
  const { deps: d, store } = deps();
  store.variantRows = [variant({ stock: 1 })];
  const r = await buildQuote(d, req({ items: [{ variantId: V1, qty: 2 }, { variantId: V2, qty: 1 }] }), guest);
  assertEquals(r.response.unavailable, [{ variantId: V1, available: 1 }, { variantId: V2, available: 0 }]);
  assertEquals(r.response.quote.lines.map((l) => l.variantId), [V1]);
  const e = await assertRejects(() => buildQuote(d, req({ items: [{ variantId: V2, qty: 1 }] }), guest), ApiError);
  assertEquals([e.status, e.code], [409, "out_of_stock"]);
});

Deno.test("quote: voucher code via online_code_check with verified identity only (R8/R9)", async () => {
  const { deps: d, store } = deps();
  store.impls.online_code_check = () => ({ status: "ok", kind: "voucher", code: "VOUCHER1234567890", value: 300 });
  const r = await buildQuote(d, req({ code: "VOUCHER1234567890", phone: "9876543210" }), { authUserId: USER, ipHash: "h" });
  assertEquals(store.callsTo("online_code_check"), [
    { p_code: "VOUCHER1234567890", p_phone: "9876543210", p_auth_user: USER, p_ip_hash: "h" },
  ]);
  assertEquals(r.response.code, { status: "ok", kind: "voucher" });
  assertEquals([r.response.quote.voucherApplied, r.response.quote.gatewayAmount], [300, 780]);
  assertEquals([r.voucherCode, r.promoCode], ["VOUCHER1234567890", null]);
});

Deno.test("quote: voucher larger than the amount due → leftover message; none when fully used", async () => {
  const { deps: d, store } = deps();
  store.impls.online_code_check = () => ({ status: "ok", kind: "voucher", code: "V", value: 2330 });
  const r = await buildQuote(d, req({ code: "V" }), guest);
  assertEquals([r.response.quote.voucherApplied, r.response.quote.gatewayAmount], [1080, 0]);
  assertEquals(r.response.code, {
    status: "ok",
    kind: "voucher",
    message: "₹1,250 left on your voucher will be emailed to you after you pay.",
  });
  store.impls.online_code_check = () => ({ status: "ok", kind: "voucher", code: "V", value: 1330.5 });
  assertEquals((await buildQuote(d, req({ code: "V" }), guest)).response.code?.message, "₹250.50 left on your voucher will be emailed to you after you pay.");
  store.impls.online_code_check = () => ({ status: "ok", kind: "voucher", code: "V", value: 300 });
  assertEquals((await buildQuote(d, req({ code: "V" }), guest)).response.code?.message, undefined);
});

Deno.test("quote: promo code applies its discount; a zero-value promo is not sent to the order", async () => {
  const { deps: d, store } = deps();
  store.impls.online_code_check = () => ({ status: "ok", kind: "promo", code: "DIWALI10", type: "percentage", value: 10, max_discount: null, min_total: null, rules: null });
  const r = await buildQuote(d, req({ code: "DIWALI10" }), guest);
  assertEquals([r.response.quote.promoDiscount, r.promoCode], [100, "DIWALI10"]);
  store.impls.online_code_check = () => ({ status: "ok", kind: "promo", code: "BIG", type: "flat", value: 500, max_discount: null, min_total: 3000, rules: null });
  const r2 = await buildQuote(d, req({ code: "BIG" }), guest);
  assertEquals([r2.response.quote.promoDiscount, r2.promoCode, r2.response.code?.status], [0, null, "ok"]);
});

Deno.test("quote: invalid and rate-limited codes apply nothing", async () => {
  const { deps: d, store } = deps();
  store.impls.online_code_check = () => ({ status: "invalid" });
  const r = await buildQuote(d, req({ code: "NOPE" }), guest);
  assertEquals([r.response.code?.status, r.response.quote.voucherApplied, r.response.quote.promoDiscount], ["invalid", 0, 0]);
  store.impls.online_code_check = () => ({ status: "rate_limited" });
  assertEquals((await buildQuote(d, req({ code: "NOPE" }), guest)).response.code?.status, "rate_limited");
});

Deno.test("quote: store credit only for a verified user, capped at the balance", async () => {
  const { deps: d, store } = deps();
  store.credit.set(USER, 700);
  const g = await buildQuote(d, req({ creditRequested: 1000 }), guest);
  assertEquals([g.response.creditAvailable, g.response.quote.creditApplied], [0, 0]);
  const u = await buildQuote(d, req({ creditRequested: 1000 }), { authUserId: USER, ipHash: null });
  assertEquals([u.response.creditAvailable, u.response.quote.creditApplied, u.response.quote.gatewayAmount], [700, 700, 380]);
});

Deno.test("orderPayload: online_order_create shape with credit_part = nonGatewayPart", async () => {
  const { deps: d, store } = deps();
  store.credit.set(USER, 500);
  store.variantRows = [variant(), variant({ variantId: V2, retailPrice: 333.33, categoryName: "Lehenga" })];
  const r = await buildQuote(
    d,
    req({ items: [{ variantId: V1, qty: 1 }, { variantId: V2, qty: 3 }], creditRequested: 500 }),
    { authUserId: USER, ipHash: null },
  );
  const p = orderPayload(r, {
    attemptKey: "a",
    contact: { name: "A", phone: "9876543210", email: null },
    address: { pincode: "201001" },
    accessTokenHash: "h",
  });
  assertEquals(p.p_order.credit_applied, 500);
  assertEquals(p.p_order.quoted_courier_id, 12);
  assertEquals(p.p_order.access_token_hash, "h");
  assertEquals(p.p_items.length, 2);
  const sumCredit = p.p_items.reduce((s, i) => s + Math.round(Number(i.credit_part) * 100), 0);
  assertEquals(sumCredit, 50000);
  assertEquals(p.p_items[1], { variant_id: V2, qty: 3, unit_price: 333.33, promo_share: 0, credit_part: r.quote.lines[1].nonGatewayPart });
});
