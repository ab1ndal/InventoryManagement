/**
 * POST refund-sweeper (scheduled; deploy with --no-verify-jwt). Auth: header
 * `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <service role key>`.
 * Each run, in order:
 *   1. online_refund_default_expired(): refunds with no choice after 48 h → original;
 *      their gateway legs are sent to Cashfree.
 *   2. Gateway legs chosen > 10 min ago but never sent (a refund-choice request
 *      that crashed or hit a Cashfree timeout) are sent. refund_id = leg id, so
 *      a repeat never pays twice.
 *   3. Sent legs still processing after 1 h are polled with getRefund.
 * "Refund completed" emails are not sent here: when a leg completes, the DB
 * trigger enqueues refund_notify:<id>:completed for run-jobs.
 */

import { json, serviceClient } from "../_shared/http.ts";
import { type CashfreeClient, constantTimeEqual } from "../_shared/cashfree.ts";
import {
  cashfreeFromEnv,
  type GatewayLeg,
  jsonLog,
  type LegOutcome,
  type Log,
  pollGatewayLegs,
  type RefundDb,
  submitGatewayLegs,
  supabaseRefundDb,
} from "../_shared/refunds.ts";

export type Deps = {
  db: RefundDb;
  cashfree: CashfreeClient | null;
  cronSecret: string;
  serviceKey: string;
  log: Log;
};

const enc = new TextEncoder();
const same = (a: string, b: string) => b.length > 0 && constantTimeEqual(enc.encode(a), enc.encode(b));

export function authorized(req: Request, cronSecret: string, serviceKey: string): boolean {
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null && same(cron, cronSecret)) return true;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m !== null && same(m[1], serviceKey);
}

const count = (o: LegOutcome[], r: LegOutcome["result"]) => o.filter((x) => x.result === r).length;

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method not allowed", code: "method_not_allowed" });
  if (!authorized(req, deps.cronSecret, deps.serviceKey)) {
    return json(401, { error: "unauthorized", code: "unauthorized" });
  }
  try {
    const defaulted = await deps.db.defaultExpired();
    if (defaulted.length) deps.log("refund_defaulted", { refundIds: defaulted });
    if (!deps.cashfree) {
      deps.log("refund_cashfree_not_configured", { defaulted: defaulted.length });
      return json(503, {
        error: "Cashfree is not configured",
        code: "cashfree_not_configured",
        defaulted: defaulted.length,
      });
    }
    const ctx = { db: deps.db, cashfree: deps.cashfree, log: deps.log };

    const toSubmit: GatewayLeg[] = [];
    for (const id of defaulted) toSubmit.push(...await deps.db.openLegs(id));
    const due = await deps.db.legsDue();
    const ids = new Set(toSubmit.map((l) => l.legId));
    for (const l of due) {
      if (l.action === "submit" && !ids.has(l.legId)) toSubmit.push(l);
    }
    const submitted = await submitGatewayLegs(ctx, toSubmit);
    const polled = await pollGatewayLegs(ctx, due.filter((l) => l.action === "poll"));

    const all = [...submitted, ...polled];
    const summary = {
      defaulted: defaulted.length,
      submitted: submitted.length,
      polled: polled.length,
      completed: count(all, "completed"),
      failed: count(all, "failed"),
      errors: all.filter((o) => o.error).length,
    };
    deps.log("refund_sweep", summary);
    return json(200, summary);
  } catch (err) {
    deps.log("refund_sweep_error", { error: err instanceof Error ? err.message : String(err) });
    return json(500, { error: "sweep failed", code: "internal" });
  }
}

if (import.meta.main) {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!cronSecret && !serviceKey) throw new Error("CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY not set");
  const deps: Deps = {
    db: supabaseRefundDb(serviceClient()),
    cashfree: cashfreeFromEnv(),
    cronSecret,
    serviceKey,
    log: jsonLog,
  };
  Deno.serve((req) => handler(req, deps));
}
