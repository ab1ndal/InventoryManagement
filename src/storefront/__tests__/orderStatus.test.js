import {
  PICKUP_TIMELINE_STEPS,
  TIMELINE_STEPS,
  completedStep,
  courierDisplayName,
  formatStepTime,
  isConfirmed,
  statusLabel,
  stepTimes,
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

test.each([
  ["2026-11-01T17:03:00Z", "1 Nov, 10:33 pm"],
  ["2026-11-01T17:03:00+00:00", "1 Nov, 10:33 pm"],
  // Past midnight in India, still the day before in UTC.
  ["2026-10-31T18:35:00Z", "1 Nov, 12:05 am"],
  ["2026-11-01T06:30:00Z", "1 Nov, 12:00 pm"],
  ["2026-11-01T03:45:00.123456+00:00", "1 Nov, 9:15 am"],
])("formatStepTime shows %s as %s, India time", (iso, text) => {
  expect(formatStepTime(iso)).toBe(text);
});

test.each([[null], [undefined], [""], ["not a date"]])("formatStepTime of %s is null", (iso) => {
  expect(formatStepTime(iso)).toBeNull();
});

test.each([
  ["Amazon Shipping Surface 1kg", "Amazon Shipping Surface"],
  ["Delhivery Surface 0.5 kg", "Delhivery Surface"],
  ["Xpressbees Air 2 KG", "Xpressbees Air"],
  ["Ekart Surface 500g", "Ekart Surface"],
  ["BlueDart - 10kgs", "BlueDart"],
  ["  Delhivery  ", "Delhivery"],
  ["Bindal's Creation", "Bindal's Creation"],
  ["Porter", "Porter"],
  ["DTDC 2 Day", "DTDC 2 Day"],
  ["", null],
  ["   ", null],
  [null, null],
  [undefined, null],
])("courierDisplayName(%s) is %s", (name, text) => {
  expect(courierDisplayName(name)).toBe(text);
});

describe("stepTimes", () => {
  const T = (hour) => `2026-11-01T${hour}:00:00Z`;

  it("maps statuses onto the six ship steps, null where the order skipped a step", () => {
    expect(stepTimes({ paid: T("01"), processed: T("02"), shipped: T("04") })).toEqual(
      [T("01"), T("02"), null, T("04"), null, null]
    );
  });

  it("uses the later of processing and processed for Processed", () => {
    expect(stepTimes({ processing: T("02"), processed: T("03") })[1]).toBe(T("03"));
    expect(stepTimes({ processing: T("05"), processed: T("03") })[1]).toBe(T("05"));
    expect(stepTimes({ processing: T("02") })[1]).toBe(T("02"));
  });

  it("maps statuses onto the three pickup steps", () => {
    expect(stepTimes({ paid: T("01"), ready_for_pickup: T("02"), delivered: T("03") }, "pickup")).toEqual(
      [T("01"), T("02"), T("03")]
    );
  });

  it.each([[null], [undefined], [{}]])("gives no times for %s, an order read before the deploy", (times) => {
    expect(stepTimes(times)).toEqual([null, null, null, null, null, null]);
  });
});
