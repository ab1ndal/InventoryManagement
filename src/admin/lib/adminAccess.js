export const ADMIN_ROLES = ["admin", "superadmin"];

// Set before leaving for Google, so the route guard can tell a fresh admin sign-in attempt from a
// shop customer who wandered to /admin. Only the first should be signed out on refusal.
export const OAUTH_PENDING_KEY = "adminOAuthPending";

export const NO_ADMIN_ACCESS = "This account does not have admin access.";

let lastCheckedProfile = null;

// The role from the check that let this user in, so the admin menu need not fetch it again. It only
// picks which menu items show: the database still enforces access on every request.
export const lastCheckedRole = (userId) =>
  lastCheckedProfile?.userId === userId ? lastCheckedProfile.role : null;

async function profileAllows(client, userId, allowedRoles) {
  const { data, error } = await client
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .single();
  if (error) {
    console.warn("admin access check failed", { userId, message: error.message });
    return false;
  }
  lastCheckedProfile = { userId, role: data?.role ?? null };
  return allowedRoles.includes(data?.role) && data?.is_active !== false;
}

// One rule for the login page and the route guard. The database enforces the same rule in is_admin().
export async function hasAdminAccess(client, userId, allowedRoles = ADMIN_ROLES) {
  // A pending invite for this person's confirmed email becomes their role here. If this fails they
  // are simply refused below, and the invite stays for their next try. It runs beside the role read
  // so an existing admin does not wait for it; anyone refused waits, then is read again.
  const claim = client.rpc("claim_admin_invite").then(({ error: claimError }) => {
    if (claimError) {
      console.warn("admin invite claim failed", { userId, message: claimError.message });
    }
  });

  if (await profileAllows(client, userId, allowedRoles)) return true;
  await claim;
  return profileAllows(client, userId, allowedRoles);
}
