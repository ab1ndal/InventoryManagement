/**
 * The single payment-confirmation path (plan R4, R5, Task 5). Used by
 * cashfree-webhook, order-status and the run-jobs `expire` sweep, so a
 * missed webhook or a closed browser converges to the same result.
 *
 * Money is confirmed only from Cashfree's own read (never a webhook body or
 * a redirect): Get Order must say PAID, INR, the exact gateway amount and our
 * stored cf_order_id; each SUCCESS payment from Get Payments is then passed to
 * online_order_confirm_payment, which is idempotent per payment id.
 *
 * Money that can't be kept (late payment whose holds are gone, a second
 * payment on a paid order, an R4 mismatch) is refunded automatically:
 *   refund_id = `AUTO-<ref>` for the order's own payment,
 *   `AUTO-<ref>-<cf_payment_id>` (≤ 40 chars) for any further payment.
 * Get Refund is checked first and the refund id doubles as Cashfree's
 * idempotency key, so retries never pay out twice.
 */

import { type CashfreeClient, type CfPayment, toCfAmount } from "./cashfree.ts";
import { DbError, errorMessage, logEvent, type OrderRow, type Store } from "./context.ts";

export type ConfirmDeps = {
  store: Store;
  cashfree: CashfreeClient | null;
  kickJobs: () => void;
};

export type ConfirmOutcome =
  | { outcome: "not_found" }
  | { outcome: "not_configured" }
  /** Cashfree has no such order, or it is not PAID (yet). */
  | { outcome: "not_paid"; cfStatus: string | null }
  | { outcome: "confirmed" | "already"; status: string }
  | { outcome: "refund_required"; refunds: string[] };

type ConfirmResult =
  | { result: "confirmed" | "already"; status: string }
  | { result: "refund_required"; reason: string; amount: number };

export function autoRefundId(orderRef: string, cfPaymentId: string | null): string {
  return cfPaymentId === null ? `AUTO-${orderRef}` : `AUTO-${orderRef}-${cfPaymentId}`.slice(0, 40);
}

/** Zero-gateway order (credit/voucher covered everything): no Cashfree step. */
export async function confirmNoGateway(deps: ConfirmDeps, orderRef: string): Promise<ConfirmResult> {
  const res = await deps.store.rpc<ConfirmResult>("online_order_confirm_payment", {
    p_order_ref: orderRef,
    p_cf_payment_id: "NO_GATEWAY",
    p_amount: 0,
    p_currency: "INR",
  });
  deps.kickJobs();
  return res;
}

async function refundOnce(
  deps: ConfirmDeps & { cashfree: CashfreeClient },
  order: OrderRow,
  refundId: string,
  amount: number,
  reason: string,
): Promise<void> {
  const existing = await deps.cashfree.getRefund(order.order_ref, refundId);
  if (existing) return;
  const r = await deps.cashfree.createRefund(order.order_ref, {
    refundId,
    amount,
    note: `Automatic refund: ${reason}`,
  });
  logEvent("warn", "auto_refund_created", { orderRef: order.order_ref, refundId, amount, reason });
  await deps.store.rpc("online_order_log_event", {
    p_order_ref: order.order_ref,
    p_kind: "auto_refund_created",
    p_data: { refund_id: refundId, cf_refund_id: r.cfRefundId, amount, reason, refund_status: r.status },
  });
}

/**
 * Brings our order in line with Cashfree. Safe to call any number of times
 * from any caller; throws only on infrastructure failures (DB / Cashfree
 * unreachable), which callers log and retry later.
 */
export async function reconcilePayment(deps: ConfirmDeps, orderRef: string): Promise<ConfirmOutcome> {
  const order = await deps.store.orderByRef(orderRef);
  if (!order) return { outcome: "not_found" };
  const cashfree = deps.cashfree;
  if (!cashfree) return { outcome: "not_configured" };
  const d = { ...deps, cashfree };

  const cf = await cashfree.getOrder(orderRef);
  if (!cf || cf.status !== "PAID") return { outcome: "not_paid", cfStatus: cf?.status ?? null };

  const payments = (await cashfree.getPayments(orderRef))
    .filter((p) => p.status === "SUCCESS")
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.cfPaymentId.localeCompare(b.cfPaymentId));
  if (payments.length === 0) return { outcome: "not_paid", cfStatus: cf.status };

  // R4: only a Cashfree order that is exactly ours confirms anything.
  const mismatch = cf.currency !== "INR" ? `currency ${cf.currency}` : toCfAmount(cf.amount) !==
      toCfAmount(order.gateway_amount)
    ? `amount ${cf.amount} vs ${order.gateway_amount}`
    : order.cf_order_id !== null && cf.cfOrderId !== order.cf_order_id
    ? `cf_order_id ${cf.cfOrderId} vs ${order.cf_order_id}`
    : null;
  if (mismatch) {
    logEvent("error", "payment_mismatch", { orderRef, mismatch });
    await deps.store.rpc("online_order_log_event", {
      p_order_ref: orderRef,
      p_kind: "payment_mismatch",
      p_data: { mismatch, cf_order_id: cf.cfOrderId },
    });
    await deps.store.rpc("online_order_set_problem", {
      p_order_ref: orderRef,
      p_problem: `Cashfree payment does not match the order (${mismatch}); refunded automatically`,
    });
    const refunds: string[] = [];
    for (const [i, p] of payments.entries()) {
      const id = autoRefundId(orderRef, i === 0 ? null : p.cfPaymentId);
      await refundOnce(d, order, id, p.amount, "payment_mismatch");
      refunds.push(id);
    }
    return { outcome: "refund_required", refunds };
  }

  let kept: { outcome: "confirmed" | "already"; status: string } | null = null;
  const refunds: string[] = [];
  for (const [i, p] of payments.entries()) {
    const res = await confirmOne(d, order, p);
    if (res.result === "refund_required") {
      const id = autoRefundId(orderRef, i === 0 && res.reason !== "duplicate_payment" ? null : p.cfPaymentId);
      await refundOnce(d, order, id, p.amount, res.reason);
      refunds.push(id);
    } else if (kept?.outcome !== "confirmed") {
      kept = { outcome: res.result, status: res.status };
    }
  }
  // R2: drain the outbox now, even for "already" (an earlier kick may have been lost).
  deps.kickJobs();
  return kept ?? { outcome: "refund_required", refunds };
}

async function confirmOne(
  deps: ConfirmDeps & { cashfree: CashfreeClient },
  order: OrderRow,
  p: CfPayment,
): Promise<ConfirmResult> {
  try {
    return await deps.store.rpc<ConfirmResult>("online_order_confirm_payment", {
      p_order_ref: order.order_ref,
      p_cf_payment_id: p.cfPaymentId,
      p_amount: toCfAmount(p.amount),
      p_currency: p.currency,
    });
  } catch (err) {
    // R4: the DB refuses money that doesn't match; that money goes back.
    if (err instanceof DbError && err.message.includes("payment mismatch")) {
      logEvent("error", "payment_mismatch", { orderRef: order.order_ref, error: errorMessage(err) });
      await deps.store.rpc("online_order_log_event", {
        p_order_ref: order.order_ref,
        p_kind: "payment_mismatch",
        p_data: { cf_payment_id: p.cfPaymentId, error: err.message },
      });
      return { result: "refund_required", reason: "payment_mismatch", amount: p.amount };
    }
    throw err;
  }
}
