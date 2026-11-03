import {
  STATUS_LABELS,
  deliveryLabel,
  hasOpenReturn,
  isOutsideUp,
  describeEvent,
  formatDateTime,
  istInputToIso,
  isManualCourier,
  manualNextSteps,
  nextStepIsStatus,
  nextStepLabel,
  normalizeOrderSearch,
  outsideReturnWindow,
  returnBadge,
  returnableUnits,
  timelineRows,
  toISTInputValue,
  windowLabel,
} from "../orderHelpers";

const D = "2026-10-20T10:00:00Z";
const at = (iso) => iso;

test("windowLabel: change of mind counts days of 7", () => {
  expect(windowLabel("change_of_mind", D, at("2026-10-20T11:00:00Z"))).toBe("Day 1 of 7");
  expect(windowLabel("change_of_mind", D, at("2026-10-21T20:00:00Z"))).toBe("Day 2 of 7");
  expect(windowLabel("change_of_mind", D, at("2026-10-27T10:00:00Z"))).toBe("Day 7 of 7");
});

test("windowLabel: damaged/wrong counts hours of 48", () => {
  expect(windowLabel("damaged_wrong", D, at("2026-10-21T15:30:00Z"))).toBe("Hour 30 of 48");
  expect(windowLabel("damaged_wrong", D, at("2026-10-22T10:00:00Z"))).toBe("Hour 48 of 48");
});

test("outside the window: label overshoots and outsideReturnWindow is true", () => {
  expect(windowLabel("damaged_wrong", D, at("2026-10-22T11:00:00Z"))).toBe("Hour 49 of 48");
  expect(outsideReturnWindow("damaged_wrong", D, at("2026-10-22T11:00:00Z"))).toBe(true);
  expect(outsideReturnWindow("damaged_wrong", D, at("2026-10-22T10:00:00Z"))).toBe(false);
  expect(windowLabel("change_of_mind", D, at("2026-10-28T10:00:01Z"))).toBe("Day 9 of 7");
  expect(outsideReturnWindow("change_of_mind", D, at("2026-10-28T10:00:01Z"))).toBe(true);
  expect(windowLabel("change_of_mind", null, D)).toBe("");
});

const ret = (status, received) => ({ status, items: [{ item_id: "i1", units: 2, received_units: received }] });

test("returnBadge: null, partly, full", () => {
  const base = { order_items: [{ shipped_qty: 3 }] };
  expect(returnBadge({ ...base, returns: [] })).toBeNull();
  expect(returnBadge({ ...base, returns: [ret("open", 0), ret("rejected", 0)] })).toBeNull();
  expect(returnBadge({ ...base, returns: [ret("refunded", 2)] })).toBe("Partly returned");
  expect(returnBadge({ ...base, returns: [ret("refunded", 2), ret("refunded", 1)] })).toBe("Returned");
});

test("returnableUnits: shipped minus open units minus refunded received units", () => {
  const item = { id: "i1", shipped_qty: 5 };
  expect(returnableUnits(item, [])).toBe(5);
  expect(returnableUnits(item, [ret("open", 0), ret("refunded", 1), ret("cancelled", 0)])).toBe(2);
  expect(returnableUnits({ id: "i2", shipped_qty: 1 }, [ret("open", 0)])).toBe(1);
});

test("isOutsideUp: flags any state other than Uttar Pradesh", () => {
  expect(isOutsideUp({ state: "Uttar Pradesh", pincode: "201001" })).toBe(false);
  expect(isOutsideUp({ state: " uttar pradesh " })).toBe(false);
  expect(isOutsideUp({ state: "Maharashtra", pincode: "400001" })).toBe(true);
  expect(isOutsideUp({ state: "Uttarakhand", pincode: "263001" })).toBe(true);
  expect(isOutsideUp({})).toBe(false);
  expect(isOutsideUp(null)).toBe(false);
});

test("isOutsideUp: never for a pickup order", () => {
  expect(isOutsideUp({ name: "Asha", phone: "+919999999999" }, "pickup")).toBe(false);
  expect(isOutsideUp({ state: "Maharashtra" }, "pickup")).toBe(false);
  expect(isOutsideUp({ state: "Maharashtra" }, "ship")).toBe(true);
});

