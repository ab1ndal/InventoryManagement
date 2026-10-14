// Customer-facing size labels and ordering for variant size codes.
//
// Codes come from the `sizes` reference table: letter sizes pair the letter
// with the bust it fits in inches ("XL|42", matching the size guide), kids
// sizes pair age with a number ("10|30"), waist and plain kids sizes are bare
// numbers, plus a few special codes ("FREE-SIZE"). A "|0" suffix (baby
// sizes) carries no measurement and is dropped.

const SPECIAL_LABELS = {
  "FREE-SIZE": "Free Size",
  UNSTITCHED: "Unstitched",
  "SEMI-STITCHED": "Semi-stitched",
};

// "M" is 0; each step smaller/larger moves by one: S -1, XS -2, 2XS -3 …
// L 1, XL 2, 2XL 3 … Returns null for anything that is not a letter size.
function letterRank(letter) {
  if (letter === "M") return 0;
  if (letter === "S") return -1;
  if (letter === "L") return 1;
  const m = /^(\d*)X([SL])$/.exec(letter);
  if (!m) return null;
  const steps = 1 + (m[1] ? Number(m[1]) : 1);
  return m[2] === "S" ? -steps : steps;
}

/** @param {string} code e.g. "XL|42", "FREE-SIZE", "28" @returns {string} */
export function formatSize(code) {
  if (!code) return "";
  if (SPECIAL_LABELS[code]) return SPECIAL_LABELS[code];
  const [head, tail] = code.split("|");
  if (tail === undefined || tail === "0") return head;
  return `${head} (${tail})`;
}

// Letter sizes first (smallest to largest), then numeric sizes in number
// order, then special codes, then anything unrecognised alphabetically.
function sortKey(code) {
  const [head, tail] = String(code).split("|");
  const rank = letterRank(head);
  if (rank !== null) return [0, rank, 0];
  if (/^\d+$/.test(head)) return [1, Number(head), tail ? Number(tail) : 0];
  if (SPECIAL_LABELS[code]) return [2, Object.keys(SPECIAL_LABELS).indexOf(code), 0];
  return [3, 0, 0];
}

/** Comparator for Array.prototype.sort over size codes. */
export function compareSizes(a, b) {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return String(a).localeCompare(String(b));
}
