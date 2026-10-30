import { assertEquals } from "@std/assert";
import { handler } from "./handler.ts";
import { ORIGIN, post, testDeps, USER, V1 } from "../_shared/pay_testing.ts";

const URL_ = "https://fn.test/checkout-quote";

Deno.test("checkout-quote: contract shape with CORS for the allowed origin", async () => {
  const res = await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }], pincode: "201001" }), testDeps());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  const j = await res.json();
  assertEquals(Object.keys(j).sort(), ["code", "creditAvailable", "live", "pincode", "quote", "shippingSource", "unavailable"]);
  assertEquals(Object.keys(j.quote).sort(), [
    "amountDue", "creditApplied", "freeShippingGap", "gatewayAmount", "lines", "promoDiscount", "shipping", "subtotal", "voucherApplied",
  ]);
  assertEquals(Object.keys(j.quote.lines[0]).sort(), ["color", "name", "paidValue", "productId", "promoShare", "qty", "size", "unitPrice", "variantId"]);
  assertEquals([j.live, j.quote.gatewayAmount, j.shippingSource, j.code], [true, 1080, "rate", null]);
});

Deno.test("checkout-quote: no pincode → pincode null", async () => {
  const j = await (await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }] }), testDeps())).json();
  assertEquals(j.pincode, null);
});

Deno.test("checkout-quote: fulfilment pickup → ₹0 shipping, source pickup, pincode ignored; bad value 400", async () => {
  const j = await (await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }], pincode: "201001", fulfilment: "pickup" }), testDeps()))
    .json();
  assertEquals([j.quote.shipping, j.quote.freeShippingGap, j.shippingSource, j.pincode], [0, 0, "pickup", null]);
  const bad = await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }], fulfilment: "courier" }), testDeps());
  assertEquals(bad.status, 400);
});

Deno.test("checkout-quote: live false still quotes, with live:false", async () => {
  const deps = testDeps();
  deps.store.live = false;
  const j = await (await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }] }), deps)).json();
  assertEquals([j.live, j.quote.subtotal], [false, 1000]);
});

Deno.test("checkout-quote: anon key = guest, user JWT unlocks credit, forged JWT 401", async () => {
  const deps = testDeps();
  deps.store.credit.set(USER, 200);
  const b = { items: [{ variantId: V1, qty: 1 }], creditRequested: 500 };
  const anon = await (await handler(post(URL_, b, { authorization: "Bearer anon-key" }), deps)).json();
  assertEquals([anon.creditAvailable, anon.quote.creditApplied], [0, 0]);
  const user = await (await handler(post(URL_, b, { authorization: "Bearer user.jwt" }), deps)).json();
  assertEquals([user.creditAvailable, user.quote.creditApplied], [200, 200]);
  assertEquals((await handler(post(URL_, b, { authorization: "Bearer forged" }), deps)).status, 401);
});

Deno.test("checkout-quote: bad input 400, all-unknown items 409 out_of_stock, hostile origin gets no CORS", async () => {
  const deps = testDeps();
  const bad = await handler(post(URL_, { items: [] }), deps);
  assertEquals([bad.status, (await bad.json()).code], [400, "bad_request"]);
  const oos = await handler(post(URL_, { items: [{ variantId: "99999999-9999-4999-8999-999999999999", qty: 1 }] }), deps);
  assertEquals([oos.status, (await oos.json()).code], [409, "out_of_stock"]);
  const hostile = await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }] }, { origin: "https://evil.example" }), deps);
  assertEquals(hostile.headers.get("access-control-allow-origin"), null);
  await hostile.body?.cancel();
});

Deno.test("checkout-quote: holderKey → availability for that holder; JWT user wins; bad key 400", async () => {
  const g = "g:55555555-5555-4555-8555-555555555555";
  const deps = testDeps();
  deps.store.impls.variant_availability = () => [{ variant_id: V1, stock: 1, held_by_others: 1, available: 0, my_held: 0, others_expire_at: null }];
  const j = await (await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }], holderKey: g }), deps)).json();
  assertEquals(j.unavailable, [{ variantId: V1, available: 0 }]);
  assertEquals(deps.store.callsTo("variant_availability")[0].p_holder_key, g);
  await (await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }], holderKey: g }, { authorization: "Bearer user.jwt" }), deps)).body
    ?.cancel();
  assertEquals(deps.store.callsTo("variant_availability")[1].p_holder_key, `u:${USER}`);
  const bad = await handler(post(URL_, { items: [{ variantId: V1, qty: 1 }], holderKey: "x" }), deps);
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
});
