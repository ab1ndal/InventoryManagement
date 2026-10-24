// Shopper-facing wording for online order states (spec §10). Staff-only
// states (processing, cancelling) read as "Paid": the shopper's order is
// simply confirmed and waiting to be packed.
export const STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Paid",
  cancelling: "Paid",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  payment_failed: "Payment failed",
  expired: "Expired",
  cancelled: "Cancelled",
  rto: "Returning to us",
  rto_received: "Returned to us",
};

export const TIMELINE_STEPS = ["Paid", "Packed", "Shipped", "Out for delivery", "Delivered"];

const STEP_INDEX = {
  paid: 0,
  processing: 0,
  cancelling: 0,
  packed: 1,
  shipped: 2,
  out_for_delivery: 3,
  delivered: 4,
  rto: 2,
  rto_received: 2,
  cancelled: 0,
};

// Index of the last completed step, or -1 when the order was never paid.
export function completedStep(status) {
  return STEP_INDEX[status] ?? -1;
}

export function isConfirmed(status) {
  return completedStep(status) >= 0 && status !== "cancelled" && status !== "rto" && status !== "rto_received";
}

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}
