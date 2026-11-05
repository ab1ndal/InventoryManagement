/**
 * Re-fetch one shipment's tracking from Shiprocket, map it and hand it to
 * online_order_apply_tracking (forward-only). Shared by the courier-status webhook
 * and the tracking-sweeper so both apply tracking identically.
 */

import type { OrdersDb } from "./process.ts";
import type { ShiprocketClient } from "./shiprocket.ts";
import { mapShipmentStatus } from "./tracking.ts";

export type TrackApplyResult =
  | { kind: "track_failed"; error: string }
  | { kind: "no_data" }
  | {
    kind: "apply_failed";
    error: string;
    shipmentStatusId: number | null;
    mapped: string | null;
  }
  | {
    kind: "applied";
    shipmentStatusId: number | null;
    mapped: string | null;
    matched: boolean;
    changed: boolean;
    status: string | null;
  };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never throws: each failure is a result kind so one bad shipment cannot stop a caller's loop. */
export async function trackAndApply(
  deps: { db: OrdersDb; shiprocket: ShiprocketClient },
  awb: string,
  source: string,
  extra: Record<string, unknown> = {},
): Promise<TrackApplyResult> {
  let track;
  try {
    track = await deps.shiprocket.track(awb);
  } catch (err) {
    return { kind: "track_failed", error: errorText(err) };
  }
  if (!track.hasData) return { kind: "no_data" };

  const mapped = track.shipmentStatusId === null ? null : mapShipmentStatus(track.shipmentStatusId);
  try {
    const r = await deps.db.rpc<
      { matched: boolean; changed: boolean; status?: string }
    >(
      "online_order_apply_tracking",
      {
        p_awb: awb,
        p_status: mapped,
        p_payload: {
          shipment_status_id: track.shipmentStatusId,
          shipment_status: track.currentStatus,
          track_url: track.trackUrl,
          etd: track.etd,
          source,
          ...extra,
        },
      },
    );
    return {
      kind: "applied",
      shipmentStatusId: track.shipmentStatusId,
      mapped,
      matched: r.matched,
      changed: r.changed,
      status: r.status ?? null,
    };
  } catch (err) {
    return {
      kind: "apply_failed",
      error: errorText(err),
      shipmentStatusId: track.shipmentStatusId,
      mapped,
    };
  }
}
