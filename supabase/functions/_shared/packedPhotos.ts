/** Short-lived links to an order's packed photos, for the customer pages. */

import { type AppDeps, errorMessage, logEvent } from "./context.ts";

/** Long enough for a customer to keep the tracking page open. */
export const CUSTOMER_PHOTO_TTL_SECONDS = 3600;

/** Throws on a Storage or DB failure; callers decide whether that matters. */
export async function packedPhotoUrls(deps: AppDeps, orderId: string): Promise<string[]> {
  const paths = await deps.store.rpc<string[]>("online_order_packed_photo_paths", { p_order_id: orderId });
  const urls = await Promise.all(paths.map((p) => deps.photoStorage.createViewUrl(p, CUSTOMER_PHOTO_TTL_SECONDS)));
  return urls.filter((u): u is string => u !== null);
}

/** Photos only reassure, so a failure must never cost a customer their order status. */
export async function packedPhotoUrlsOrNone(deps: AppDeps, orderId: string, orderRef: string): Promise<string[]> {
  try {
    return await packedPhotoUrls(deps, orderId);
  } catch (err) {
    logEvent("warn", "packed_photos_failed", { orderRef, error: errorMessage(err) });
    return [];
  }
}
