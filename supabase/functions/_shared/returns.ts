/** Pure request validation / mapping for the admin return actions (camelCase body → RPC jsonb). */

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RETURN_REASONS = ["damaged_wrong", "change_of_mind"] as const;
export type ReturnReason = typeof RETURN_REASONS[number];

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

/** Seconds a staff photo view link stays valid. */
export const PHOTO_VIEW_TTL_SECONDS = 600;

/** Port over the private `order-returns` bucket (service role). */
export type ReturnsStorage = {
  /** A URL the browser PUTs the file to, plus the upload token. */
  createUploadUrl(path: string): Promise<{ uploadUrl: string; token: string }>;
  /** null when the object is gone from Storage. */
  createViewUrl(path: string, expiresInSeconds: number): Promise<string | null>;
};

export const RETURN_PHOTO_BUCKET = "order-returns";

export function supabaseReturnsStorage(client: SupabaseClient): ReturnsStorage {
  const bucket = () => client.storage.from(RETURN_PHOTO_BUCKET);
  return {
    async createUploadUrl(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data) {
        throw new Error(
          `createSignedUploadUrl failed for ${path}: ${error?.message}`,
        );
      }
      return { uploadUrl: data.signedUrl, token: data.token };
    },
    async createViewUrl(path, expiresInSeconds) {
      const { data, error } = await bucket().createSignedUrl(
        path,
        expiresInSeconds,
      );
      if (error && /not.?found/i.test(error.message)) return null;
      if (error || !data) {
        throw new Error(
          `createSignedUrl failed for ${path}: ${error?.message}`,
        );
      }
      return data.signedUrl;
    },
  };
}

const bad = (message: string) => new HttpError(400, message);

export function photoExtFor(contentType: unknown): string {
  const ext = typeof contentType === "string" ? PHOTO_EXT[contentType.trim().toLowerCase()] : undefined;
  if (!ext) {
    throw bad(
      "contentType must be image/jpeg, image/png, image/webp, image/heic or image/heif",
    );
  }
  return ext;
}

export function uuidValue(v: unknown, label: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw bad(`${label} must be a uuid`);
  }
  return v;
}

export function requiredText(v: unknown, label: string): string {
  if (typeof v !== "string" || !v.trim()) throw bad(`${label} is required`);
  return v.trim();
}

export function optionalText(v: unknown, label: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw bad(`${label} must be text`);
  return v.trim() || null;
}

export function isoTimestamp(v: unknown, label: string): string {
  // Full ISO-8601 with a zone, so the DB never guesses a timezone.
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) ||
    Number.isNaN(Date.parse(v))
  ) throw bad(`${label} must be an ISO timestamp with a timezone`);
  return v;
}

function itemList(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw bad("items must be a non-empty list");
  }
  const seen = new Set<string>();
  return v.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw bad("each item must be an object");
    }
    const o = raw as Record<string, unknown>;
    const id = uuidValue(o.itemId, "itemId");
    if (seen.has(id)) throw bad(`item ${id} is listed twice`);
    seen.add(id);
    return o;
  });
}

function units(v: unknown, label: string, min: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
    throw bad(
      `${label} must be ${min === 0 ? "a non-negative" : "a positive"} integer`,
    );
  }
  return v;
}

export function mapOpenItems(v: unknown): { item_id: string; units: number }[] {
  return itemList(v).map((o) => ({
    item_id: o.itemId as string,
    units: units(o.units, "units", 1),
  }));
}

export function mapReceiveItems(
  v: unknown,
): { item_id: string; received_units: number; restock_units: number }[] {
  return itemList(v).map((o) => {
    const received = units(o.receivedUnits, "receivedUnits", 0);
    const restock = units(o.restockUnits, "restockUnits", 0);
    if (restock > received) {
      throw bad("restockUnits cannot exceed receivedUnits");
    }
    return {
      item_id: o.itemId as string,
      received_units: received,
      restock_units: restock,
    };
  });
}

export function mapOpenReturn(
  body: Record<string, unknown>,
  orderId: string,
  actor: string,
  isSuperadmin: boolean,
) {
  const reason = body.reason;
  if (!RETURN_REASONS.includes(reason as ReturnReason)) {
    throw bad(`reason must be one of ${RETURN_REASONS.join(", ")}`);
  }
  return {
    p_order_id: orderId,
    p_actor: actor,
    p_is_superadmin: isSuperadmin,
    p_reason: reason as ReturnReason,
    p_contacted_at: isoTimestamp(body.contactedAt, "contactedAt"),
    p_items: mapOpenItems(body.items),
    p_note: requiredText(body.note, "note"),
    p_return_awb: optionalText(body.returnAwb, "returnAwb"),
    p_override_reason: optionalText(body.overrideReason, "overrideReason"),
  };
}
