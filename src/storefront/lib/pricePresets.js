// Shop price presets. useShopFilters applies `gte(retailprice, min)` and
// `lte(retailprice, max)` — both inclusive — so each preset's max sits one
// rupee below the next preset's min. Retail prices are whole rupees, so the
// ranges tile every price exactly once: a ₹5,000 piece lands in
// "₹5,000 – ₹10,000", not also in "₹2,000 – ₹5,000".
export const PRICE_PRESETS = [
  { label: "Under ₹2,000", min: null, max: 1999 },
  { label: "₹2,000 – ₹5,000", min: 2000, max: 4999 },
  { label: "₹5,000 – ₹10,000", min: 5000, max: 9999 },
  { label: "Above ₹10,000", min: 10000, max: null },
];

// Index of the preset whose bounds equal the current price filter, or -1.
export function activePresetIndex(priceMin, priceMax) {
  const min = priceMin ?? null;
  const max = priceMax ?? null;
  if (min === null && max === null) return -1;
  return PRICE_PRESETS.findIndex((p) => p.min === min && p.max === max);
}
