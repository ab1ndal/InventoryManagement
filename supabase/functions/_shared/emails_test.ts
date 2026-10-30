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
  manualTrackingUrl: null,
  leftoverVoucher: null,
};

Deno.test("orderConfirmed: items, total paid, ref, link and the UP line", () => {
  const m = orderConfirmed(o, SITE);
  assertEquals(m.subject, "Order WEB-000042 confirmed");
  assertStringIncludes(m.text, "Hi Asha,");
  assertStringIncludes(m.text, "- Silk Kurti (M, Red) x 2");
  assertStringIncludes(m.text, "- Lehenga (L) x 1 (out of stock");
  assertStringIncludes(m.text, "Total paid: ₹4,130 (₹3,630 paid online)");
  assertStringIncludes(m.text, "Store credit: -₹500");
  assertStringIncludes(m.text, "We deliver within Uttar Pradesh");
  const out = orderConfirmed({ ...o, address: { ...o.address, state: "Maharashtra", pincode: "400001" } }, SITE);
  assertStringIncludes(out.text, "We'll confirm delivery to your address on WhatsApp before dispatch.");
  assert(!out.text.includes("Uttar Pradesh"), "no UP promise outside UP");
  assertStringIncludes(m.text, `${SITE}/order/WEB-000042`);
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
  assertEquals(m.subject, "Order WEB-000042 has shipped");
  assertStringIncludes(m.text, "with Delhivery");
  assertStringIncludes(m.text, "AWB): AWB123");
  assertStringIncludes(m.text, "https://shiprocket.co/tracking/AWB123");
  assertEquals(delivered(o, SITE).subject, "Order WEB-000042 delivered");
});

Deno.test("shipped: Porter with a link, Porter without one, Shiprocket without an AWB throws", () => {
  const porter = { ...o, courier: "porter" as const, courierName: "Porter" };
  const m = shipped({ ...porter, manualTrackingUrl: "https://porter.in/track/abc" }, SITE);
  assertStringIncludes(m.text, "on its way with Porter");
  assertStringIncludes(m.text, "Track it here: https://porter.in/track/abc");
  const n = shipped(porter, SITE);
  assertStringIncludes(n.text, "We'll share the delivery details with you on WhatsApp.");
  assertEquals(n.text.includes("AWB"), false);
  assertThrows(() => shipped(o, SITE), Error, "no AWB");
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
  assertEquals(m.subject, "Order WEB-000042 is ready for pickup");
  assertStringIncludes(m.text, "58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001");
  assertStringIncludes(m.text, "Please bring your order number (WEB-000042)");
  assertStringIncludes(m.text, "WhatsApp us");
  assertStringIncludes(m.text, `${SITE}/order/WEB-000042`);
  const d = delivered(pickup, SITE);
  assertEquals(d.subject, "Order WEB-000042 collected");
  assertStringIncludes(d.text, "You've collected your order WEB-000042.");
});
