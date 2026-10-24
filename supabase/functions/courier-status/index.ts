/**
 * POST courier-status: Shiprocket tracking webhook (deploy with --no-verify-jwt).
 * Public URL https://www.bindalscreations.com/hooks/courier-status (vercel.json rewrite;
 * Shiprocket rejects URLs containing "sr"/"kr"/"shiprocket").
 *
 * Auth: header x-api-key must equal SHIPROCKET_WEBHOOK_TOKEN, else 401.
 * The payload is only a hint: we take its AWB, re-fetch /courier/track/awb/{awb},
 * map shipment_status_id (tracking.ts) and hand that to online_order_apply_tracking,
 * which moves state forward only. Payload status fields are logged, never applied.
 * Once the token is valid the answer is always 200 (Shiprocket notes §9).
 */

import { json, serviceClient } from "../_shared/http.ts";
import { logEvent, type OrdersDb, shiprocketFromEnv, supabaseOrdersDb } from "../_shared/process.ts";
import type { ShiprocketClient } from "../_shared/shiprocket.ts";
import { mapShipmentStatus } from "../_shared/tracking.ts";

export type Deps = {
  /** SHIPROCKET_WEBHOOK_TOKEN; empty = every request refused. */
  token: string;
  db: OrdersDb;
  shiprocket: ShiprocketClient;
};

/** Constant-time for equal lengths; length itself isn't secret enough to matter. */
export function tokenMatches(given: string | null, expected: string): boolean {
  if (!expected || given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (!tokenMatches(req.headers.get("x-api-key"), deps.token)) {
    return json(401, { error: "invalid token", code: "unauthorized" });
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed;
  } catch {
    // Shiprocket's "test webhook" ping may send no JSON; nothing to apply.
  }
  const awb = typeof payload.awb === "string" || typeof payload.awb === "number" ? String(payload.awb).trim() : "";
  if (!awb) {
    logEvent("info", "courier_status_ignored", { reason: "no awb" });
    return json(200, { ok: true, applied: false });
  }
  const hint = {
    shipment_status_id: payload.shipment_status_id ?? null,
    shipment_status: payload.shipment_status ?? null,
  };

  let track;
  try {
    track = await deps.shiprocket.track(awb);
  } catch (err) {
    // The next webhook (or a later scan) re-fetches; the payload is never trusted instead.
    logEvent("warn", "courier_status_track_failed", { awb, hint, error: errorText(err) });
    return json(200, { ok: true, applied: false });
  }
  if (!track.hasData) {
    logEvent("info", "courier_status_no_scans", { awb, hint });
    return json(200, { ok: true, applied: false });
  }

  const status = track.shipmentStatusId === null ? null : mapShipmentStatus(track.shipmentStatusId);
  try {
    const r = await deps.db.rpc<{ matched: boolean; changed: boolean; status?: string }>(
      "online_order_apply_tracking",
      {
        p_awb: awb,
        p_status: status,
        p_payload: {
          shipment_status_id: track.shipmentStatusId,
          shipment_status: track.currentStatus,
          track_url: track.trackUrl,
          etd: track.etd,
          source: "courier-status",
          webhook_hint: hint,
        },
      },
    );
    logEvent("info", "courier_status_applied", {
      awb,
      shipment_status_id: track.shipmentStatusId,
      mapped: status,
      matched: r.matched,
      changed: r.changed,
    });
    return json(200, { ok: true, applied: true, matched: r.matched, changed: r.changed, status: r.status ?? null });
  } catch (err) {
    logEvent("error", "courier_status_apply_failed", { awb, mapped: status, error: errorText(err) });
    return json(200, { ok: true, applied: false });
  }
}

if (import.meta.main) {
  const client = serviceClient();
  const deps: Deps = {
    token: Deno.env.get("SHIPROCKET_WEBHOOK_TOKEN") ?? "",
    db: supabaseOrdersDb(client),
    shiprocket: shiprocketFromEnv(client),
  };
  Deno.serve((req) => handler(req, deps));
}
