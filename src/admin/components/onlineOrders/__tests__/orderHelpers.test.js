import {
  STATUS_LABELS,
  isOutsideUp,
  isValidTrackingUrl,
  outsideReturnWindow,
  returnBadge,
  returnableUnits,
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

test("isValidTrackingUrl: https only, no spaces, at most 500 chars", () => {
  expect(isValidTrackingUrl("https://porter.in/track/abc")).toBe(true);
  expect(isValidTrackingUrl("http://porter.in/track/abc")).toBe(false);
  expect(isValidTrackingUrl("javascript:alert(1)")).toBe(false);
  expect(isValidTrackingUrl("https://porter.in/a b")).toBe(false);
  expect(isValidTrackingUrl("https://p.in/" + "a".repeat(500))).toBe(false);
});
