/**
 * Parcel weight for Shiprocket (spec §12). There are no per-product weights,
 * so each unit gets a class from its category: light 0.5 kg, medium 1 kg,
 * heavy 2 kg. Parcel = the sum of its units (owner 2026-10-30: multiple items
 * stack on weight; the old "heaviest + 0.5 kg per extra unit" undercharged).
 * Unknown or missing category → medium.
 *
 * Keys are the live `categories` names and ids (e.g. "Lehenga" / "LE"),
 * matched case-insensitively, so callers may pass either.
 */

export const LIGHT_KG = 0.5;
export const MEDIUM_KG = 1;
export const HEAVY_KG = 2;

export type Package = { lengthCm: number; breadthCm: number; heightCm: number };

// Assumed sizes (owner, 2026-10-26: nothing shipped yet, no packaging bought).
// Replace with measured packed parcels after the first test shipments.
const SMALL_BAG: Package = { lengthCm: 30, breadthCm: 40, heightCm: 4 };
const LARGE_BAG: Package = { lengthCm: 40, breadthCm: 50, heightCm: 5 };
const BOX: Package = { lengthCm: 45, breadthCm: 35, heightCm: 12 };

/** Couriers bill the greater of dead weight and L × B × H (cm) / 5000. */
const VOLUMETRIC_DIVISOR = 5000;

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
  return categories.reduce((sum, c) => sum + unitWeightKg(c), 0);
}

/**
 * Packaging for the heaviest unit's class: light → small bag, medium → large bag, heavy → box.
 * One package whatever the count: with two or more units the summed dead weight
 * already exceeds these packages' volumetric weight, so it is what gets billed.
 */
export function parcelPackage(categories: (string | null)[]): Package {
  const heaviest = Math.max(0, ...categories.map(unitWeightKg));
  if (heaviest >= HEAVY_KG) return BOX;
  if (heaviest >= MEDIUM_KG) return LARGE_BAG;
  return SMALL_BAG;
}

/**
 * Weight the courier bills: the greater of dead and volumetric weight. The
 * checkout rate lookup sends weight only, so quoting dead weight would price a
 * bulky parcel a slab or more below what Shiprocket charges.
 */
export function chargeableWeightKg(categories: (string | null)[]): number {
  const p = parcelPackage(categories);
  return Math.max(parcelWeightKg(categories), (p.lengthCm * p.breadthCm * p.heightCm) / VOLUMETRIC_DIVISOR);
}

/**
 * Charge when Shiprocket gives no rate (outage, timeout, no pincode yet), by
 * chargeable weight. Highest cheapest-courier freight anywhere in UP from
 * 201001 (API, 11 cities: ≤5 kg 2026-10-29, 5–10 kg 2026-10-30) rounded up to
 * ₹10, so the fallback never undercharges freight (owner rule); nearby pincodes
 * pay a little more. Above 10 kg the top slab applies (no sample; rare cart).
 */
const FALLBACK_SLABS: { upToKg: number; charge: number }[] = [
  { upToKg: 0.5, charge: 90 },
  { upToKg: 1, charge: 140 },
  { upToKg: 2, charge: 150 },
  { upToKg: 3, charge: 180 },
  { upToKg: 5, charge: 230 },
  { upToKg: 6, charge: 270 },
  { upToKg: 7, charge: 310 },
  { upToKg: 10, charge: 360 },
];

export function fallbackShippingCharge(weightKg: number): number {
  const slab = FALLBACK_SLABS.find((s) => weightKg <= s.upToKg);
  return (slab ?? FALLBACK_SLABS[FALLBACK_SLABS.length - 1]).charge;
}

/**
 * Fallback outside Uttar Pradesh (owner 2026-10-30: deliver anywhere in India),
 * by chargeable weight. Highest cheapest-courier freight from 201001 across 16
 * cities (incl. Mumbai, Chennai, Guwahati, Srinagar, Port Blair; API sample
 * 2026-10-30) rounded up to ₹10 and made non-decreasing, so it never
 * undercharges freight. 5–6 kg is the 6 kg sample (max ₹1,301.40); above 6 kg
 * the top slab applies (no sample; rare cart).
 */
const FALLBACK_SLABS_INDIA: { upToKg: number; charge: number }[] = [
  { upToKg: 0.5, charge: 150 },
  { upToKg: 1, charge: 250 },
  { upToKg: 1.5, charge: 360 },
  { upToKg: 2, charge: 470 },
  { upToKg: 2.5, charge: 550 },
  { upToKg: 3, charge: 660 },
  { upToKg: 3.5, charge: 770 },
  { upToKg: 4, charge: 870 },
  { upToKg: 4.5, charge: 980 },
  { upToKg: 5, charge: 1090 },
  { upToKg: 6, charge: 1310 },
];

export function fallbackShippingChargeIndia(weightKg: number): number {
  const slab = FALLBACK_SLABS_INDIA.find((s) => weightKg <= s.upToKg);
  return (slab ?? FALLBACK_SLABS_INDIA[FALLBACK_SLABS_INDIA.length - 1]).charge;
}
