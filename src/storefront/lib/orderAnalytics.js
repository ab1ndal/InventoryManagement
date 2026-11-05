import { trackEvent } from "./analytics";

const CURRENCY = "INR";

// Only the order ref, money and product names/quantities. Nothing about who
// the shopper is, and never the access token.
export function purchasePayload(order) {
  const t = order.totals;
  return {
    transaction_id: order.orderRef,
    value: t.subtotal - t.promoDiscount + t.shipping,
    currency: CURRENCY,
    shipping: t.shipping,
    items: order.items.map((i) => ({ item_name: i.name, quantity: i.qty })),
  };
}

export function paymentFailedPayload(order) {
  return { transaction_id: order.orderRef, currency: CURRENCY };
}

// Once per order per browser: the page polls and can reload. Fails closed, so
// storage that cannot be written sends nothing rather than risking a repeat.
function claimOnce(kind, orderRef) {
  const key = `bc_ga_${kind}_${orderRef}`;
  try {
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function trackOrderOutcome(order, confirmed) {
  if (confirmed) {
    if (claimOnce("purchase", order.orderRef)) trackEvent("purchase", purchasePayload(order));
  } else if (order.status === "payment_failed" || order.status === "expired") {
    if (claimOnce("payment_failed", order.orderRef)) trackEvent("payment_failed", paymentFailedPayload(order));
  }
}
