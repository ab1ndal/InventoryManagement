/**
 * Uttar Pradesh delivery check (plan R16, fail-closed for shared prefixes).
 *
 * 1. Exactly 6 digits, else 'format'.
 * 2. Two-digit prefix 20–28 (UP + Uttarakhand postal circle), else 'not_up'.
 * 3. Lookup via `postcodeState` (Shiprocket):
 *    - another state → 'not_up';
 *    - prefixes shared with Uttarakhand must look up as "Uttar Pradesh";
 *      a failed lookup (null) for them → 'unverifiable' (blocks checkout);
 *    - any other prefix accepts on a failed lookup.
 */

export const UP_STATE = "Uttar Pradesh";
export const SHARED_PREFIXES: ReadonlySet<string> = new Set(["244", "246", "247", "248", "249", "262", "263"]);

export type PincodeCheck = { ok: boolean; reason?: "format" | "not_up" | "unverifiable" };

export async function checkUpPincode(
  pincode: string,
  postcodeState: (pincode: string) => Promise<string | null>,
): Promise<PincodeCheck> {
  const pc = pincode.trim();
  if (!/^\d{6}$/.test(pc)) return { ok: false, reason: "format" };
  const two = Number(pc.slice(0, 2));
  if (two < 20 || two > 28) return { ok: false, reason: "not_up" };

  const state = await postcodeState(pc);
  if (state !== null) {
    return state.trim().toLowerCase() === UP_STATE.toLowerCase() ? { ok: true } : { ok: false, reason: "not_up" };
  }
  return SHARED_PREFIXES.has(pc.slice(0, 3)) ? { ok: false, reason: "unverifiable" } : { ok: true };
}
