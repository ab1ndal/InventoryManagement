export const ADMIN_ROLES = ["admin", "superadmin"];

// Set before leaving for Google, so the route guard can tell a fresh admin sign-in attempt from a
// shop customer who wandered to /admin. Only the first should be signed out on refusal.
export const OAUTH_PENDING_KEY = "adminOAuthPending";

export const NO_ADMIN_ACCESS = "This account does not have admin access.";

// One rule for the login page and the route guard. The database enforces the same rule in is_admin().
export async function hasAdminAccess(client, userId, allowedRoles = ADMIN_ROLES) {
  // A pending invite for this person's confirmed email becomes their role here. If this fails they
  // are simply refused below, and the invite stays for their next try.
  const { error: claimError } = await client.rpc("claim_admin_invite");
  if (claimError) {
    console.warn("admin invite claim failed", { userId, message: claimError.message });
  }

  const { data, error } = await client
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .single();
  if (error) {
    console.warn("admin access check failed", { userId, message: error.message });
    return false;
  }
  return allowedRoles.includes(data?.role) && data?.is_active !== false;
}
