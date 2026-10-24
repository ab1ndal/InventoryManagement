// Single source for the free-shipping threshold (checkout.js imports it too),
// so the nudge and the fee can never disagree.
export const FREE_SHIPPING_THRESHOLD = 5000;

// Only suggest add-ons when the shopper is this close: further out, a single
// piece that closes the gap is a big upsell and reads as pushy.
export const SUGGEST_GAP_LIMIT = 2000;

export function freeShippingProgress(amount) {
  const value = Math.max(0, Number(amount) || 0);
  const gap = Math.max(0, FREE_SHIPPING_THRESHOLD - value);
  const percent = Math.min(100, Math.floor((value / FREE_SHIPPING_THRESHOLD) * 100));
  return { qualified: gap === 0, gap, percent };
}
