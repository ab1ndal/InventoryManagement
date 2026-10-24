// refund_notify jobs (Refunds slice, plan Task 10 / spec §8).
//   refund_notify:<refund id>            enqueued when the refund is created
//   refund_notify:<refund id>:completed  enqueued by trigger when a refund that had a
//                                        choice completes (migration_online_orders_refunds.sql)
// First notice: awaiting choice → choice link email; credit-only (no gateway part,
// completed at creation) → "added as store credit / voucher code" email; a choice
// already made by the time the job runs → nothing (the :completed job covers it).
// No shopper email → no-op success. Idempotent except for the email itself, which
// run-jobs retries only when the send throws.
import type { JobContext, Mailer, OrderJob } from "./types.ts";
import { type RefundDb, supabaseRefundDb } from "../refunds.ts";
import { refundChoiceEmail, refundCompletedEmail } from "../refundEmails.ts";

export type NotifyDeps = { db: Pick<RefundDb, "notice">; mailer: Mailer; siteUrl: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseKind(kind: string): { refundId: string; completed: boolean } {
  const [base, refundId, phase, ...rest] = kind.split(":");
  if (
    base !== "refund_notify" || !refundId || !UUID_RE.test(refundId) || rest.length > 0 ||
    (phase && phase !== "completed")
  ) {
    throw new Error(`refund_notify: bad job kind ${JSON.stringify(kind)}`);
  }
  return { refundId, completed: phase === "completed" };
}

/** A mailer without credentials resolves {sent:false}; throw so run-jobs retries it. */
async function send(mailer: Mailer, to: string, mail: { subject: string; text: string }): Promise<void> {
  const res = await mailer.send({ to, ...mail });
  if (res && typeof res === "object" && (res as { sent?: unknown }).sent === false) {
    throw new Error(`refund_notify: mail not sent (${(res as { reason?: unknown }).reason ?? "unknown"})`);
  }
}

export type NotifyResult = "sent_choice" | "sent_completed" | "no_email" | "nothing_to_send";

export async function notify(deps: NotifyDeps, job: OrderJob): Promise<NotifyResult> {
  const { refundId, completed } = parseKind(job.kind);
  const n = await deps.db.notice(refundId);
  if (!n) throw new Error(`refund_notify: refund ${refundId} not found`);
  if (!n.email) return "no_email";

  if (completed || (n.status === "completed" && n.choice === null)) {
    if (n.status !== "completed") return "nothing_to_send";
    await send(deps.mailer, n.email, refundCompletedEmail(n, deps.siteUrl));
    return "sent_completed";
  }
  if (n.status === "awaiting_choice" && n.choice === null && n.token) {
    await send(deps.mailer, n.email, refundChoiceEmail(n, deps.siteUrl));
    return "sent_choice";
  }
  return "nothing_to_send";
}

export async function handle(ctx: JobContext, job: OrderJob): Promise<void> {
  const result = await notify({ db: supabaseRefundDb(ctx.db), mailer: ctx.mailer, siteUrl: ctx.env.siteUrl }, job);
  console.log(JSON.stringify({ event: "refund_notify", jobId: job.id, kind: job.kind, result }));
}
