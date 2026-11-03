import {
  PICKUP_TIMELINE_STEPS,
  TIMELINE_STEPS,
  completedStep,
  isConfirmed,
  statusLabel,
  timelineSteps,
} from "../lib/orderStatus";

test("timelineSteps: every ship order gets the six steps, pickup keeps its own", () => {
  expect(TIMELINE_STEPS).toEqual(["Order placed", "Processed", "Packed", "Picked up", "Out for delivery", "Delivered"]);
  expect(timelineSteps()).toBe(TIMELINE_STEPS);
  expect(timelineSteps("ship")).toBe(TIMELINE_STEPS);
  expect(timelineSteps("pickup")).toBe(PICKUP_TIMELINE_STEPS);
  expect(PICKUP_TIMELINE_STEPS).toEqual(["Paid", "Ready for pickup", "Collected"]);
});

test.each([
  ["paid", 0],
  ["cancelling", 0],
  ["cancelled", 0],
  ["processing", 1],
  ["processed", 1],
  ["packed", 2],
  ["shipped", 3],
  ["out_for_delivery", 4],
  ["delivered", 5],
  ["rto", 3],
  ["rto_received", 3],
  ["pending_payment", -1],
])("completedStep for a ship order: %s is step %i", (status, step) => {
  expect(completedStep(status)).toBe(step);
});

test.each([
  ["paid", 0],
  ["processing", 0],
  ["cancelling", 0],
  ["cancelled", 0],
  ["ready_for_pickup", 1],
  ["delivered", 2],
])("completedStep for a pickup order: %s is step %i", (status, step) => {
  expect(completedStep(status, "pickup")).toBe(step);
});

test("isConfirmed: every paid-onward status except the exits", () => {
  for (const status of ["paid", "processing", "processed", "packed", "shipped", "out_for_delivery", "delivered"]) {
    expect(isConfirmed(status)).toBe(true);
  }
  for (const status of ["pending_payment", "cancelled", "rto", "rto_received", "payment_failed", "expired"]) {
    expect(isConfirmed(status)).toBe(false);
  }
});

test.each([
  ["paid", "Order placed"],
  ["cancelling", "Order placed"],
  ["processing", "Processed"],
  ["processed", "Processed"],
  ["packed", "Packed"],
  ["shipped", "Picked up"],
  ["out_for_delivery", "Out for delivery"],
  ["delivered", "Delivered"],
])("statusLabel for a ship order: %s reads %s", (status, label) => {
  expect(statusLabel(status)).toBe(label);
  expect(statusLabel(status, "ship")).toBe(label);
});

test.each([
  ["paid", "Paid"],
  ["processing", "Paid"],
  ["cancelling", "Paid"],
  ["ready_for_pickup", "Ready for pickup"],
  ["delivered", "Collected"],
  ["cancelled", "Cancelled"],
])("statusLabel for a pickup order: %s reads %s", (status, label) => {
  expect(statusLabel(status, "pickup")).toBe(label);
});