test("ready_for_pickup has a label", () => {
  expect(STATUS_LABELS.ready_for_pickup).toBe("Ready for pickup");
});

test("isManualCourier: porter and self only", () => {
  expect(isManualCourier("porter")).toBe(true);
  expect(isManualCourier("self")).toBe(true);
  expect(isManualCourier("shiprocket")).toBe(false);
  expect(isManualCourier(null)).toBe(false);
});

test("manualNextSteps: the remaining steps of a manual order, in order", () => {
  const packed = { key: "packed", label: "Packed" };
  const pickedUp = { key: "shipped", label: "Picked up" };
  const out = { key: "out_for_delivery", label: "Out for delivery" };
  const delivered = { key: "delivered", label: "Delivered" };
  expect(manualNextSteps("processed")).toEqual([packed, pickedUp, out, delivered]);
  expect(manualNextSteps("packed")).toEqual([pickedUp, out, delivered]);
  expect(manualNextSteps("shipped")).toEqual([out, delivered]);
  expect(manualNextSteps("out_for_delivery")).toEqual([delivered]);
  for (const status of ["paid", "processing", "delivered", "cancelled", "rto"]) {
    expect(manualNextSteps(status)).toEqual([]);
  }
});

test("describeEvent: manual stage events read as words", () => {
  expect(describeEvent({ kind: "processed", data: {} }).label).toBe("Processed");
  expect(describeEvent({ kind: "out_for_delivery", data: {} }).label).toBe("Out for delivery");
  expect(describeEvent({ kind: "x", from_status: "paid", to_status: "processed", data: {} }).status).toBe("Processed");
});

// WEB-000006 (2026-10-30): raw kinds and same-status arrows, with nine identical retries.
test("timelineRows: readable labels, status changes, details, repeats collapsed", () => {
  const err = { step: "sr_create_failed", data: { error: "/orders/create/adhoc: Oops! Invalid Data." } };
  const ev = (id, kind, from, to, data, minute) => ({
    id, kind, from_status: from, to_status: to, data, created_at: `2026-10-30T17:${minute}:00Z`,
  });
  const rows = timelineRows([
    ev(1, "created", null, "pending_payment", {}, "04"),
    ev(2, "checkpoint", "pending_payment", "pending_payment", { step: "cf_order", data: { cf_order_id: "7" } }, "04"),
    ev(3, "paid", "pending_payment", "paid", { amount: 110 }, "05"),
    ev(4, "checkpoint", "processing", "processing", err, "14"),
    ev(5, "checkpoint", "processing", "processing", err, "24"),
    ev(6, "checkpoint", "processing", "processing", err, "42"),
    ev(7, "job_failed", null, null, { kind: "shiprocket_create", error: "sr_create: boom" }, "50"),
  ]);
  expect(rows.map((r) => [r.label, r.detail, r.status, r.count])).toEqual([
    ["Order placed", "", "Awaiting payment", 1],
    ["Payment page created", "", "", 1],
    ["Payment received", "₹110.00", "To check", 1],
    ["Shiprocket order failed", "/orders/create/adhoc: Oops! Invalid Data.", "", 3],
    ["Background task gave up", "Create Shiprocket order: sr_create: boom", "", 1],
  ]);
  expect(rows[3].lastAt).toBe("2026-10-30T17:42:00Z");
});

test("timelineRows: unknown kinds and steps fall back to readable text", () => {
  const rows = timelineRows([
    { id: 1, kind: "some_new_kind", data: null, created_at: D },
    { id: 2, kind: "checkpoint", data: { step: "new_step" }, created_at: D },
    { id: 3, kind: "refund_leg_processing", data: {}, created_at: D },
  ]);
  expect(rows.map((r) => r.label)).toEqual(["Some new kind", "New step", "Refund processing"]);
});

