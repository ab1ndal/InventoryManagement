import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  delivered,
  type EmailOrder,
  orderConfirmed,
  readyForPickup,
  SHOP_ADDRESS,
  shipped,
  shopNewOrder,
} from "./emails.ts";

const SITE = "https://www.bindalscreations.com";
const o: EmailOrder = {
  orderRef: "WEB-000042",
  fulfilment: "ship",
  contactName: "Asha Gupta",
  contactPhone: "+919876543210",
  contactEmail: "asha@example.com",
  address: { line1: "1 MG Road", city: "Ghaziabad", state: "Uttar Pradesh", pincode: "201001" },
  items: [
    { name: "Silk Kurti", size: "M", color: "Red", qty: 2, status: "ordered" },
    { name: "Lehenga", size: "L", color: null, qty: 1, status: "unavailable" },
  ],
  subtotal: 4500,
  promoDiscount: 450,
  shipping: 80,
  voucherApplied: 0,
  creditApplied: 500,
  gatewayAmount: 3630,
  awb: null,
  courier: null,
  courierName: null,
  trackingNumber: null,
  leftoverVoucher: null,
};

Deno.test("orderConfirmed: items, order total, ref, link, same wording in every state", () => {
  const m = orderConfirmed(o, SITE);
  assertEquals(m.subject, "Bindals Creation: order WEB-000042 confirmed");
  assertStringIncludes(m.text, "Hi Asha,");
  assertStringIncludes(m.text, "- Silk Kurti (M, Red) x 2");
  assertStringIncludes(m.text, "- Lehenga (L) x 1 (out of stock");
  assertStringIncludes(m.text, "Order total: ₹4,130 (₹3,630 paid online)");
  assertStringIncludes(m.text, "Store credit: -₹500");
  assertStringIncludes(m.text, "We'll email you again when your parcel ships.");
  assert(!m.text.includes("confirm delivery"), "no doubt about delivery inside UP");
  assert(!m.text.includes("We deliver within"), "the email names no delivery area");
  const out = orderConfirmed({ ...o, address: { ...o.address, state: "Maharashtra", pincode: "400001" } }, SITE);
  assertStringIncludes(out.text, "We'll email you again when your parcel ships.");
  assert(!out.text.includes("confirm delivery"), "owner 2026-11-05: no delivery doubt outside UP");
  assert(!out.text.includes("Uttar Pradesh"), "no UP promise outside UP");
  assertStringIncludes(m.text, `${SITE}/track?order=WEB-000042`);
  assert(!m.text.includes("/order/"), "no tokenless order-page link");
  assert(!/GST/i.test(m.text), "composition dealer: no GST");
  const v = orderConfirmed({ ...o, leftoverVoucher: { code: "ABCD2345EFGH6789", value: 1250 } }, SITE);
  assertStringIncludes(v.text, "₹1,250 left over. Use this new code next time: ABCD2345EFGH6789");
});

Deno.test("shopNewOrder: contact, address and the admin link", () => {
  const m = shopNewOrder(o, SITE);
  assertEquals(m.subject, "New online order WEB-000042");
  assertStringIncludes(m.text, "Asha Gupta, +919876543210, asha@example.com");
  assertStringIncludes(m.text, "Ghaziabad, Uttar Pradesh, 201001");
  assertStringIncludes(m.text, `${SITE}/admin/online-orders`);
});

Deno.test("shopNewOrder: landmark line when present", () => {
  const m = shopNewOrder({ ...o, address: { ...o.address, line2: "Sector 5", landmark: "Near Durga Bhabhi Chowk" } }, SITE);
  assertStringIncludes(m.text, "  1 MG Road\n  Sector 5\n  Landmark: Near Durga Bhabhi Chowk\n  Ghaziabad, Uttar Pradesh, 201001");
  assertEquals(shopNewOrder(o, SITE).text.includes("Landmark"), false);
});

Deno.test("shipped: AWB and tracking link; delivered", () => {
  const m = shipped({ ...o, awb: "AWB123", courierName: "Delhivery" }, SITE);
  assertEquals(m.subject, "Bindals Creation: order WEB-000042 has shipped");
  assertStringIncludes(m.text, "with Delhivery");
  assertStringIncludes(m.text, "AWB): AWB123");
  assertStringIncludes(m.text, "https://shiprocket.co/tracking/AWB123");
  assertStringIncludes(m.text, `${SITE}/track?order=WEB-000042`);
  assert(!m.text.includes("/order/"), "no tokenless order-page link");
  assertEquals(delivered(o, SITE).subject, "Bindals Creation: order WEB-000042 delivered");
});

