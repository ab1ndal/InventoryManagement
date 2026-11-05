// Who a category is made for, for structured data and the shopping feed. Only categories whose name
// or the shop's own collections say so are listed. Anything else is left out, never guessed: unisex
// or ambiguous categories (shirts, jeans, dupattas, fabric lengths) have no entry on purpose.

const WOMEN = ["LE", "SA", "LG", "SHR", "LCH", "GWN", "KUR", "DRS", "PL", "CRD", "RMS", "SKT-TOP", "ST"];
// Men's ethnic wear as the shop's Men collection and the "Gents" categories name it.
const MEN = ["SW", "KP", "SK", "NHJ", "SJ-2P", "SJ-3P", "S2P", "S5P", "GD", "GSFa", "GMala"];
// The existing kids' categories are all described as boys' wear.
const BOYS = ["C-KP", "C-S5P", "C-IW", "C-SW", "C-S3P"];
// Kids' category ids start "C-". A future one is kids even before its gender is added above.
const KIDS_PREFIX = "C-";

const AUDIENCE = {
  ...Object.fromEntries(WOMEN.map((id) => [id, { gender: "female", ageGroup: "adult" }])),
  ...Object.fromEntries(MEN.map((id) => [id, { gender: "male", ageGroup: "adult" }])),
  ...Object.fromEntries(BOYS.map((id) => [id, { gender: "male", ageGroup: "kids" }])),
};

/** @returns {{gender?: "female"|"male", ageGroup?: "adult"|"kids"}} empty when the category implies neither */
export function categoryAudience(categoryid) {
  if (AUDIENCE[categoryid]) return AUDIENCE[categoryid];
  return String(categoryid ?? "").startsWith(KIDS_PREFIX) ? { ageGroup: "kids" } : {};
}
