export const DELIVERY_ESTIMATE = "Dispatches in 2 days · Delivered in 5–7 days";

// Most designs are stocked 1-2 deep, so "Only N left" would fire on nearly
// every product and read as false scarcity. Frame low stock as uniqueness,
// and stay silent once stock is ample.
export function stockNote(stock) {
  const n = Number(stock);
  if (!Number.isFinite(n) || n <= 0 || n > 3) return null;
  return `Limited piece — only ${n} in stock`;
}
