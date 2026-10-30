// Shopper-facing wording for online order states (spec §10). Staff-only
// states (processing, cancelling) read as "Paid": the shopper's order is
// simply confirmed and waiting to be packed.
export const STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Paid",
  cancelling: "Paid",
  ready_for_pickup: "Ready for pickup",
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
export const PICKUP_TIMELINE_STEPS = ["Paid", "Ready for pickup", "Collected"];

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

const PICKUP_STEP_INDEX = {
  paid: 0,
  processing: 0,
  cancelling: 0,
  ready_for_pickup: 1,
  delivered: 2,
  cancelled: 0,
};

// Rows from before store pickup existed carry no fulfilment: they shipped.
export function timelineSteps(fulfilment = "ship") {
  return fulfilment === "pickup" ? PICKUP_TIMELINE_STEPS : TIMELINE_STEPS;
}

// Index of the last completed step, or -1 when the order was never paid.
export function completedStep(status, fulfilment = "ship") {
  const index = fulfilment === "pickup" ? PICKUP_STEP_INDEX : STEP_INDEX;
  return index[status] ?? -1;
}

export function isConfirmed(status, fulfilment = "ship") {
  return (
    completedStep(status, fulfilment) >= 0 && status !== "cancelled" && status !== "rto" && status !== "rto_received"
  );
}

// A pickup order is marked delivered when the shopper collects it.
export function statusLabel(status, fulfilment = "ship") {
  if (fulfilment === "pickup" && status === "delivered") return "Collected";
  return STATUS_LABELS[status] ?? status;
}
