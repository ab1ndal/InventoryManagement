/**
 * POST order-status (plan Task 5, R5, R10; HTTP contract).
 *
 * Access: `accessToken` matching the stored hash (online_order_access_ok),
 * or a verified JWT whose user owns the order. Unknown ref, wrong token and
 * rate-limited callers all get the same 404 body.
 *
 * A pending order is reconciled with Cashfree here (same path as the
 * webhook), so a missed webhook still converges while the shopper watches.
 */

import { hashIp, optionalUser } from "../_shared/http.ts";
import {
  ApiError,
  type AppDeps,
  browserEndpoint,
  errorMessage,
  logEvent,
  readJsonBody,
  sha256Hex,
} from "../_shared/context.ts";
import { reconcilePayment } from "../_shared/confirm.ts";

/** Failed lookups per IP hash per hour before every answer becomes 404. */
export const STATUS_FAILURE_LIMIT = 20;
const REF_RE = /^WEB-\d{6,}$/;

export type OrderStatusResponse = {
  orderRef: string;
  status: string;
  items: { name: string; size: string | null; color: string | null; qty: number; status: string }[];
  totals: {
    subtotal: number;
    promoDiscount: number;
    shipping: number;
    voucherApplied: number;
    creditApplied: number;
    gatewayAmount: number;
  };
  trackingUrl: string | null;
  leftoverVoucher: { code: string; value: number } | null;
};

const notFound = () => new ApiError(404, "not_found", "order not found");

export function handler(req: Request, deps: AppDeps): Promise<Response> {
  return browserEndpoint(req, deps.env.allowedOrigins, "order_status", async (): Promise<OrderStatusResponse> => {
    const body = await readJsonBody(req);
    const ref = typeof body.orderRef === "string" ? body.orderRef.trim().toUpperCase() : "";
    const token = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    const user = await optionalUser(req, deps.verifyJwt, deps.env.anonKey ? [deps.env.anonKey] : []);

    const ipHash = deps.env.ipHashSalt ? await hashIp(req, deps.env.ipHashSalt) : null;
    const limitKey = ipHash ? `status-ip:${ipHash}` : null;
    if (limitKey && (await deps.store.recentStatusFailures(limitKey)) >= STATUS_FAILURE_LIMIT) throw notFound();
    const deny = async () => {
      if (limitKey) await deps.store.recordStatusFailure(limitKey);
      return notFound();
    };

    if (!REF_RE.test(ref) || (!token && !user)) throw await deny();
    let order = await deps.store.orderByRef(ref);
    if (!order) throw await deny();
    const allowed = token
      ? await deps.store.rpc<boolean>("online_order_access_ok", { p_order_ref: ref, p_token_hash: await sha256Hex(token) })
      : order.auth_user_id !== null && order.auth_user_id === user?.id;
    if (!allowed) throw await deny();

    if (order.status === "pending_payment" || (order.status === "expired" && order.cf_payment_id === null)) {
      try {
        const r = await reconcilePayment(deps, ref);
        if (r.outcome !== "not_paid" && r.outcome !== "not_configured") order = (await deps.store.orderByRef(ref)) ?? order;
      } catch (err) {
        // The shopper keeps polling; the webhook or the expiry sweep settles it.
        logEvent("warn", "order_status_reconcile_failed", { orderRef: ref, error: errorMessage(err) });
      }
    }

    const items = await deps.store.orderItems(order.id);
    const leftoverValue = order.leftover_voucher_id ? await deps.store.voucherValue(order.leftover_voucher_id) : null;
    return {
      orderRef: order.order_ref,
      status: order.status,
      items: items.map((i) => ({ name: i.product_name, size: i.size, color: i.color, qty: i.qty, status: i.status })),
      totals: {
        subtotal: order.subtotal,
        promoDiscount: order.promo_discount,
        shipping: order.shipping,
        voucherApplied: order.voucher_applied,
        creditApplied: order.credit_applied,
        gatewayAmount: order.gateway_amount,
      },
      trackingUrl: order.awb ? `https://shiprocket.co/tracking/${encodeURIComponent(order.awb)}` : null,
      leftoverVoucher: order.leftover_voucher_id && leftoverValue !== null
        ? { code: order.leftover_voucher_id, value: leftoverValue }
        : null,
    };
  });
}
