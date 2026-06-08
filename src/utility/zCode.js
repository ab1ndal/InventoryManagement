const DIGIT_TO_LETTER = {
  1: "A",
  2: "B",
  3: "C",
  4: "D",
  5: "E",
  6: "F",
  7: "G",
  8: "H",
  9: "I",
  0: "Z",
};

const LETTER_TO_DIGIT = Object.fromEntries(
  Object.entries(DIGIT_TO_LETTER).map(([digit, letter]) => [letter, digit])
);

export function encodePriceToZCode(price) {
  const digits = Number(price || 0)
    .toString()
    .split("");
  return "Z" + digits.map((d) => DIGIT_TO_LETTER[d] ?? "Z").join("");
}

export function decodeZCodeToPrice(code) {
  const s = String(code || "").toUpperCase().trim();
  if (!s.startsWith("Z") || s.length < 2) return Number(s) || 0;
  const digits = s
    .slice(1)
    .split("")
    .map((l) => LETTER_TO_DIGIT[l] ?? "0")
    .join("");
  return Number(digits) || 0;
}
