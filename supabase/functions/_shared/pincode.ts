/**
 * Delivery pincode check (plan R16; owner 2026-10-30: deliver anywhere in India).
 *
 * 1. Exactly 6 digits, first digit 1–9, else 'format'.
 * 2. Any valid pincode is accepted; `inUp` tells the quote and the shopper
 *    whether it is inside Uttar Pradesh (UP slabs, "we usually deliver within UP").
 *    - Two-digit prefix 20–28 (UP + Uttarakhand postal circle), else not UP.
 *    - Lookup via `postcodeState` (Shiprocket) wins over the prefix.
 *    - Prefixes shared with Uttarakhand count as UP only when the lookup says so;
 *      a failed lookup (null) for them → not UP, so the national fallback never
 *      undercharges. Any other 20–28 prefix counts as UP on a failed lookup.
 */

export const UP_STATE = "Uttar Pradesh";
export const SHARED_PREFIXES: ReadonlySet<string> = new Set(["244", "246", "247", "248", "249", "262", "263"]);

export type PincodeCheck = { ok: true; inUp: boolean } | { ok: false; reason: "format" };

export async function checkPincode(
  pincode: string,
  postcodeState: (pincode: string) => Promise<string | null>,
): Promise<PincodeCheck> {
  const pc = pincode.trim();
  if (!/^[1-9]\d{5}$/.test(pc)) return { ok: false, reason: "format" };
  const two = Number(pc.slice(0, 2));
  if (two < 20 || two > 28) return { ok: true, inUp: false };

  const state = await postcodeState(pc);
  if (state !== null) return { ok: true, inUp: state.trim().toLowerCase() === UP_STATE.toLowerCase() };
  return { ok: true, inUp: !SHARED_PREFIXES.has(pc.slice(0, 3)) };
}
