import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { notify, parseKind } from "./refund_notify.ts";
import type { OrderJob } from "./types.ts";
import { FakeClock, FakeRefundDb } from "../refunds_testing.ts";

const SITE = "https://www.bindalscreations.com";

function setup() {
  const db = new FakeRefundDb(new FakeClock());
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer = {
    send: (m: { to: string; subject: string; text: string }) => {
      sent.push(m);
      return Promise.resolve({ sent: true, messageId: "m1" });
    },
  };
  return { db, sent, deps: { db, mailer, siteUrl: SITE } };
}

const job = (kind: string): OrderJob => ({ id: "j1", order_id: "o1", kind, attempts: 1 });

Deno.test("awaiting choice: emails the choice link with token, items, amount, 48 h default and similar pieces", async () => {
  const { db, sent, deps } = setup();
  const r = db.add({ gateway: 1499.5, credit: 300, isGuest: true });
  r.legs[0].voucher = { code: "ABCDEFGHJKLMNPQR", value: 300, expiry: "2027-10-23" };
  r.legs[0].destination = "voucher";
  assertEquals(await notify(deps, job(`refund_notify:${r.id}`)), "sent_choice");
  assertEquals(sent.length, 1);
  const m = sent[0];
  assertEquals(m.to, "shopper@example.com");
  assertStringIncludes(m.subject, r.orderRef);
  assertStringIncludes(m.text, `${SITE}/refund-choice/${r.token}`);
  assertStringIncludes(m.text, "Test Kurti (M, Red) × 1");
  assertStringIncludes(m.text, "₹1,799.50");
  assertStringIncludes(m.text, "remaining ₹1,499.50");
  assertStringIncludes(m.text, "48 hours");
  assertStringIncludes(m.text, "original payment method automatically");
  assertStringIncludes(m.text, "ABCDEFGHJKLMNPQR", "credit part already returned as voucher");
  assertStringIncludes(m.text, `${SITE}/shop?category=Kurti`);
});

Deno.test("no shopper email → no-op success", async () => {
  const { db, sent, deps } = setup();
  const r = db.add({ gateway: 1000, email: null });
  assertEquals(await notify(deps, job(`refund_notify:${r.id}`)), "no_email");
  assertEquals(sent.length, 0);
});

Deno.test("credit-only refund (completed at creation): store credit email, no link", async () => {
  const { db, sent, deps } = setup();
  const r = db.add({ gateway: 0, credit: 1099, isGuest: false });
  assertEquals(r.status, "completed");
  assertEquals(await notify(deps, job(`refund_notify:${r.id}`)), "sent_completed");
  assertStringIncludes(sent[0].text, "₹1,099 has been added to your store credit.");
  assert(!sent[0].text.includes("/refund-choice/"));
});

Deno.test("credit-only guest refund: voucher code email", async () => {
  const { db, sent, deps } = setup();
  const r = db.add({ gateway: 0, credit: 500, isGuest: true });
  Object.assign(r.legs[0], {
    destination: "voucher",
    voucher: { code: "ZZZZYYYYXXXXWWWW", value: 500, expiry: "2027-10-23" },
  });
  await notify(deps, job(`refund_notify:${r.id}`));
  assertStringIncludes(sent[0].text, "₹500 voucher code: ZZZZYYYYXXXXWWWW (valid until 23 Oct 2027");
});

Deno.test(":completed job: refund-completed email with the original-method amount", async () => {
  const { db, sent, deps } = setup();
  const r = db.add({ gateway: 1000 });
  await db.choose(r.token!, "original");
  assertEquals(await notify(deps, job(`refund_notify:${r.id}:completed`)), "nothing_to_send", "not completed yet");
  await db.setLegStatus(r.legs[0].id, "completed", "cf1", "SUCCESS");
  assertEquals(await notify(deps, job(`refund_notify:${r.id}:completed`)), "sent_completed");
  assertStringIncludes(sent[0].subject, "Refund completed");
  assertStringIncludes(sent[0].text, "₹1,000 has been refunded to your original payment method");
});

Deno.test("first notice after a choice was already made sends nothing", async () => {
  const { db, sent, deps } = setup();
  const r = db.add({ gateway: 1000 });
  await db.choose(r.token!, "store_credit");
  assertEquals(await notify(deps, job(`refund_notify:${r.id}`)), "nothing_to_send");
  assertEquals(sent.length, 0);
});

Deno.test("unknown refund and unsent mail throw so run-jobs retries", async () => {
  const { db, deps } = setup();
  await assertRejects(() => notify(deps, job(`refund_notify:${crypto.randomUUID()}`)), Error, "not found");
  const r = db.add({ gateway: 1000 });
  const off = { ...deps, mailer: { send: () => Promise.resolve({ sent: false, reason: "not_configured" }) } };
  await assertRejects(() => notify(off, job(`refund_notify:${r.id}`)), Error, "not_configured");
});

Deno.test("parseKind accepts only refund_notify:<uuid>[:completed]", () => {
  const id = crypto.randomUUID();
  assertEquals(parseKind(`refund_notify:${id}`), { refundId: id, completed: false });
  assertEquals(parseKind(`refund_notify:${id}:completed`), { refundId: id, completed: true });
  for (const bad of ["refund_notify", `refund_notify:${id}:x`, "refund_notify:nope", `email_shop:${id}`]) {
    let threw = false;
    try {
      parseKind(bad);
    } catch {
      threw = true;
    }
    assert(threw, bad);
  }
});
