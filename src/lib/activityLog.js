import { supabase } from "./supabaseClient";

/**
 * Write one audit-log entry. Fire-and-forget: never throws, never blocks the
 * caller's action. On failure it logs to console only.
 *
 * @param {Object} p
 * @param {"create"|"update"|"delete"} p.action
 * @param {string} p.entityType  e.g. "product" | "variant" | "bill" | ...
 * @param {string|number|null} p.entityId  PK of affected row (coerced to text)
 * @param {string} p.summary  human-readable description (NEVER contains UUIDs)
 */
export async function logActivity({ action, entityType, entityId, summary }) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { error } = await supabase.from("activity_log").insert({
      actor_id: session?.user?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId != null ? String(entityId) : null,
      summary,
    });
    if (error) console.error("[activityLog] insert failed:", error.message);
  } catch (err) {
    console.error("[activityLog] unexpected error:", err);
  }
}
