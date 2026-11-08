import { assertEquals } from "@std/assert";
import { handler, STATUS_FAILURE_LIMIT } from "./handler.ts";
import { sha256Hex } from "../_shared/context.ts";
import { confirmLikeDb, FakeStore, item, order, post, testDeps, USER } from "../_shared/pay_testing.ts";

const URL_ = "https://fn.test/order-status";
const TOKEN = "tok_abc";

async function setup(over: Parameters<typeof order>[0] = {}) {
  const store = new FakeStore();
  const o = order(over);
  store.orders.push(o);
  store.items.set(o.id, [item()]);
  const hash = await sha256Hex(TOKEN);
  store.impls.online_order_access_ok = (a) => a.p_order_ref === o.order_ref && a.p_token_hash === hash;
  store.impls.online_order_confirm_payment = confirmLikeDb(store);
  return { store, o, deps: testDeps({ store }) };
}

Deno.test("order-status: valid token → contract shape", async () => {
  const { deps, store, o } = await setup({ status: "shipped", awb: "AWB1", leftover_voucher_id: "LEFT123" });
  store.vouchers.set("LEFT123", 250);
  const res = await handler(post(URL_, { orderRef: "web-000001", accessToken: TOKEN }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    orderRef: o.order_ref,
    status: "shipped",
    fulfilment: "ship",
    courier: null,
    courierName: null,
    trackingNumber: null,
    statusTimes: null,
    deliveryCity: null,
    deliveryPincode: null,
    packedPhotos: [],
    items: [{ name: "Silk Kurti", productId: "BC25001", size: "M", color: "Red", qty: 1, status: "ordered", imageUrl: null }],
    totals: { subtotal: 1000, promoDiscount: 0, shipping: 80, voucherApplied: 0, creditApplied: 0, gatewayAmount: 1080 },
    trackingUrl: "https://shiprocket.co/tracking/AWB1",
    leftoverVoucher: { code: "LEFT123", value: 250 },
  });
  assertEquals(deps.cashfree.getOrderCalls, 0, "only pending orders are reconciled");
});

Deno.test("order-status: store pickup order reports fulfilment and no tracking link", async () => {
  const { deps } = await setup({ status: "ready_for_pickup", fulfilment: "pickup", shipping: 0, gateway_amount: 1000 });
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).json();
  assertEquals([j.status, j.fulfilment, j.trackingUrl, j.totals.shipping], ["ready_for_pickup", "pickup", null, 0]);
});

Deno.test("order-status: Porter order → its manual link (or none), never a Shiprocket one", async () => {
  const porter = { status: "shipped", courier: "porter" as const, courier_name: "Porter" };
  const a = await setup({ ...porter, manual_tracking_url: "https://porter.in/track/abc" });
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), a.deps)).json();
  assertEquals([j.courier, j.trackingUrl], ["porter", "https://porter.in/track/abc"]);
  const self = await setup({ status: "processed", courier: "self" as const, courier_name: "Bindal's Creation" });
  const s = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), self.deps)).json();
  assertEquals([s.status, s.courier, s.trackingUrl], ["processed", "self", null]);
  const b = await setup(porter);
  const k = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), b.deps)).json();
  assertEquals([k.courier, k.trackingUrl], ["porter", null]);
});

Deno.test("order-status: a manual delivery shows the carrier and tracking number staff typed", async () => {
  const { deps } = await setup({
    status: "shipped",
    courier: "self",
    courier_name: "India Post",
    manual_tracking_number: "EE123456789IN",
  });
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).json();
  assertEquals([j.courier, j.courierName, j.trackingNumber, j.trackingUrl], ["self", "India Post", "EE123456789IN", null]);
});

Deno.test("order-status: tracking details come from the shared SQL helper, keyed by line", async () => {
  const { deps, store, o } = await setup({ status: "shipped", courier_name: "Amazon Shipping Surface 1kg" });
  store.items.set(o.id, [item(), item({ id: "i-2", line_no: 2, product_name: "No Photo Kurti" })]);
  store.impls._order_tracking_json = (a) => {
    assertEquals(a, { p_order_id: o.id });
    return {
      status_times: { paid: "2026-11-01T17:03:00+00:00" },
      delivery_city: "Ghaziabad",
      delivery_pincode: "201001",
      item_images: { "1": "https://img.test/kurti.webp" },
    };
  };
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).json();
  assertEquals(j.courierName, "Amazon Shipping Surface 1kg");
  assertEquals(j.statusTimes, { paid: "2026-11-01T17:03:00+00:00" });
  assertEquals([j.deliveryCity, j.deliveryPincode], ["Ghaziabad", "201001"]);
  assertEquals(j.items.map((i: { imageUrl: string | null }) => i.imageUrl), ["https://img.test/kurti.webp", null]);
});

