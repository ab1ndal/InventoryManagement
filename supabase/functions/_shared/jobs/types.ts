// Background job contract (plan R2). order_jobs rows are enqueued by the database
// (online_order_confirm_payment, online_order_apply_tracking, refunds) and drained by
// the `run-jobs` Edge Function, which dispatches on `kind` via ./index.ts.
// A handler throws to signal failure; run-jobs then calls online_job_finish(ok=false)
// and the job is retried with backoff. Handlers must be idempotent.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashfreeClient } from "../cashfree.ts";
import type { ShiprocketClient } from "../shiprocket.ts";

export type OrderJob = {
  id: string;
  order_id: string;
  kind: string; // e.g. "shiprocket_create", "email_confirmed", "refund_notify:<refund uuid>"
  attempts: number;
};

export type Mailer = {
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<unknown>;
};

export type JobContext = {
  db: SupabaseClient; // service role
  cashfree: CashfreeClient | null; // null when secrets are not configured
  shiprocket: ShiprocketClient | null;
  mailer: Mailer;
  env: { siteUrl: string; shopEmail: string };
};

export type JobHandler = (ctx: JobContext, job: OrderJob) => Promise<void>;
