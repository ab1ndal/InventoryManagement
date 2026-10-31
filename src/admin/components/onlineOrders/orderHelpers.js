// Pure display helpers for the Online Orders screen.

export const STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "To check",
  processing: "Processing",
  cancelling: "Cancelling",
  packed: "Packed",
  ready_for_pickup: "Ready for pickup",
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
  ready_for_pickup: "bg-sky-100 text-sky-800",
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

// Checkout accepts any state but the shop usually ships within UP; the owner decides
// fulfilment for the rest (2026-10-30). orders.address.state is required by create-order
// for shipped orders; a pickup order's address is only the contact, so it is never outside UP.
export function isOutsideUp(address, fulfilment = "ship") {
  if (fulfilment === "pickup") return false;
  const state = typeof address?.state === "string" ? address.state.trim().toLowerCase() : "";
  return state !== "" && state !== "uttar pradesh";
}

// Porter links are pasted by staff and shown to the customer; the server enforces the same rule.
export function isValidTrackingUrl(value) {
  return /^https:\/\/\S+$/.test(value) && value.length <= 500;
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

// ---------- timeline ----------

const EVENT_LABELS = {
  created: "Order placed",
  paid: "Payment received",
  payment_attempt_failed: "Payment attempt failed",
  duplicate_payment: "Duplicate payment",
  availability: "Availability checked",
  claimed: "Processing started",
  claim_takeover: "Processing taken over",
  process_prepared: "Items to ship confirmed",
  op_released: "Processing stopped",
  packed: "Packed",
  ready_for_pickup: "Ready for pickup",
  bill_created: "Bill of Supply created",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  manual_cancel_confirmed: "Courier cancellation confirmed by staff",
  courier_cancelled: "Courier booking cancelled",
  courier_problem: "Courier problem",
  tracking_held: "Tracking update held",
  rebooked: "Courier rebooked",
  sent_back: "Sent back",
  rto_received: "Returned parcel received",
  problem: "Problem flagged",
  refund_required: "Refund needed",
  refund_choice: "Refund method chosen",
  refund_created: "Refund created",
  return_opened: "Return opened",
  return_cancelled: "Return cancelled",
  return_rejected: "Return rejected",
  return_refunded: "Return refunded",
  jobs_retry: "Retry requested",
  job_failed: "Background task gave up",
};

const CHECKPOINT_LABELS = {
  cf_order: "Payment page created",
  sr_create: "Shiprocket order created",
  sr_create_failed: "Shiprocket order failed",
  sr_update: "Shiprocket order updated",
  sr_cancelled: "Shiprocket order cancelled",
  awb: "Courier assigned",
  pickup: "Pickup requested",
  manifest: "Manifest generated",
  label: "Label generated",
  error: "Processing failed",
};

const JOB_LABELS = {
  shiprocket_create: "Create Shiprocket order",
  email_confirmed: "Order confirmation email",
  email_shop: "Shop new-order email",
  email_shipped: "Shipped email",
  email_delivered: "Delivered email",
  email_ready_for_pickup: "Ready-for-pickup email",
};

function humanize(code) {
  const s = String(code || "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// One readable line per event: what happened, plus the useful bit of its data.
export function describeEvent(e) {
  const d = e.data || {};
  let label;
  let detail = "";
  if (e.kind === "checkpoint") {
    label = CHECKPOINT_LABELS[d.step] || humanize(d.step);
    const cp = d.data || {};
    if (cp.error) detail = cp.error;
    else if (d.step === "awb") detail = [cp.courier_name, cp.awb && `AWB ${cp.awb}`].filter(Boolean).join(", ");
    else if (d.step === "pickup" && cp.scheduled_date) detail = `scheduled ${cp.scheduled_date}`;
  } else if (e.kind.startsWith("refund_leg_")) {
    label = `Refund ${e.kind.slice("refund_leg_".length)}`;
  } else {
    label = EVENT_LABELS[e.kind] || humanize(e.kind);
    if (e.kind === "paid" && d.amount != null) detail = formatRupees(d.amount);
    else if (e.kind === "availability" && d.of != null) detail = `${d.available_qty} of ${d.of} on shelf`;
    else if (e.kind === "job_failed") detail = [JOB_LABELS[d.kind] || humanize(d.kind), d.error].filter(Boolean).join(": ");
    else if (d.error) detail = d.error;
  }
  const status =
    e.to_status && e.to_status !== e.from_status ? STATUS_LABELS[e.to_status] || humanize(e.to_status) : "";
  return { label, detail, status };
}

// Consecutive identical lines (background retries) collapse into one with a count.
export function timelineRows(events) {
  const rows = [];
  for (const e of events) {
    const line = describeEvent(e);
    const prev = rows[rows.length - 1];
    if (prev && prev.label === line.label && prev.detail === line.detail && !line.status && !prev.status) {
      prev.count += 1;
      prev.lastAt = e.created_at;
      continue;
    }
    rows.push({ id: e.id, ...line, at: e.created_at, lastAt: e.created_at, count: 1 });
  }
  return rows;
}
