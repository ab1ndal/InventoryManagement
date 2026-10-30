/**
 * Delivery pincode check (plan R16; owner 2026-10-30: deliver anywhere in India).
 *
 * 1. Exactly 6 digits, first digit 1–9, else 'format'.
 * 2. Any valid pincode is accepted; `inUp` tells the quote and the shopper
 *    whether it is inside Uttar Pradesh (UP slabs, "we usually deliver within UP").
 *    - Two-digit prefix 20–28 (UP + Uttarakhand postal circle), else not UP.
 *    - Lookup via `postcodeDetails` (Shiprocket) wins over the prefix.
 *    - Prefixes shared with Uttarakhand count as UP only when the lookup says so;
 *      a failed lookup (null) for them → not UP, so the national fallback never
 *      undercharges. Any other 20–28 prefix counts as UP on a failed lookup.
 * 3. The lookup runs for every valid pincode (PR F, Indian address format) so
 *    checkout can fill City and State; `city`/`state` are null when it fails.
 *    It never blocks: a failed lookup only means no autofill.
 */

import type { PostcodeDetails } from "./shiprocket.ts";

export const UP_STATE = "Uttar Pradesh";
export const SHARED_PREFIXES: ReadonlySet<string> = new Set(["244", "246", "247", "248", "249", "262", "263"]);

export type PincodeCheck =
  | { ok: true; inUp: boolean; city: string | null; state: string | null }
  | { ok: false; reason: "format" };

/** Exactly 6 digits, first digit 1–9 (Indian PIN). */
export function isPincodeFormat(pincode: string): boolean {
  return /^[1-9]\d{5}$/.test(pincode.trim());
}

export async function checkPincode(
  pincode: string,
  postcodeDetails: (pincode: string) => Promise<PostcodeDetails | null>,
): Promise<PincodeCheck> {
  const pc = pincode.trim();
  if (!isPincodeFormat(pc)) return { ok: false, reason: "format" };

  const found = await postcodeDetails(pc);
  const place = { city: found?.city ?? null, state: found?.state ?? null };
  const two = Number(pc.slice(0, 2));
  if (two < 20 || two > 28) return { ok: true, inUp: false, ...place };
  if (found) return { ok: true, inUp: found.state.trim().toLowerCase() === UP_STATE.toLowerCase(), ...place };
  return { ok: true, inUp: !SHARED_PREFIXES.has(pc.slice(0, 3)), ...place };
}
