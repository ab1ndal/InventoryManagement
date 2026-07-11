export const DELIVERY_ESTIMATE = "Dispatches in 2 days · Delivered in 5–7 days";

// Generic, always-true care guidance — no per-product care data exists in the
// DB, so this stays universal to ethnic wear rather than faking specifics.
export const CARE_NOTE =
  "Dry clean recommended for silk and embroidered pieces. Store folded in a cool, dry place, away from direct sunlight.";

// Handcrafted-goods honesty: sets expectations so a slight real-vs-photo
// difference doesn't read as a bait-and-switch.
export const COLOUR_NOTE =
  "Handcrafted piece — slight variation in colour and finish is natural. On-screen colours may differ marginally from the actual fabric.";

// Most designs are stocked 1-2 deep, so "Only N left" would fire on nearly
// every product and read as false scarcity. Frame low stock as uniqueness,
// and stay silent once stock is ample.
export function stockNote(stock) {
  const n = Number(stock);
  if (!Number.isFinite(n) || n <= 0 || n > 3) return null;
  return `Limited piece — only ${n} in stock`;
}
