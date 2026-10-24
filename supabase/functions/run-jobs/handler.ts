/**
 * POST run-jobs (plan R2, R5). Called by pg_cron (header x-cron-secret) and
 * by our own functions after a confirm (service-role bearer). No CORS.
 *
 * Modes (body `{ "mode": ... }` or `?mode=`):
 *   jobs (default) — online_jobs_claim → handlerFor(kind) → online_job_finish.
 *     A handler that throws, or a kind without a handler, finishes ok=false;
 *     the DB backs off and flags the order after 10 attempts.
 *   expire — R5: each pending order older than 45 min is checked with
 *     Cashfree: PAID → the confirm path; EXPIRED/TERMINATED or never created
 *     → online_order_fail(expired); still ACTIVE after 24 h → problem flag.
 */

import { json } from "../_shared/http.ts";
import { constantTimeEqual } from "../_shared/cashfree.ts";
import { type AppDeps, errorMessage, logEvent } from "../_shared/context.ts";
import { reconcilePayment } from "../_shared/confirm.ts";
import { handlerFor as defaultHandlerFor } from "../_shared/jobs/index.ts";
import type { JobContext, JobHandler, OrderJob } from "../_shared/jobs/types.ts";

export const CLAIM_LIMIT = 10;
export const ACTIVE_PROBLEM_AFTER_MS = 24 * 60 * 60 * 1000;

export type RunJobsDeps = AppDeps & {
  jobContext: JobContext;
  handlerFor?: (kind: string) => JobHandler | null;
};

const enc = new TextEncoder();
const same = (a: string, b: string) => a !== "" && b !== "" && constantTimeEqual(enc.encode(a), enc.encode(b));

export function authorized(req: Request, env: { cronSecret: string; serviceRoleKey: string }): boolean {
  const cron = req.headers.get("x-cron-secret") ?? "";
  if (env.cronSecret && same(cron, env.cronSecret)) return true;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return !!m && same(m[1], env.serviceRoleKey);
}

/** An order_jobs row as online_jobs_claim returns it. */
export type ClaimedJob = { id: string; order_id: string; kind: string; ref_id: string | null; attempts: number };

/** Handlers see `kind:ref_id` (e.g. refund_notify:<refund uuid>); handlerFor dispatches on the part before ':'. */
export function toOrderJob(row: ClaimedJob): OrderJob {
  return {
    id: row.id,
    order_id: row.order_id,
    kind: row.ref_id ? `${row.kind}:${row.ref_id}` : row.kind,
    attempts: row.attempts,
  };
}

export async function runJobs(deps: RunJobsDeps): Promise<{ claimed: number; ok: number; failed: number }> {
  const handlerFor = deps.handlerFor ?? defaultHandlerFor;
  const rows = (await deps.store.rpc<ClaimedJob[]>("online_jobs_claim", { p_limit: CLAIM_LIMIT, p_lease: "2 minutes" })) ??
    [];
  const jobs = rows.map(toOrderJob);
  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    const handle = handlerFor(job.kind);
    let error: string | null = null;
    if (!handle) {
      error = "no handler";
    } else {
      try {
        await handle(deps.jobContext, job);
      } catch (err) {
        error = errorMessage(err).slice(0, 500);
      }
    }
    if (error) {
      failed++;
      logEvent("warn", "job_failed", { jobId: job.id, kind: job.kind, attempts: job.attempts, error });
    } else {
      ok++;
    }
    await deps.store.rpc("online_job_finish", { p_job_id: job.id, p_ok: error === null, p_error: error });
  }
  return { claimed: jobs.length, ok, failed };
}

type StaleRow = { order_id: string; order_ref: string; cf_order_id: string | null; created_at: string };

export async function expireStale(
  deps: RunJobsDeps,
): Promise<{ checked: number; confirmed: number; expired: number; flagged: number; errors: number }> {
  const stale = (await deps.store.rpc<StaleRow[]>("online_order_list_stale", { p_min_age: "45 minutes" })) ?? [];
  const tally = { checked: 0, confirmed: 0, expired: 0, flagged: 0, errors: 0 };
  if (!deps.cashfree) {
    if (stale.length > 0) logEvent("warn", "expire_skipped_no_cashfree", { pending: stale.length });
    return tally;
  }
  for (const row of stale) {
    tally.checked++;
    try {
      const cf = await deps.cashfree.getOrder(row.order_ref);
      if (cf?.status === "PAID") {
        const r = await reconcilePayment(deps, row.order_ref);
        if (r.outcome === "confirmed" || r.outcome === "already") tally.confirmed++;
      } else if (!cf || cf.status === "EXPIRED" || cf.status === "TERMINATED") {
        await deps.store.rpc("online_order_fail", {
          p_order_ref: row.order_ref,
          p_status: "expired",
          p_reason: cf ? `Cashfree order ${cf.status}` : "no Cashfree order",
        });
        tally.expired++;
      } else if (
        cf.status === "ACTIVE" && deps.now().getTime() - new Date(row.created_at).getTime() > ACTIVE_PROBLEM_AFTER_MS
      ) {
        const order = await deps.store.orderByRef(row.order_ref);
        if (order && !order.problem) {
          await deps.store.rpc("online_order_set_problem", {
            p_order_ref: row.order_ref,
            p_problem: "Cashfree order still ACTIVE after 24 h; check the Cashfree dashboard",
          });
          tally.flagged++;
        }
      }
      // ACTIVE (< 24 h) or TERMINATION_REQUESTED: wait for the next sweep.
    } catch (err) {
      tally.errors++;
      logEvent("error", "expire_check_failed", { orderRef: row.order_ref, error: errorMessage(err) });
    }
  }
  return tally;
}

export async function handler(req: Request, deps: RunJobsDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!authorized(req, deps.env)) return json(401, { error: "unauthorized" });
  let mode = new URL(req.url).searchParams.get("mode") ?? "";
  const text = await req.text();
  if (!mode && text.trim()) {
    try {
      const b = JSON.parse(text) as { mode?: unknown };
      if (typeof b?.mode === "string") mode = b.mode;
    } catch {
      return json(400, { error: "body must be JSON" });
    }
  }
  try {
    if (mode === "" || mode === "jobs") return json(200, { mode: "jobs", ...(await runJobs(deps)) });
    if (mode === "expire") return json(200, { mode: "expire", ...(await expireStale(deps)) });
    return json(400, { error: `unknown mode ${mode}` });
  } catch (err) {
    logEvent("error", "run_jobs_failed", { mode, error: errorMessage(err) });
    return json(500, { error: "internal error" });
  }
}
