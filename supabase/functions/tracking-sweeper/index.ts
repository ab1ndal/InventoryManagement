/**
 * POST tracking-sweeper (scheduled; deploy with --no-verify-jwt). Auth: header
 * `x-cron-secret: <CRON_SECRET>` or `Authorization: Bearer <service role key>`.
 * Recovers lost courier-status webhooks: shipped orders whose tracking has not been
 * refreshed for 3 h are re-fetched from Shiprocket and applied exactly as the webhook
 * would (trackAndApply). online_order_apply_tracking only moves an order forward and
 * order_jobs is unique per (order, kind, ref), so a repeat run never repeats an email.
 * Manual deliveries (Porter, self) have no Shiprocket AWB and are never selected; an
 * order mid-rebook is skipped here and held again by online_order_apply_tracking.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { constantTimeEqual } from "../_shared/cashfree.ts";
import { json, serviceClient } from "../_shared/http.ts";
import { logEvent, type OrdersDb, shiprocketFromEnv, supabaseOrdersDb } from "../_shared/process.ts";
import type { ShiprocketClient } from "../_shared/shiprocket.ts";
import { trackAndApply } from "../_shared/tracking_apply.ts";

export const BATCH_LIMIT = 25;
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** Gap between Shiprocket calls, so a full batch stays far below its rate limit. */
export const CALL_GAP_MS = 300;

export type SweepOrder = { order_ref: string; awb: string };

export type SweepSource = {
  /** Courier orders due a tracking check, least recently checked first. */
  due(limit: number, staleBefore: Date, now: Date): Promise<SweepOrder[]>;
};

export type Deps = {
  db: OrdersDb;
  source: SweepSource;
  shiprocket: ShiprocketClient;
  cronSecret: string;
  serviceKey: string;
  log: typeof logEvent;
  pause: (ms: number) => Promise<void>;
  now: () => Date;
};

const enc = new TextEncoder();
const same = (a: string, b: string) => b.length > 0 && constantTimeEqual(enc.encode(a), enc.encode(b));

export function authorized(
  req: Request,
  cronSecret: string,
  serviceKey: string,
): boolean {
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null && same(cron, cronSecret)) return true;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m !== null && same(m[1], serviceKey);
}

export function supabaseSweepSource(client: SupabaseClient): SweepSource {
  return {
    async due(limit, staleBefore, now) {
      const { data, error } = await client.from("orders")
        .select("order_ref, awb")
        .eq("fulfilment", "ship")
        .not("awb", "is", null)
        .in("status", ["packed", "shipped", "out_for_delivery"])
        // Shiprocket orders have courier null or 'shiprocket'; porter/self are manual.
        .or("courier.is.null,courier.eq.shiprocket")
        .or(`op_action.is.null,op_lease_until.lt.${now.toISOString()}`)
        .or(
          `tracking_updated_at.is.null,tracking_updated_at.lt.${staleBefore.toISOString()}`,
        )
        .order("tracking_updated_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) {
        throw new Error(`orders sweep select failed: ${error.message}`);
      }
      return (data ?? []) as SweepOrder[];
    },
  };
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, {
      error: "method not allowed",
      code: "method_not_allowed",
    });
  }
  if (!authorized(req, deps.cronSecret, deps.serviceKey)) {
    return json(401, { error: "unauthorized", code: "unauthorized" });
  }
  let orders: SweepOrder[];
  try {
    const now = deps.now();
    orders = await deps.source.due(
      BATCH_LIMIT,
      new Date(now.getTime() - STALE_AFTER_MS),
      now,
    );
  } catch (err) {
    deps.log("error", "tracking_sweep_select_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json(500, { error: "sweep failed", code: "internal" });
  }

  let changed = 0;
  let failed = 0;
  for (const [i, o] of orders.entries()) {
    if (i > 0) await deps.pause(CALL_GAP_MS);
    const r = await trackAndApply(deps, o.awb, "tracking-sweeper");
    if (r.kind === "track_failed" || r.kind === "apply_failed") {
      failed++;
      deps.log("warn", "tracking_sweep_order_failed", {
        order_ref: o.order_ref,
        step: r.kind,
        error: r.error,
      });
    } else if (r.kind === "applied" && r.changed) {
      changed++;
      deps.log("info", "tracking_sweep_order_changed", {
        order_ref: o.order_ref,
        status: r.status,
      });
    }
  }
  const summary = { checked: orders.length, changed, failed };
  deps.log("info", "tracking_sweep", summary);
  return json(200, summary);
}

if (import.meta.main) {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!cronSecret && !serviceKey) {
    throw new Error("CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  const client = serviceClient();
  const deps: Deps = {
    db: supabaseOrdersDb(client),
    source: supabaseSweepSource(client),
    shiprocket: shiprocketFromEnv(client),
    cronSecret,
    serviceKey,
    log: logEvent,
    pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
  Deno.serve((req) => handler(req, deps));
}
