import { assertEquals } from "@std/assert";
import { handler } from "./handler.ts";
import { STATUS_FAILURE_LIMIT } from "../order-status/handler.ts";
import { FakeStore, order, post, testDeps } from "../_shared/pay_testing.ts";

const URL_ = "https://fn.test/order-packed-photos";
const PHONE = "9812345678";

function setup(paths: string[] = ["o/packed/a.jpg"]) {
  const store = new FakeStore();
  const o = order({ status: "shipped" });
  store.orders.push(o);
  store.impls.online_order_phone_ok = (a) => a.p_order_ref === o.order_ref && a.p_phone === PHONE;
  store.impls.online_order_packed_photo_paths = () => paths;
  return { store, deps: testDeps({ store }) };
}

Deno.test("order-packed-photos: right phone → signed links only", async () => {
  const { deps } = setup();
  const res = await handler(post(URL_, { orderRef: "web-000001", phone: PHONE }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { photos: ["https://storage.test/view/o/packed/a.jpg?ttl=3600"] });
});

Deno.test("order-packed-photos: a file gone from Storage is left out", async () => {
  const { deps } = setup(["gone/a.jpg", "o/packed/b.jpg"]);
  const j = await (await handler(post(URL_, { orderRef: "WEB-000001", phone: PHONE }), deps)).json();
  assertEquals(j.photos, ["https://storage.test/view/o/packed/b.jpg?ttl=3600"]);
});

Deno.test("order-packed-photos: wrong phone, bad ref and blank phone all → the same 404", async () => {
  const { deps } = setup();
  for (const body of [{ orderRef: "WEB-000001", phone: "9000000000" }, { orderRef: "nope", phone: PHONE }, { orderRef: "WEB-000001" }]) {
    const res = await handler(post(URL_, body), deps);
    assertEquals(res.status, 404);
    assertEquals((await res.json()).code, "not_found");
  }
});

Deno.test("order-packed-photos: failures hit the shared limit, then the right phone also gets 404", async () => {
  const { deps } = setup();
  for (let i = 0; i < STATUS_FAILURE_LIMIT; i++) {
    await handler(post(URL_, { orderRef: "WEB-000001", phone: "9000000000" }), deps);
  }
  assertEquals((await handler(post(URL_, { orderRef: "WEB-000001", phone: PHONE }), deps)).status, 404);
});