Deno.test("shipped: Porter is picked up for delivery, follows on /track; Shiprocket without an AWB throws", () => {
  const m = shipped({ ...o, courier: "porter", courierName: "Porter" }, SITE);
  assertEquals(m.subject, "Bindals Creation: order WEB-000042 has been picked up for delivery");
  assertStringIncludes(m.text, "Your order WEB-000042 is on its way with Porter.");
  assertStringIncludes(m.text, `Follow it at ${SITE}/track with your order number and phone number.`);
  assert(!/AWB|WhatsApp|Track it here/.test(m.text), "no link, no WhatsApp");
  assertThrows(() => shipped(o, SITE), Error, "no AWB");
  assertThrows(() => shipped({ ...o, courier: "shiprocket" }, SITE), Error, "no AWB");
});

Deno.test("shipped: self delivery names no courier", () => {
  const m = shipped({ ...o, courier: "self", courierName: "Bindal's Creation" }, SITE);
  assertEquals(m.subject, "Bindals Creation: order WEB-000042 has been picked up for delivery");
  assertStringIncludes(m.text, "Your order WEB-000042 is on its way.");
  assertEquals(m.text.includes("Bindal's Creation"), false);
  assertStringIncludes(m.text, `${SITE}/track`);
});

Deno.test("shipped: a manual delivery names the carrier staff typed and its tracking number", () => {
  const m = shipped({ ...o, courier: "self", courierName: "India Post", trackingNumber: "EE123456789IN" }, SITE);
  assertStringIncludes(m.text, "Your order WEB-000042 is on its way with India Post.");
  assertStringIncludes(m.text, "Tracking number: EE123456789IN\nFollow it at");
  assert(!/AWB|Track it here|shiprocket/.test(m.text), "a manual number is not a Shiprocket AWB");
  const porter = shipped({ ...o, courier: "porter", courierName: "Porter", trackingNumber: null }, SITE);
  assertEquals(porter.text.includes("Tracking number"), false);
});

const pickup: EmailOrder = { ...o, fulfilment: "pickup", shipping: 0, address: { name: "Asha Gupta", phone: "+919876543210" } };

Deno.test("store pickup: confirmed says we'll tell them when it's ready, not delivery", () => {
  const m = orderConfirmed(pickup, SITE);
  assertStringIncludes(m.text, `You chose store pickup at ${SHOP_ADDRESS}.`);
  assertStringIncludes(m.text, "We'll email you when your order is ready to collect");
  assertStringIncludes(m.text, "Shipping: Free (store pickup)");
  assert(!/deliver|parcel|ships/i.test(m.text), "no delivery wording");
});

Deno.test("store pickup: shop alert says Store pickup and to mark it ready", () => {
  const m = shopNewOrder(pickup, SITE);
  assertEquals(m.subject, "New online order WEB-000042 (store pickup)");
  assertStringIncludes(m.text, "  Store pickup");
  assertStringIncludes(m.text, `Check the shelf and mark it ready for pickup: ${SITE}/admin/online-orders`);
});

Deno.test("store pickup: ready email has the shop address and the order number; collected wording", () => {
  const m = readyForPickup(pickup, SITE);
  assertEquals(m.subject, "Bindals Creation: order WEB-000042 is ready for pickup");
  assertStringIncludes(m.text, "58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001");
  assertStringIncludes(m.text, "Please bring your order number (WEB-000042)");
  assertStringIncludes(m.text, "WhatsApp us");
  assertStringIncludes(m.text, `${SITE}/track?order=WEB-000042`);
  assert(!m.text.includes("/order/"), "no tokenless order-page link");
  const d = delivered(pickup, SITE);
  assertEquals(d.subject, "Bindals Creation: order WEB-000042 collected");
  assertStringIncludes(d.text, "You've collected your order WEB-000042.");
});

Deno.test("customer emails say who is writing and why; the shop's own alert does not", () => {
  const shippedOrder = { ...o, awb: "AWB123" };
  for (const m of [orderConfirmed(o, SITE), shipped(shippedOrder, SITE), readyForPickup(pickup, SITE), delivered(o, SITE)]) {
    assert(m.subject.startsWith("Bindals Creation: order WEB-000042"), m.subject);
    assertStringIncludes(m.text, `- Bindals Creation\n${SHOP_ADDRESS}\nwww.bindalscreations.com`);
    assertStringIncludes(m.text, "You're getting this email because you placed an order at bindalscreations.com.");
  }
  assertEquals(shopNewOrder(o, SITE).text.includes("You're getting this email"), false);
});

Deno.test("orderConfirmed: opens by naming the shop and its town", () => {
  assertStringIncludes(
    orderConfirmed(o, SITE).text,
    "Thank you for your order from Bindals Creation, our shop in Ghaziabad. We've received order WEB-000042.",
  );
});
