// Canonical ordering for letter-based apparel sizes; anything else falls back
// to numeric or locale comparison.
const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
];

const FREE_SIZE_ALIASES = new Set(["FREE-SIZE", "FREE SIZE", "FREESIZE"]);

const normalize = (size) => String(size ?? "").trim().toUpperCase();

export function compareSizes(a, b) {
  const normA = normalize(a);
  const normB = normalize(b);

  const isFreeA = FREE_SIZE_ALIASES.has(normA);
  const isFreeB = FREE_SIZE_ALIASES.has(normB);
  if (isFreeA || isFreeB) {
    if (isFreeA && isFreeB) return 0;
    return isFreeA ? 1 : -1;
  }

  const idxA = SIZE_ORDER.indexOf(normA);
  const idxB = SIZE_ORDER.indexOf(normB);
  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
  if (idxA !== -1) return -1;
  if (idxB !== -1) return 1;

  const numA = Number(normA);
  const numB = Number(normB);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;

  return normA.localeCompare(normB, undefined, { numeric: true });
}

export function compareColors(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    sensitivity: "base",
  });
}

export function compareVariantsBySizeColor(a, b) {
  return compareSizes(a?.size, b?.size) || compareColors(a?.color, b?.color);
}

export function sortVariantsBySizeColor(variants) {
  return [...(variants || [])].sort(compareVariantsBySizeColor);
}
