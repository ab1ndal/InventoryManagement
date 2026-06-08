// Canonical ordering for letter-based apparel sizes; anything else falls back
// to numeric or locale comparison. Sizes in the DB also show up as composites
// like "S|36" or "M|0" (letter + numeric sub-measurement) and free-size labels
// like "FREE-SIZE" / "Free-Size".
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
  "7XL",
];

const FREE_SIZE_ALIASES = new Set(["FREE-SIZE", "FREE SIZE", "FREESIZE"]);

const normalize = (size) => String(size ?? "").trim().toUpperCase();

function parseSize(size) {
  const norm = normalize(size);
  if (FREE_SIZE_ALIASES.has(norm)) {
    return {
      free: true,
      letterIdx: -1,
      numeric: null,
      secondary: null,
      raw: norm,
    };
  }

  const [primaryRaw, secondaryRaw] = norm.split("|");
  const primary = (primaryRaw ?? "").trim();
  const secondary = secondaryRaw !== undefined ? Number(secondaryRaw) : null;

  const letterIdx = SIZE_ORDER.indexOf(primary);
  const numericPrimary = Number(primary);

  return {
    free: false,
    letterIdx,
    numeric: Number.isNaN(numericPrimary) ? null : numericPrimary,
    secondary: Number.isNaN(secondary) ? null : secondary,
    raw: norm,
  };
}

export function compareSizes(a, b) {
  const pa = parseSize(a);
  const pb = parseSize(b);

  // Free-size sorts after all measured sizes.
  if (pa.free || pb.free) {
    if (pa.free && pb.free) return 0;
    return pa.free ? 1 : -1;
  }

  const aIsLetter = pa.letterIdx !== -1;
  const bIsLetter = pb.letterIdx !== -1;

  if (aIsLetter && bIsLetter) {
    if (pa.letterIdx !== pb.letterIdx) return pa.letterIdx - pb.letterIdx;
    return (pa.secondary ?? 0) - (pb.secondary ?? 0);
  }

  // Mixed letter vs. numeric scheme (shouldn't normally co-occur within a
  // product) — keep letter-labelled sizes first for a stable, predictable order.
  if (aIsLetter !== bIsLetter) return aIsLetter ? -1 : 1;

  if (pa.numeric !== null && pb.numeric !== null) {
    if (pa.numeric !== pb.numeric) return pa.numeric - pb.numeric;
    return (pa.secondary ?? 0) - (pb.secondary ?? 0);
  }

  return pa.raw.localeCompare(pb.raw, undefined, { numeric: true });
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
