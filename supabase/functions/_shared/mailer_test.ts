import { assert, assertEquals, assertRejects } from "@std/assert";
import { createMailer, gmailTransportOptions, type MailTransport } from "./mailer.ts";

function fakeTransport() {
  const sent: Parameters<MailTransport["sendMail"]>[0][] = [];
  const transport: MailTransport = {
    sendMail: (msg) => {
      sent.push(msg);
      return Promise.resolve({ messageId: `<m${sent.length}@test>` });
    },
  };
  return { transport, sent };
}

function captureLogger() {
  const lines: string[] = [];
  return { logger: { warn: (l: string) => lines.push(l) }, lines };
}

const msg = { to: "asha@example.com", subject: "Order WEB-000001 confirmed", text: "Thanks", html: "<p>Thanks</p>" };

Deno.test("Gmail transport options: smtp.gmail.com:465, secure hard-coded true", () => {
  assertEquals(gmailTransportOptions("shop@gmail.com", "app-pw"), {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: "shop@gmail.com", pass: "app-pw" },
  });
});

Deno.test("send: uses the transport, from = GMAIL_USER", async () => {
  const t = fakeTransport();
  const m = createMailer({ user: "shop@gmail.com", appPassword: "app-pw", transport: t.transport });
  assertEquals(await m.send(msg), { sent: true, messageId: "<m1@test>" });
  assertEquals(t.sent, [{ from: "shop@gmail.com", ...msg }]);
});

Deno.test("missing password → not_configured, no send, warning without secrets", async () => {
  const t = fakeTransport();
  const log = captureLogger();
  const m = createMailer({ user: "shop@gmail.com", appPassword: undefined, transport: t.transport, logger: log.logger });
  assertEquals(await m.send(msg), { sent: false, reason: "not_configured" });
  assertEquals(t.sent.length, 0);
  assertEquals(log.lines.length, 1);
  const line = JSON.parse(log.lines[0]);
  assertEquals(line.event, "mail_not_configured");
  assertEquals(line.missing, ["GMAIL_APP_PASSWORD"]);
  assert(!log.lines[0].includes("shop@gmail.com"));
});

Deno.test("missing user and password → not_configured; password value never logged", async () => {
  const t = fakeTransport();
  const log = captureLogger();
  const m = createMailer({ user: "", appPassword: "super-secret-pw", transport: t.transport, logger: log.logger });
  assertEquals(await m.send(msg), { sent: false, reason: "not_configured" });
  assertEquals(JSON.parse(log.lines[0]).missing, ["GMAIL_USER"]);
  assert(!log.lines[0].includes("super-secret-pw"));
  assertEquals(t.sent.length, 0);
});

Deno.test("transport failure propagates; empty recipient refused", async () => {
  const failing: MailTransport = { sendMail: () => Promise.reject(new Error("535 auth failed")) };
  const m = createMailer({ user: "shop@gmail.com", appPassword: "pw", transport: failing });
  await assertRejects(() => m.send(msg), Error, "535");
  await assertRejects(() => m.send({ ...msg, to: " " }), RangeError);
});
