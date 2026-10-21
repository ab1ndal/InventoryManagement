// src/admin/lib/customerMarketing.js
import { supabase } from "../../lib/supabaseClient";

// Mirrors customers_community_status_check (schema/migration_marketing_consent_community.sql).
export const COMMUNITY_STATUS_LABELS = {
  not_added: "Not added",
  invite_pending: "Invite pending",
  member: "Member",
  left: "Left",
  opted_out: "Opted out",
};

// Statuses an admin sets by hand from the WhatsApp member list. opted_out is
// excluded: it records a customer's request, which belongs with a consent change.
export const BULK_COMMUNITY_STATUSES = ["member", "invite_pending", "left"];

/**
 * Set community_status on many customers in one update.
 * Returns the number of rows actually updated (RLS can silently match fewer).
 */
export async function setCommunityStatus(customerIds, status) {
  if (!BULK_COMMUNITY_STATUSES.includes(status)) {
    throw new Error(`Unsupported community status: ${status}`);
  }
  const { data, error } = await supabase
    .from("customers")
    .update({
      community_status: status,
      community_status_at: new Date().toISOString(),
    })
    .in("customerid", customerIds)
    .select("customerid");
  if (error) throw error;
  return data?.length ?? 0;
}

async function setOptInFlag(customerid, optIn) {
  const { error } = await supabase
    .from("customers")
    .update({ marketing_opt_in: optIn })
    .eq("customerid", customerid);
  if (error) {
    throw new Error(`Could not update WhatsApp opt-in flag: ${error.message}`);
  }
}

/**
 * Record a marketing consent change: append a marketing_consents row and
 * update the derived customers.marketing_opt_in flag.
 *
 * The two writes are not atomic, so they are ordered so that a failure between
 * them always leaves the customer in the "do not message" direction:
 *  - opt_in:  log first, then flag -> the flag is never true without an opt_in record.
 *  - opt_out: flag first, then log -> messaging stops even if the log write fails.
 * Either failure throws, so the caller must surface it.
 */
export async function recordMarketingConsent({ customerid, optIn, source }) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (authErr || !uid) {
    throw new Error("Could not identify the signed-in admin to record consent");
  }

  if (!optIn) await setOptInFlag(customerid, false);

  const { error } = await supabase.from("marketing_consents").insert({
    customerid,
    action: optIn ? "opt_in" : "opt_out",
    source,
    recorded_by: uid,
  });
  if (error) {
    throw new Error(`Could not record WhatsApp consent: ${error.message}`);
  }

  if (optIn) await setOptInFlag(customerid, true);
}
