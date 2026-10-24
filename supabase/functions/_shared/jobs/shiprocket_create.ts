// shiprocket_create job (plan Task 7, R2, R17): create the Shiprocket order for a paid
// order. Idempotent: skips when sr_order_id is already stored. A Shiprocket failure is
// recorded as checkpoint sr_create_failed and rethrown so run-jobs retries with backoff.
import type { JobContext, OrderJob } from "./types.ts";
import { ensureSrOrder, supabaseOrdersDb } from "../process.ts";

export async function handle(ctx: JobContext, job: OrderJob): Promise<void> {
  const db = supabaseOrdersDb(ctx.db);
  if (!ctx.shiprocket) {
    const error = "Shiprocket is not configured (SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD)";
    await db.rpc("online_order_checkpoint", {
      p_order_id: job.order_id,
      p_step: "sr_create_failed",
      p_data: { error },
    });
    throw new Error(error);
  }
  await ensureSrOrder({ db, shiprocket: ctx.shiprocket, shopEmail: ctx.env.shopEmail }, job.order_id);
}
