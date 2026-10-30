import { supabase } from "lib/supabaseClient";
import { newAttemptKey } from "./ordersApi";

// Identifies this shopper's stock holds (cart-hold function, variant_availability).
// Signed-in shoppers are keyed by user id on the server; the guest key is still
// sent so the server can adopt holds made before login.
const STORAGE_KEY = "bc_holder";
const GUEST_KEY = /^g:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Without storage (private mode, blocked site data) holds last for the session.
let sessionKey = null;

export function guestHolderKey() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (GUEST_KEY.test(stored ?? "")) return stored;
    const key = `g:${newAttemptKey()}`;
    localStorage.setItem(STORAGE_KEY, key);
    return key;
  } catch {
    sessionKey = sessionKey ?? `g:${newAttemptKey()}`;
    return sessionKey;
  }
}

export function holderKeyFor(userId) {
  return userId ? `u:${userId}` : guestHolderKey();
}

// For reads that don't go through a JWT-aware function. getSession is local
// (no network), so this is cheap.
export async function currentHolderKey() {
  const { data } = await supabase.auth.getSession();
  return holderKeyFor(data?.session?.user?.id ?? null);
}
