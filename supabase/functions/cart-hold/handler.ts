/**
 * POST cart-hold (15-minute cart hold; HTTP contract). Reserves cart units for
 * the shopper so nobody else can put them in their cart or pay for them.
 *
 * Body: { holderKey?: "g:<uuid>", items: [{ variantId, qty 0..20 }], replace?: boolean }.
 * Each listed variant's hold is set to qty (0 releases); a new or changed hold
 * runs 15 min, re-sending the same qty keeps its expiry, and a hold never runs
 * past 30 min from its start, then cools down for 10 min (reason "cooldown");
 * `replace` also releases the holder's holds on variants not listed (a whole-cart
 * sync, used to renew all holds). The holder is the JWT user when signed in
 * (a guest key sent alongside is adopted into it), else the guest key.
 * Caps (5 units per holder, 10 per IP, 30 calls a minute) give held < requested
 * with a reason, never an error. All the logic is in stock_hold_set.
 */

import { hashIp, optionalUser } from "../_shared/http.ts";
import { ApiError, type AppDeps, browserEndpoint, readJsonBody } from "../_shared/context.ts";
import { holderKeyFor, parseGuestKey } from "../_shared/holds.ts";

export const MAX_HOLD_ITEMS = 30;
export const MAX_HOLD_QTY = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HoldReason = "unavailable" | "holder_cap" | "ip_cap" | "cooldown";

export type CartHoldResponse = {
  rateLimited: boolean;
  items: { variantId: string; requested: number; held: number; available: number; reason: HoldReason | null }[];
  /** Earliest expiry of the holder's cart holds; null when none. */
  expiresAt: string | null;
};

type HoldSetRow = {
  rate_limited: boolean;
  items: { variant_id: string; requested: number; held: number; available: number; reason: HoldReason | null }[];
  expires_at: string | null;
};

/** Validates the items; a variant listed twice keeps its last quantity. */
export function parseHoldItems(raw: unknown): { variantId: string; qty: number }[] {
  if (!Array.isArray(raw)) throw new ApiError(400, "bad_request", "items must be an array");
  const byId = new Map<string, number>();
  for (const it of raw) {
    const variantId = (it as { variantId?: unknown })?.variantId;
    const qty = (it as { qty?: unknown })?.qty;
    if (typeof variantId !== "string" || !UUID_RE.test(variantId)) {
      throw new ApiError(400, "bad_request", "each item needs a variantId (uuid)");
    }
    if (typeof qty !== "number" || !Number.isSafeInteger(qty) || qty < 0 || qty > MAX_HOLD_QTY) {
      throw new ApiError(400, "bad_request", `each item needs an integer qty from 0 to ${MAX_HOLD_QTY}`);
    }
    byId.set(variantId.toLowerCase(), qty);
  }
  if (byId.size > MAX_HOLD_ITEMS) throw new ApiError(400, "bad_request", `at most ${MAX_HOLD_ITEMS} items`);
  return [...byId].map(([variantId, qty]) => ({ variantId, qty }));
}

export function handler(req: Request, deps: AppDeps): Promise<Response> {
  return browserEndpoint(req, deps.env.allowedOrigins, "cart_hold", async (): Promise<CartHoldResponse> => {
    const body = await readJsonBody(req);
    const items = parseHoldItems(body.items);
    if (body.replace !== undefined && typeof body.replace !== "boolean") {
      throw new ApiError(400, "bad_request", "replace must be a boolean");
    }
    const replace = body.replace === true;
    if (!replace && items.length === 0) throw new ApiError(400, "bad_request", "items must not be empty");
    const guestKey = parseGuestKey(body.holderKey);
    const user = await optionalUser(req, deps.verifyJwt, deps.env.anonKey ? [deps.env.anonKey] : []);
    const holderKey = holderKeyFor(user, guestKey);
    if (!holderKey) throw new ApiError(400, "bad_request", "holderKey is required when not signed in");

    // Just signed in: the shopper's guest holds are theirs, not "someone else's".
    if (user && guestKey) await deps.store.rpc("stock_hold_adopt", { p_from: guestKey, p_to: holderKey });

    const ipHash = deps.env.ipHashSalt
      ? await hashIp(req, deps.env.ipHashSalt, { preferCfConnectingIp: true })
      : null;
    const row = await deps.store.rpc<HoldSetRow>("stock_hold_set", {
      p_holder: holderKey,
      p_items: items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
      p_ip_hash: ipHash,
      p_replace: replace,
    });
    if (!row) throw new Error("stock_hold_set returned nothing");
    return {
      rateLimited: row.rate_limited === true,
      items: (row.items ?? []).map((i) => ({
        variantId: i.variant_id,
        requested: Number(i.requested),
        held: Number(i.held),
        available: Number(i.available),
        reason: i.reason ?? null,
      })),
      expiresAt: row.expires_at ?? null,
    };
  });
}