Deno.test("order-status: never returns the address beyond city and pincode", async () => {
  const address = { name: "Secret Receiver", line1: "12 Hidden Street", landmark: "Quiet Temple", city: "Ghaziabad", pincode: "201001" };
  const { deps } = await setup({ status: "shipped", address });
  const text = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).text();
  for (const secret of ["Secret Receiver", "Hidden Street", "Quiet Temple"]) assertEquals(text.includes(secret), false, secret);
});

Deno.test("order-status: helper failure still returns the order, without the extras", async () => {
  const { deps, store } = await setup({ status: "paid" });
  store.impls._order_tracking_json = () => {
    throw new Error("function not found");
  };
  const res = await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals([j.status, j.statusTimes, j.deliveryCity, j.items[0].imageUrl], ["paid", null, null, null]);
});

Deno.test("order-status: unknown ref, wrong token, no credentials, other user's JWT → identical 404", async () => {
  const { deps } = await setup({ auth_user_id: "someone-else" });
  const bodies: string[] = [];
  for (
    const [b, h] of [
      [{ orderRef: "WEB-999999", accessToken: TOKEN }, {}],
      [{ orderRef: "WEB-000001", accessToken: "wrong" }, {}],
      [{ orderRef: "WEB-000001" }, {}],
      [{ orderRef: "WEB-000001" }, { authorization: "Bearer user.jwt" }],
      [{ orderRef: "nonsense", accessToken: TOKEN }, {}],
    ] as const
  ) {
    const res = await handler(post(URL_, b, h), deps);
    assertEquals(res.status, 404);
    bodies.push(await res.text());
  }
  assertEquals(new Set(bodies).size, 1);
});

Deno.test("order-status: owner's JWT without a token works", async () => {
  const { deps } = await setup({ auth_user_id: USER, status: "paid" });
  const res = await handler(post(URL_, { orderRef: "WEB-000001" }, { authorization: "Bearer user.jwt" }), deps);
  assertEquals([res.status, (await res.json()).status], [200, "paid"]);
});

Deno.test("order-status: pending + Cashfree PAID → confirmed via the shared path", async () => {
  const { deps, store, o } = await setup();
  deps.cashfree.pay(o);
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).json();
  assertEquals(j.status, "paid");
  assertEquals(store.callsTo("online_order_confirm_payment").length, 1);
  assertEquals(deps.kicks.n, 1);
});

Deno.test("order-status: pending + Cashfree ACTIVE stays pending; Cashfree outage doesn't break the poll", async () => {
  const { deps } = await setup();
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).json();
  assertEquals(j.status, "pending_payment");
  deps.cashfree.getOrder = () => Promise.reject(new Error("down"));
  const res = await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps);
  assertEquals([res.status, (await res.json()).status], [200, "pending_payment"]);
});

Deno.test("order-status: rate limited per IP after repeated failures (still 404)", async () => {
  const { deps } = await setup();
  for (let i = 0; i < STATUS_FAILURE_LIMIT; i++) {
    await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: "bad" }), deps)).body?.cancel();
  }
  const res = await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps);
  assertEquals(res.status, 404, "even the right token is refused while limited");
  await res.body?.cancel();
});

Deno.test("order-status: packed photos come back as signed links, and a failure costs only the photos", async () => {
  const { deps, store } = await setup({ status: "packed" });
  store.impls.online_order_packed_photo_paths = () => ["o/packed/a.jpg"];
  const ok = await (await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps)).json();
  assertEquals(ok.packedPhotos, ["https://storage.test/view/o/packed/a.jpg?ttl=3600"]);
  store.impls.online_order_packed_photo_paths = () => {
    throw new Error("db down");
  };
  const res = await handler(post(URL_, { orderRef: "WEB-000001", accessToken: TOKEN }), deps);
  assertEquals([res.status, (await res.json()).packedPhotos], [200, []]);
});
