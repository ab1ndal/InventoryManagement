// Pure display helpers for the Online Orders screen.

export const STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "To check",
  processing: "Processing",
  cancelling: "Cancelling",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  payment_failed: "Payment failed",
  expired: "Expired",
  cancelled: "Cancelled",
  rto: "Returning (RTO)",
  rto_received: "RTO received",
};

export const STATUS_CLASSES = {
  paid: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-800",
  cancelling: "bg-blue-100 text-blue-800",
  packed: "bg-indigo-100 text-indigo-800",
  shipped: "bg-sky-100 text-sky-800",
  out_for_delivery: "bg-sky-100 text-sky-800",
  delivered: "bg-green-100 text-green-800",
  rto: "bg-red-100 text-red-800",
  rto_received: "bg-gray-200 text-gray-800",
  cancelled: "bg-gray-200 text-gray-800",
};

export function formatRupees(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// What the customer was charged in total (online + voucher + store credit).
export function orderTotal(o) {
  return (
    Number(o.gateway_amount || 0) +
    Number(o.voucher_applied || 0) +
    Number(o.credit_applied || 0)
  );
}

export function itemCount(o) {
  return (o.order_items || []).reduce((s, i) => s + Number(i.qty || 0), 0);
}

export function hasProblem(o, jobs = []) {
  return Boolean(
    o.problem || o.process_error || o.status === "rto" || jobs.some((j) => j.status === "failed")
  );
}

// Paise of a line's paid value covered by its first n units: the remainder paise sit on
// the first units (same rule as the DB split, migration CONTRACT "Credit/gateway split").
function cumulativePaise(paidValue, qty, n) {
  const total = Math.round(Number(paidValue) * 100);
  const base = Math.floor(total / qty);
  const rem = total - base * qty;
  return base * n + Math.min(n, rem);
}

// Estimate of what Process will refund given the staff's per-line availability.
// availability: { [itemId]: availableQty }. Units that never took stock were already
// refunded at payment (refunded_qty), so only stock_taken − available is new.
export function processRefundPreview(items, availability, shipping) {
  const lines = [];
  let paise = 0;
  let shippableUnits = 0;
  for (const it of items) {
    const avail = availability[it.id] ?? it.stock_taken;
    shippableUnits += avail;
    const units = it.stock_taken - avail;
    if (units <= 0) continue;
    const start = it.refunded_qty;
    const p =
      cumulativePaise(it.paid_value, it.qty, start + units) -
      cumulativePaise(it.paid_value, it.qty, start);
    paise += p;
    lines.push({ id: it.id, name: it.product_name, size: it.size, color: it.color, units, amount: p / 100 });
  }
  const allUnavailable = shippableUnits === 0;
  if (allUnavailable) paise += Math.round(Number(shipping || 0) * 100);
  return { lines, amount: paise / 100, allUnavailable };
}
