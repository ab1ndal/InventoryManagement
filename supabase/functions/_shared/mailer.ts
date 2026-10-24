/**
 * Gmail SMTP mailer (notes §9–11): smtp.gmail.com:465 with implicit TLS.
 * Supabase Edge blocks 25 and 587, so 465 + `secure: true` is hard-coded
 * (Supabase's own example derives `secure` from an env string, which turns
 * "false" into true; we don't read it from env at all).
 *
 * Missing credentials are not an error: send() resolves
 * { sent: false, reason: 'not_configured' } and logs a warning that names
 * only which setting is missing, never its value.
 *
 * UNVERIFIED: npm:nodemailer@^9 on the current Supabase runtime (Supabase's
 * example uses it; do one sandbox send before relying on it). It is loaded
 * lazily so tests with an injected transport never touch it.
 */

export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GMAIL_SMTP_PORT = 465;

export type MailMessage = { to: string; subject: string; text: string; html?: string };
export type SendResult = { sent: true; messageId: string | null } | { sent: false; reason: "not_configured" };

/** The subset of a nodemailer transport we use. */
export type MailTransport = {
  sendMail(msg: { from: string; to: string; subject: string; text: string; html?: string }): Promise<
    { messageId?: string }
  >;
};

export type Mailer = { send(msg: MailMessage): Promise<SendResult> };

export type Logger = { warn(line: string): void };

export function gmailTransportOptions(user: string, appPassword: string) {
  return {
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    secure: true,
    auth: { user, pass: appPassword },
  };
}

async function nodemailerTransport(user: string, appPassword: string): Promise<MailTransport> {
  const nodemailer = await import("nodemailer");
  const createTransport = (nodemailer.default ?? nodemailer).createTransport as (
    opts: ReturnType<typeof gmailTransportOptions>,
  ) => MailTransport;
  return createTransport(gmailTransportOptions(user, appPassword));
}

export function createMailer(config: {
  user: string | undefined;
  appPassword: string | undefined;
  transport?: MailTransport;
  logger?: Logger;
}): Mailer {
  const logger = config.logger ?? console;
  const user = config.user?.trim() ?? "";
  const pass = config.appPassword?.trim() ?? "";
  let transport: Promise<MailTransport> | null = config.transport ? Promise.resolve(config.transport) : null;

  return {
    async send(msg) {
      if (!user || !pass) {
        const missing = [!user && "GMAIL_USER", !pass && "GMAIL_APP_PASSWORD"].filter(Boolean);
        logger.warn(JSON.stringify({ event: "mail_not_configured", missing, subject: msg.subject }));
        return { sent: false, reason: "not_configured" };
      }
      if (!msg.to.trim()) throw new RangeError("mail recipient is empty");
      transport ??= nodemailerTransport(user, pass).catch((err) => {
        transport = null; // a failed import must not poison later sends
        throw err;
      });
      const info = await (await transport).sendMail({
        from: user,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      return { sent: true, messageId: info.messageId ?? null };
    },
  };
}
