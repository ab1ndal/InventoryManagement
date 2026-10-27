/**
 * Parcel weight for Shiprocket (spec §12). There are no per-product weights,
 * so each unit gets a class from its category: light 0.5 kg, medium 1 kg,
 * heavy 2 kg. Parcel = heaviest unit + 0.5 kg per extra unit, capped at 5 kg.
 * Unknown or missing category → medium.
 *
 * Keys are the live `categories` names and ids (e.g. "Lehenga" / "LE"),
 * matched case-insensitively, so callers may pass either.
 */

export const LIGHT_KG = 0.5;
export const MEDIUM_KG = 1;
export const HEAVY_KG = 2;
export const EXTRA_UNIT_KG = 0.5;
export const MAX_PARCEL_KG = 5;

/** Spec §12: one standard box for every parcel. */
export const PARCEL_LENGTH_CM = 32;
export const PARCEL_BREADTH_CM = 28;
export const PARCEL_HEIGHT_CM = 5;
/** Couriers bill the greater of dead weight and L × B × H (cm) / 5000. */
const VOLUMETRIC_DIVISOR = 5000;
const BOX_VOLUMETRIC_KG = (PARCEL_LENGTH_CM * PARCEL_BREADTH_CM * PARCEL_HEIGHT_CM) / VOLUMETRIC_DIVISOR;

const LIGHT = [
  "Kurti", "KUR",
  "Short Kurta", "SK",
  "Shirt", "SHT",
  "Tops", "TOP",
  "T-Shirt", "T-SHT",
];

const MEDIUM = [
  "Saree", "SA",
  "Suits", "ST",
  "Readymade Suits", "RMS",
  "Kurta Pajama", "KP",
  "Kurta-Pajama (Child)", "C-KP",
  "Gown", "GWN",
  "Dress", "DRS",
  "Cord Sets", "CRD",
];

// "Suit sets" in the spec = the men's multi-piece suits.
const HEAVY = [
  "Lehenga", "LE",
  "Sherwani", "SW",
  "Sherwani (Child)", "C-SW",
  "Suit (2 Pc)", "S2P",
  "Suit (3 Pc)", "S3P",
  "Suit (5 Pc)", "S5P",
  "Suit (Jodhpuri) - 2Pc", "SJ-2P",
  "Suit (Jodhpuri) - 3Pc", "SJ-3P",
  "3 Pc Suit (Child)", "C-S3P",
  "5 Pc Suit (Child)", "C-S5P",
];

const WEIGHT_BY_CATEGORY = new Map<string, number>([
  ...LIGHT.map((c) => [c.toLowerCase(), LIGHT_KG] as const),
  ...MEDIUM.map((c) => [c.toLowerCase(), MEDIUM_KG] as const),
  ...HEAVY.map((c) => [c.toLowerCase(), HEAVY_KG] as const),
]);

function unitWeightKg(category: string | null): number {
  if (!category) return MEDIUM_KG;
  return WEIGHT_BY_CATEGORY.get(category.trim().toLowerCase()) ?? MEDIUM_KG;
}

/** `categories` has one entry per unit (repeat a category for qty > 1). */
export function parcelWeightKg(categories: (string | null)[]): number {
  if (categories.length === 0) return 0;
  const heaviest = Math.max(...categories.map(unitWeightKg));
  return Math.min(MAX_PARCEL_KG, heaviest + EXTRA_UNIT_KG * (categories.length - 1));
}

/**
 * Weight the courier bills for a parcel in the standard box. The checkout
 * rate lookup sends weight only, so without this floor a 0.5 kg parcel is
 * quoted a slab below what Shiprocket charges for the 0.896 kg box.
 */
export function chargeableWeightKg(deadWeightKg: number): number {
  return Math.max(deadWeightKg, BOX_VOLUMETRIC_KG);
}
