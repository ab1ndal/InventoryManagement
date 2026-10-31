// src/admin/lib/activity.js
// src/lib/activityLog.js's logActivity, on the caller's client: the actor is
// the client's signed-in user (the admin running the CLI, or the screen's
// session). Like logActivity, a failed log write never fails the action.
export async function logActivityWith(client, { action, entityType, entityId, summary }) {
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    const { error } = await client.from("activity_log").insert({
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
