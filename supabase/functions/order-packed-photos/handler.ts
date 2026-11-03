/**
 * POST order-packed-photos {orderRef, phone} → {photos: string[]}.
 *
 * /track finds an order through the online_order_lookup RPC, and SQL cannot sign a Storage link, so
 * the page asks here for its photos. order-status is not reused because its response carries the
 * leftover voucher code, which an order number and phone must not reveal.
 *
 * Unknown ref, wrong phone and rate-limited callers all get the same 404, sharing order-status's
 * failure budget per IP.
 */

import { hashIp } from "../_shared/http.ts";
import { ApiError, type AppDeps, browserEndpoint, readJsonBody } from "../_shared/context.ts";
import { packedPhotoUrls } from "../_shared/packedPhotos.ts";
import { STATUS_FAILURE_LIMIT } from "../order-status/handler.ts";

const REF_RE = /^WEB-\d{6,}$/;

export function handler(req: Request, deps: AppDeps): Promise<Response> {
  return browserEndpoint(req, deps.env.allowedOrigins, "order_packed_photos", async () => {
    const body = await readJsonBody(req);
    const ref = typeof body.orderRef === "string" ? body.orderRef.trim().toUpperCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    const notFound = () => new ApiError(404, "not_found", "order not found");
    const ipHash = deps.env.ipHashSalt ? await hashIp(req, deps.env.ipHashSalt) : null;
    const limitKey = ipHash ? `status-ip:${ipHash}` : null;
    if (limitKey && (await deps.store.recentStatusFailures(limitKey)) >= STATUS_FAILURE_LIMIT) throw notFound();

    const allowed = REF_RE.test(ref) && phone !== "" &&
      await deps.store.rpc<boolean>("online_order_phone_ok", { p_order_ref: ref, p_phone: phone });
    const order = allowed ? await deps.store.orderByRef(ref) : null;
    if (!order) {
      if (limitKey) await deps.store.recordStatusFailure(limitKey);
      throw notFound();
    }
    return { photos: await packedPhotoUrls(deps, order.id) };
  });
}
