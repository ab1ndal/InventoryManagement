import { assertEquals } from "@std/assert";
import { parcelWeightKg } from "./shipping.ts";

Deno.test("heaviest unit + 0.5 kg per extra unit", () => {
  assertEquals(parcelWeightKg(["Lehenga", "Kurti", "Kurti"]), 3);
  assertEquals(parcelWeightKg(["Kurti"]), 0.5);
  assertEquals(parcelWeightKg(["Saree", "Kurti"]), 1.5);
});

Deno.test("capped at 5 kg", () => {
  assertEquals(parcelWeightKg(Array(12).fill("Saree")), 5);
});

Deno.test("matches names and ids case-insensitively", () => {
  assertEquals(parcelWeightKg(["lehenga"]), 2);
  assertEquals(parcelWeightKg(["LE"]), 2);
  assertEquals(parcelWeightKg([" SHERWANI "]), 2);
  assertEquals(parcelWeightKg(["Suit (3 Pc)"]), 2);
  assertEquals(parcelWeightKg(["t-shirt"]), 0.5);
  assertEquals(parcelWeightKg(["kur"]), 0.5);
});

Deno.test("unknown or missing category is medium", () => {
  assertEquals(parcelWeightKg(["Dupatta"]), 1);
  assertEquals(parcelWeightKg([null]), 1);
  assertEquals(parcelWeightKg([""]), 1);
});

Deno.test("empty parcel weighs 0", () => {
  assertEquals(parcelWeightKg([]), 0);
});
