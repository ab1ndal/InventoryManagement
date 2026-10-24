/**
 * POST cashfree-webhook (plan Task 5, R4, R5, R13). No CORS.
 *
 * The signature is checked over the raw body text before anything is
 * parsed (401 when it fails). After that the answer is always 200, because
 * Cashfree retries until it gets one and every action here is idempotent:
 *   PAYMENT_SUCCESS_WEBHOOK      → reconcilePayment (re-reads Cashfree; R4)
 *   PAYMENT_FAILED / USER_DROPPED → order event only (R5: the order stays
 *                                   payable until Cashfree expires it)
 *   REFUND_STATUS_WEBHOOK        → online_refund_set_status for our refund
 *                                   legs (refund_id = leg id); AUTO-… refunds
 *                                   are only logged on the order
 *   AUTO_REFUND_STATUS_WEBHOOK   → logged
 * Processing errors are logged, not returned: the order-status poll and the
 * run-jobs expiry sweep reconcile anything a lost webhook leaves behind.
 */

import { json } from "../_shared/http.ts";
import type { CfRefundStatus } from "../_shared/cashfree.ts";
import { type AppDeps, errorMessage, logEvent } from "../_shared/context.ts";
import { reconcilePayment } from "../_shared/confirm.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

export function legStatus(s: CfRefundStatus | string): "processing" | "completed" | "failed" {
  if (s === "SUCCESS") return "completed";
  if (s === "CANCELLED" || s === "REJECTED") return "failed";
  return "processing";
}

async function logOnOrder(deps: AppDeps, ref: string | null, kind: string, data: Json): Promise<void> {
  if (!ref) return;
  const order = await deps.store.orderByRef(ref);
  if (!order) {
    logEvent("warn", "cashfree_webhook_unknown_order", { orderRef: ref, kind });
    return;
  }
  await deps.store.rpc("online_order_log_event", { p_order_ref: ref, p_kind: kind, p_data: data });
}

async function process(deps: AppDeps, type: string, data: Json): Promise<void> {
  const orderRef = str(obj(data.order).order_id);
  const payment = obj(data.payment);
  switch (type) {
    case "PAYMENT_SUCCESS_WEBHOOK": {
      if (!orderRef) return;
      const r = await reconcilePayment(deps, orderRef);
      logEvent("info", "cashfree_webhook_success", { orderRef, outcome: r.outcome });
      return;
    }
    case "PAYMENT_FAILED_WEBHOOK":
    case "PAYMENT_USER_DROPPED_WEBHOOK": {
      const err = obj(data.error_details);
      await logOnOrder(deps, orderRef, type === "PAYMENT_FAILED_WEBHOOK" ? "payment_attempt_failed" : "payment_attempt_dropped", {
        cf_payment_id: str(payment.cf_payment_id),
        payment_status: str(payment.payment_status),
        payment_message: str(payment.payment_message),
        error_code: str(err.error_code),
        error_reason: str(err.error_reason),
      });
      return;
    }
    case "REFUND_STATUS_WEBHOOK": {
      const refund = obj(data.refund);
      const refundId = str(refund.refund_id);
      const ref = str(refund.order_id) ?? orderRef;
      const status = str(refund.refund_status) ?? "";
      const info = {
        refund_id: refundId,
        cf_refund_id: str(refund.cf_refund_id),
        refund_status: status,
        refund_amount: refund.refund_amount ?? null,
      };
      if (refundId?.startsWith("AUTO-")) {
        await logOnOrder(deps, ref, "auto_refund_status", info);
        return;
      }
      if (!refundId || !UUID_RE.test(refundId)) {
        logEvent("warn", "cashfree_webhook_unknown_refund", { refundId, orderRef: ref });
        return;
      }
      await deps.store.rpc("online_refund_set_status", {
        p_leg_id: refundId,
        p_status: legStatus(status),
        p_cf_refund_id: str(refund.cf_refund_id),
        p_note: str(refund.status_description) ?? `Cashfree ${status}`,
      });
      return;
    }
    case "AUTO_REFUND_STATUS_WEBHOOK": {
      const auto = obj(data.auto_refund);
      await logOnOrder(deps, orderRef ?? str(auto.order_id), "cashfree_auto_refund", {
        cf_payment_id: str(auto.cf_payment_id) ?? str(payment.cf_payment_id),
        refund_status: str(auto.refund_status),
        refund_amount: auto.refund_amount ?? null,
      });
      return;
    }
    default:
      return; // e.g. PAYMENT_CHARGES_WEBHOOK
  }
}

export async function handler(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!deps.cashfree) {
    // Can't verify without the secret; 503 makes Cashfree retry once it's set.
    logEvent("error", "cashfree_webhook_not_configured");
    return json(503, { error: "not configured" });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-webhook-signature") ?? "";
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  if (!(await deps.cashfree.verifyWebhook(raw, signature, timestamp))) {
    logEvent("warn", "cashfree_webhook_bad_signature");
    return json(401, { error: "invalid signature" });
  }

  let type = "";
  try {
    const body = obj(JSON.parse(raw));
    type = str(body.type) ?? "";
    await process(deps, type, obj(body.data));
  } catch (err) {
    logEvent("error", "cashfree_webhook_failed", { type, error: errorMessage(err) });
  }
  return json(200, { ok: true });
}
