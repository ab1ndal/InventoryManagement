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

// ---------- returns ----------

export const RETURN_REASON_LABELS = {
  damaged_wrong: "Damaged / wrong item",
  change_of_mind: "Change of mind",
};

// Mirrors the DB rule: window = contacted_at − delivered_at (48 h damaged/wrong, 7 days change of mind).
const RETURN_WINDOW_HOURS = { damaged_wrong: 48, change_of_mind: 7 * 24 };

function elapsedHours(deliveredAt, contactedAt) {
  return (new Date(contactedAt) - new Date(deliveredAt)) / 3600000;
}

export function outsideReturnWindow(reason, deliveredAt, contactedAt) {
  if (!deliveredAt || !contactedAt) return false;
  return elapsedHours(deliveredAt, contactedAt) > RETURN_WINDOW_HOURS[reason];
}

// "Hour 30 of 48" (damaged/wrong) or "Day 2 of 7" (change of mind). Counts the hour/day
// we are in, so exactly at the limit still reads "48 of 48" and one minute later "49 of 48".
export function windowLabel(reason, deliveredAt, contactedAt) {
  if (!deliveredAt || !contactedAt || !RETURN_WINDOW_HOURS[reason]) return "";
  const hours = Math.max(0, elapsedHours(deliveredAt, contactedAt));
  if (reason === "damaged_wrong") return `Hour ${Math.max(1, Math.ceil(hours))} of 48`;
  return `Day ${Math.max(1, Math.ceil(hours / 24))} of 7`;
}

function sum(list, pick) {
  return (list || []).reduce((s, x) => s + Number(pick(x) || 0), 0);
}

function refundedReturnUnits(order) {
  return sum(
    (order.returns || []).filter((r) => r.status === "refunded"),
    (r) => sum(r.items, (i) => i.received_units)
  );
}

// "Returned" when every shipped unit came back through refunded returns, "Partly returned" when some did.
// order.order_items carry shipped_qty (the list embeds them; the detail passes its items).
export function returnBadge(order) {
  const refunded = refundedReturnUnits(order);
  if (refunded <= 0) return null;
  const shipped = sum(order.order_items, (i) => i.shipped_qty);
  return refunded >= shipped ? "Returned" : "Partly returned";
}

// Units of one item still free to return: shipped − units in open returns − units received back
// by refunded returns. The server re-checks.
export function returnableUnits(item, returns = []) {
  let used = 0;
  for (const r of returns) {
    for (const ri of r.items || []) {
      if (ri.item_id !== item.id) continue;
      if (r.status === "open") used += Number(ri.units || 0);
      else if (r.status === "refunded") used += Number(ri.received_units || 0);
    }
  }
  return Math.max(0, Number(item.shipped_qty || 0) - used);
}

// A datetime-local minimum must not fall before a seconds-precise instant, so round up to the next minute.
export function ceilToMinute(date) {
  return new Date(Math.ceil(date.getTime() / 60000) * 60000);
}

// Value for <input type="datetime-local"> in the browser's local zone.
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// datetime-local text → ISO string with zone (the server rejects offset-less timestamps); null if blank/invalid.
export function localInputToIso(value) {
  const d = new Date(value);
  return value && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}
