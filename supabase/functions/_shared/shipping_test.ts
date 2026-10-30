import { assertEquals } from "@std/assert";
import {
  chargeableWeightKg,
  fallbackShippingCharge,
  fallbackShippingChargeIndia,
  parcelPackage,
  parcelWeightKg,
} from "./shipping.ts";

Deno.test("units stack: parcel weight is the sum of every unit", () => {
  assertEquals(parcelWeightKg(["Lehenga", "Kurti", "Kurti"]), 3);
  assertEquals(parcelWeightKg(["Kurti"]), 0.5);
  assertEquals(parcelWeightKg(["Saree", "Kurti"]), 1.5);
  assertEquals(parcelWeightKg(["Lehenga", "Lehenga", "Lehenga"]), 6);
});

Deno.test("no cap on parcel weight", () => {
  assertEquals(parcelWeightKg(Array(12).fill("Saree")), 12);
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
  assertEquals(chargeableWeightKg(["Lehenga", "Lehenga"]), 4); // dead 4 > 3.78
  assertEquals(chargeableWeightKg(["Saree", "Saree", "Saree"]), 3); // dead 3 > large bag 2.0
});

Deno.test("fallback charge follows the chargeable-weight slab", () => {
  assertEquals(fallbackShippingCharge(0.5), 90);
  assertEquals(fallbackShippingCharge(0.96), 140);
  assertEquals(fallbackShippingCharge(1), 140);
  assertEquals(fallbackShippingCharge(2), 150);
  assertEquals(fallbackShippingCharge(2.01), 180);
  assertEquals(fallbackShippingCharge(3.78), 230);
  assertEquals(fallbackShippingCharge(5), 230);
  assertEquals(fallbackShippingCharge(5.5), 270);
  assertEquals(fallbackShippingCharge(6), 270);
  assertEquals(fallbackShippingCharge(7), 310);
  assertEquals(fallbackShippingCharge(10), 360);
});

Deno.test("fallback charge for the real parcel classes", () => {
  assertEquals(fallbackShippingCharge(chargeableWeightKg(["Kurti"])), 140);
  assertEquals(fallbackShippingCharge(chargeableWeightKg(["Saree"])), 150);
  assertEquals(fallbackShippingCharge(chargeableWeightKg(["Lehenga"])), 230);
});

Deno.test("fallback charge for stacked parcels", () => {
  assertEquals(fallbackShippingCharge(chargeableWeightKg(["Lehenga", "Lehenga", "Lehenga"])), 270);
});

Deno.test("fallback charge above 10 kg uses the top slab", () => {
  assertEquals(fallbackShippingCharge(12), 360);
});

Deno.test("national fallback charge follows the chargeable-weight slab", () => {
  assertEquals(fallbackShippingChargeIndia(0.5), 150);
  assertEquals(fallbackShippingChargeIndia(0.96), 250);
  assertEquals(fallbackShippingChargeIndia(1.5), 360);
  assertEquals(fallbackShippingChargeIndia(2), 470);
  assertEquals(fallbackShippingChargeIndia(2.5), 550);
  assertEquals(fallbackShippingChargeIndia(3), 660);
  assertEquals(fallbackShippingChargeIndia(3.5), 770);
  assertEquals(fallbackShippingChargeIndia(3.78), 870);
  assertEquals(fallbackShippingChargeIndia(4.5), 980);
  assertEquals(fallbackShippingChargeIndia(5), 1090);
  assertEquals(fallbackShippingChargeIndia(5.01), 1310);
  assertEquals(fallbackShippingChargeIndia(12), 1310);
});
