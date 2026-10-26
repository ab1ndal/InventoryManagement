import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { sendOrderEmail } from "./emails.ts";
import type { JobContext, OrderJob } from "./types.ts";
import { FakeStore, item, order } from "../pay_testing.ts";

function setup(over: Parameters<typeof order>[0] = {}, mailerResult: unknown = { sent: true, messageId: "m" }) {
  const store = new FakeStore();
  const o = order({ id: "o-1", ...over });
  store.orders.push(o);
  store.items.set("o-1", [item()]);
  const sent: { to: string; subject: string; text: string }[] = [];
  const ctx = {
    db: null,
    cashfree: null,
    shiprocket: null,
    mailer: {
      send: (m: { to: string; subject: string; text: string }) => (sent.push(m), Promise.resolve(mailerResult)),
    },
    env: { siteUrl: "https://www.bindalscreations.com", shopEmail: "shop@example.com" },
  } as unknown as JobContext;
  const job = (kind: string): OrderJob => ({ id: "j", order_id: "o-1", kind, attempts: 1 });
  return { store, ctx, sent, job };
}

Deno.test("email jobs: confirmed → shopper, shop alert → shop inbox", async () => {
  const { store, ctx, sent, job } = setup();
  await sendOrderEmail(ctx, store, job("email_confirmed"));
  await sendOrderEmail(ctx, store, job("email_shop"));
  assertEquals(sent.map((m) => [m.to, m.subject]), [
    ["asha@example.com", "Order WEB-000001 confirmed"],
    ["shop@example.com", "New online order WEB-000001"],
  ]);
});

Deno.test("email jobs: no shopper email → customer emails skipped (job succeeds), shop alert still sent", async () => {
  const { store, ctx, sent, job } = setup({ contact_email: null, awb: "AWB9" });
  for (const k of ["email_confirmed", "email_shipped", "email_delivered"]) await sendOrderEmail(ctx, store, job(k));
  assertEquals(sent, []);
  await sendOrderEmail(ctx, store, job("email_shop"));
  assertEquals(sent.length, 1);
});

Deno.test("email jobs: shipped carries the AWB; without an AWB it throws to retry", async () => {
  const a = setup({ awb: "AWB9", courier_name: "Delhivery" });
  await sendOrderEmail(a.ctx, a.store, a.job("email_shipped"));
  assertStringIncludes(a.sent[0].text, "https://shiprocket.co/tracking/AWB9");
  const b = setup();
  await assertRejects(() => sendOrderEmail(b.ctx, b.store, b.job("email_shipped")), Error, "no AWB");
});

Deno.test("email jobs: leftover voucher appears in the confirmation", async () => {
  const { store, ctx, sent, job } = setup({ leftover_voucher_id: "LEFTOVER12345678" });
  store.vouchers.set("LEFTOVER12345678", 400);
  await sendOrderEmail(ctx, store, job("email_confirmed"));
  assertStringIncludes(sent[0].text, "₹400 left over. Use this new code next time: LEFTOVER12345678");
});

Deno.test("email jobs: mailer not configured resolves (no retry storm); send errors and unknown kinds throw", async () => {
  const a = setup({}, { sent: false, reason: "not_configured" });
  await sendOrderEmail(a.ctx, a.store, a.job("email_confirmed"));
  const b = setup();
  (b.ctx.mailer as { send: unknown }).send = () => Promise.reject(new Error("smtp 535"));
  await assertRejects(() => sendOrderEmail(b.ctx, b.store, b.job("email_confirmed")), Error, "smtp 535");
  await assertRejects(() => sendOrderEmail(b.ctx, b.store, b.job("email_other")), Error, "unknown job kind");
  await assertRejects(() => sendOrderEmail(b.ctx, b.store, { ...b.job("email_shop"), order_id: "nope" }), Error, "not found");
});

Deno.test("email jobs: a rebooked order's second shipment (kind:attempt) still sends shipped / delivered", async () => {
  const { store, ctx, sent, job } = setup({ awb: "AWB2" });
  await sendOrderEmail(ctx, store, job("email_shipped:2"));
  await sendOrderEmail(ctx, store, job("email_delivered:2"));
  assertEquals(sent.length, 2);
  assertStringIncludes(sent[0].text, "https://shiprocket.co/tracking/AWB2");
});
