/**
 * Stock holds (15-minute cart hold; tasks/fulfilment-plan.md "PR E design").
 *
 * Holder key: a signed-in shopper is `u:<auth uid>`, taken from the verified
 * JWT only; a guest is `g:<uuid>`, a random key the browser keeps in
 * localStorage (`bc_holder`) and sends as `holderKey`. A client can never
 * claim a `u:` key, so it can only ever act on its own guest holds.
 */

import { ApiError, type Store } from "./context.ts";
import type { VerifiedUser } from "./http.ts";

const GUEST_KEY_RE = /^g:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the optional guest key from a request body (lower-cased; null when absent). */
export function parseGuestKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !GUEST_KEY_RE.test(raw)) {
    throw new ApiError(400, "bad_request", "holderKey must be g:<uuid>");
  }
  return raw.toLowerCase();
}

/** The holder this request acts for: the JWT user if any, else the guest key (or null). */
export function holderKeyFor(user: VerifiedUser | null, guestKey: string | null): string | null {
  return user ? `u:${user.id.toLowerCase()}` : guestKey;
}

/** One row of variant_availability (SQL contract in migration_online_orders_holds.sql). */
export type AvailabilityRow = {
  variant_id: string;
  stock: number;
  held_by_others: number;
  available: number;
  my_held: number;
  others_expire_at: string | null;
};

/** Units this holder could buy per variant id (lower-case): stock − other holders' active holds. */
export async function availableByVariant(store: Store, variantIds: string[], holderKey: string | null) {
  const rows = (await store.rpc<AvailabilityRow[] | null>("variant_availability", {
    p_variant_ids: variantIds,
    p_holder_key: holderKey,
  })) ?? [];
  return new Map(rows.map((r) => [String(r.variant_id).toLowerCase(), Number(r.available)]));
}
