import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { delivered, type EmailOrder, orderConfirmed, shipped, shopNewOrder } from "./emails.ts";

const SITE = "https://www.bindalscreations.com";
const o: EmailOrder = {
  orderRef: "WEB-000042",
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
  courierName: null,
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

Deno.test("shipped: AWB and tracking link; delivered", () => {
  const m = shipped({ ...o, awb: "AWB123", courierName: "Delhivery" }, SITE);
  assertEquals(m.subject, "Order WEB-000042 has shipped");
  assertStringIncludes(m.text, "with Delhivery");
  assertStringIncludes(m.text, "AWB): AWB123");
  assertStringIncludes(m.text, "https://shiprocket.co/tracking/AWB123");
  assertEquals(delivered(o, SITE).subject, "Order WEB-000042 delivered");
});
