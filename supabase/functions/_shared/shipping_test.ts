import { assertEquals } from "@std/assert";
import { chargeableWeightKg, parcelPackage, parcelWeightKg } from "./shipping.ts";

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

Deno.test("package follows the heaviest unit's class", () => {
  const small = { lengthCm: 30, breadthCm: 40, heightCm: 4 };
  const large = { lengthCm: 40, breadthCm: 50, heightCm: 5 };
  const box = { lengthCm: 45, breadthCm: 35, heightCm: 12 };
  assertEquals(parcelPackage(["Kurti", "Kurti"]), small);
  assertEquals(parcelPackage(["Saree", "Kurti"]), large);
  assertEquals(parcelPackage(["Lehenga", "Kurti"]), box);
  assertEquals(parcelPackage([null]), large);
  assertEquals(parcelPackage([]), small);
});

Deno.test("chargeable weight is the greater of dead and volumetric (L × B × H / 5000)", () => {
  assertEquals(chargeableWeightKg(["Kurti"]), 0.96); // small bag 0.96 > 0.5 dead
  assertEquals(chargeableWeightKg(["Kurti", "Kurti", "Kurti"]), 1.5); // dead 1.5 > 0.96
  assertEquals(chargeableWeightKg(["Saree"]), 2); // large bag 2.0 > 1 dead
  assertEquals(chargeableWeightKg(["Lehenga"]), 3.78); // box 3.78 > 2 dead
  assertEquals(chargeableWeightKg(Array(12).fill("Lehenga")), 5); // dead capped at 5 > 3.78
});
