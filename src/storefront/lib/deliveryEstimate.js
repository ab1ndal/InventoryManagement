export const DELIVERY_ESTIMATE = "Dispatches in 2 days · Delivered in 5–7 days";

// Generic, always-true care guidance — no per-product care data exists in the
// DB, so this stays universal to ethnic wear rather than faking specifics.
export const CARE_NOTE =
  "Dry clean recommended for silk and embroidered pieces. Store folded in a cool, dry place, away from direct sunlight.";

// Photo honesty: sets expectations so a slight real-vs-photo difference
// doesn't read as a bait-and-switch.
export const COLOUR_NOTE =
  "Slight variation in colour and finish is natural in ethnic wear. On-screen colours may differ marginally from the actual fabric.";

// Composition dealer: no GST is charged, so never claim "inclusive of all
// taxes" (owner 2026-10-25). Matches the Terms: prices are final.
export const PRICE_NOTE = "Final price · Free shipping above ₹5,000";

// Most designs are stocked 1-2 deep, so the note speaks of "this design"
// (true for every piece) rather than claiming it sold fast. Silent once stock
// is ample.
export function stockNote(stock) {
  const n = Number(stock);
  if (!Number.isFinite(n) || n <= 0 || n > 3) return null;
  return n === 1 ? "Last piece in this design" : `Only ${n} pieces left in this design`;
}

// Shown when every unit in stock sits in other shoppers' carts. Their holds
// lapse after 15 minutes unless they check out, so it may come back.
export function heldNote(othersExpireAt, now = Date.now()) {
  const end = Date.parse(othersExpireAt ?? "");
  if (!Number.isFinite(end)) return "In someone's cart right now";
  return `In someone's cart — may free up in ${Math.max(1, Math.ceil((end - now) / 60000))} min`;
}
