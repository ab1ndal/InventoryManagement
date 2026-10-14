// The store's own size labels (the `sizes` table): each letter size carries
// the bust it fits in inches, e.g. "XL|42". Many pieces are free-size or
// unstitched, so customers are pointed to WhatsApp for a specific garment.

export const MEASURE_INTRO = [
  "Measure your bust over your undergarments, around the fullest part of the chest, keeping the tape snug but not tight.",
  "Pick the size whose number matches your bust in inches. Between two sizes, choose the larger one.",
  "Many of our pieces are free-size or unstitched. For a specific garment's fit or blouse stitching, message us on WhatsApp before you buy.",
];

// Bust each size fits, in inches. Matches the codes in the `sizes` table.
export const SIZE_CHART = [
  { size: "2XS", bust: 32 },
  { size: "XS", bust: 34 },
  { size: "S", bust: 36 },
  { size: "M", bust: 38 },
  { size: "L", bust: 40 },
  { size: "XL", bust: 42 },
  { size: "2XL", bust: 44 },
  { size: "3XL", bust: 46 },
  { size: "4XL", bust: 48 },
  { size: "5XL", bust: 50 },
  { size: "6XL", bust: 52 },
];
