import { assertEquals } from "@std/assert";
import { mapShipmentStatus } from "./tracking.ts";

Deno.test("maps shipment-scheme ids", () => {
  assertEquals(mapShipmentStatus(7), "delivered");
  assertEquals(mapShipmentStatus(17), "out_for_delivery");
  for (const id of [42, 6, 18, 38, 22]) assertEquals(mapShipmentStatus(id), "shipped");
  for (const id of [9, 10, 14]) assertEquals(mapShipmentStatus(id), "rto");
  for (const id of [8, 45]) assertEquals(mapShipmentStatus(id), "cancelled");
});

Deno.test("R15 problem ids", () => {
  for (const id of [12, 21, 24, 25, 40, 41, 46, 76, 78]) {
    assertEquals(mapShipmentStatus(id), "problem");
  }
});

Deno.test("unknown and non-moving ids map to null", () => {
  // 1 AWB Assigned, 19 Out For Pickup, 20 order-scheme In Transit, 999 unknown
  for (const id of [1, 2, 5, 19, 20, 999, -1, Number.NaN]) {
    assertEquals(mapShipmentStatus(id), null);
  }
});
