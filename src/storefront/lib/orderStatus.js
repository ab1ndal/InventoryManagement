// Shopper-facing wording for online order states (spec §10). Every ship order
// follows the same six steps whichever courier carries it; Shiprocket's own
// `processing` reads as Processed and manual `processed` is the same step.
// `cancelling` reads like paid: the shopper only sees the outcome.
export const STATUS_LABELS = {
  pending_payment: "Awaiting payment",
  paid: "Order placed",
  processing: "Processed",
  cancelling: "Order placed",
  processed: "Processed",
  ready_for_pickup: "Ready for pickup",
  packed: "Packed",
  shipped: "Picked up",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  payment_failed: "Payment failed",
  expired: "Expired",
  cancelled: "Cancelled",
  rto: "Returning to us",
  rto_received: "Returned to us",
};

const PICKUP_LABELS = {
  paid: "Paid",
  processing: "Paid",
  cancelling: "Paid",
  delivered: "Collected",
};

export const TIMELINE_STEPS = ["Order placed", "Processed", "Packed", "Picked up", "Out for delivery", "Delivered"];
export const PICKUP_TIMELINE_STEPS = ["Paid", "Ready for pickup", "Collected"];

const STEP_INDEX = {
  paid: 0,
  cancelling: 0,
  cancelled: 0,
  processing: 1,
  processed: 1,
  packed: 2,
  shipped: 3,
  out_for_delivery: 4,
  delivered: 5,
  rto: 3,
  rto_received: 3,
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
  if (fulfilment === "pickup" && PICKUP_LABELS[status]) return PICKUP_LABELS[status];
  return STATUS_LABELS[status] ?? status;
}