describe("nextStepLabel", () => {
  test.each([
    [{ status: "paid", fulfilment: "ship" }, "Check shelf and process"],
    [{ status: "paid", fulfilment: "pickup" }, "Check shelf"],
    [{ status: "processing" }, "Being booked"],
    [{ status: "cancelling" }, "Cancelling"],
    [{ status: "processed", courier: "porter" }, "Mark packed"],
    [{ status: "packed", courier: "porter" }, "Mark picked up"],
    [{ status: "packed", courier: "self" }, "Mark picked up"],
    [{ status: "packed", courier: "shiprocket" }, "Waiting for courier pickup"],
    [{ status: "packed", courier: null }, "Waiting for courier pickup"],
    [{ status: "ready_for_pickup", fulfilment: "pickup" }, "Waiting for customer"],
    [{ status: "shipped", courier: "porter" }, "Mark out for delivery"],
    [{ status: "out_for_delivery", courier: "self" }, "Mark delivered"],
    [{ status: "shipped", courier: "shiprocket" }, "With courier"],
    [{ status: "out_for_delivery", courier: "shiprocket" }, "With courier"],
    [{ status: "rto" }, "Receive returned parcel"],
  ])("%j: %s", (order, label) => {
    expect(nextStepLabel(order)).toBe(label);
    expect(nextStepIsStatus(order)).toBe(false);
  });

  test.each([
    [{ status: "delivered" }, "Delivered"],
    [{ status: "delivered", fulfilment: "pickup" }, "Collected"],
    [{ status: "cancelled" }, "Cancelled"],
    [{ status: "rto_received" }, "RTO received"],
    [{ status: "pending_payment" }, "Awaiting payment"],
    [{ status: "payment_failed" }, "Payment failed"],
    [{ status: "expired" }, "Expired"],
  ])("no step left, %j shows the status label", (order, label) => {
    expect(nextStepLabel(order)).toBe(label);
    expect(nextStepIsStatus(order)).toBe(true);
  });

  test("every known status has a label", () => {
    for (const status of Object.keys(STATUS_LABELS)) {
      expect(nextStepLabel({ status })).toBeTruthy();
    }
  });

  test.each([{ problem: "Lost" }, { process_error: "Courier down" }])("%j overrides the step", (extra) => {
    expect(nextStepLabel({ status: "paid", ...extra })).toBe("Needs attention");
    expect(nextStepLabel({ status: "delivered", ...extra })).toBe("Needs attention");
    expect(nextStepIsStatus({ status: "delivered", ...extra })).toBe(false);
  });
});

test.each([
  [{ fulfilment: "pickup", courier: null }, "Pickup"],
  [{ fulfilment: "ship", courier: "porter" }, "Porter"],
  [{ fulfilment: "ship", courier: "self" }, "Self delivery"],
  [{ fulfilment: "ship", courier: "shiprocket" }, "Shiprocket"],
  [{ fulfilment: "ship", courier: null, awb: "123" }, "Shiprocket"],
  [{ fulfilment: "ship", courier: null, awb: null }, null],
])("deliveryLabel %j: %s", (order, label) => {
  expect(deliveryLabel(order)).toBe(label);
});

test("normalizeOrderSearch trims, caps at 100 and treats blank as empty", () => {
  expect(normalizeOrderSearch("  a b  ")).toBe("a b");
  expect(normalizeOrderSearch("   ")).toBe("");
  expect(normalizeOrderSearch(undefined)).toBe("");
  expect(normalizeOrderSearch("x".repeat(101))).toHaveLength(100);
});

test("hasOpenReturn sees only open returns", () => {
  expect(hasOpenReturn({ returns: [{ status: "open" }] })).toBe(true);
  expect(hasOpenReturn({ returns: [{ status: "refunded" }] })).toBe(false);
  expect(hasOpenReturn({})).toBe(false);
});

// Shop days roll over at 18:30 UTC, so this instant falls on the 21st in IST but the 20th in the Americas.
test("formatDateTime shows IST whatever the browser zone", () => {
  expect(formatDateTime("2026-10-20T20:15:00Z")).toMatch(/^21 Oct.*01:45 am$/i);
  expect(formatDateTime(null)).toBe("—");
});

test("toISTInputValue writes the IST wall clock", () => {
  expect(toISTInputValue(new Date("2026-10-20T20:15:30Z"))).toBe("2026-10-21T01:45");
});

test("istInputToIso reads the text as IST", () => {
  expect(istInputToIso("2026-10-21T01:45")).toBe("2026-10-20T20:15:00.000Z");
  expect(istInputToIso("")).toBeNull();
  expect(istInputToIso("not a date")).toBeNull();
});
