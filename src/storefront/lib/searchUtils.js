// Pure helpers for client-initiated product search. Kept separate from the
// hook so the query-building logic is unit-testable without mocking Supabase.

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_WORDS = 6;
// Each colour word adds one inner join to the query; two covers "red blue".
export const SEARCH_MAX_COLOUR_WORDS = 2;

// PostgREST `.or()` uses commas to separate conditions and parentheses for
// `in.()` lists, and ilike treats `%`/`_` as wildcards. Strip those (and quote
// characters) so raw user input can't break the filter syntax or inject
// accidental wildcards.
export function sanitizeSearchQuery(raw) {
  return (raw || "")
    .replace(/[%_,()*\\"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Spellings customers use, mapped to one word that appears in the catalogue.
// Kurti and kurta stay apart: they are different categories.
const SYNONYM_GROUPS = {
  saree: ["sari", "saris", "saree", "sarees", "sarie", "saaree"],
  lehenga: ["lehnga", "lehngas", "lengha", "lenghas", "lehanga", "lehenga", "lehengas", "lahenga"],
  kurti: ["kurti", "kurtis", "kurtee"],
  kurta: ["kurta", "kurtas"],
  suit: ["suit", "suits"],
  gown: ["gown", "gowns"],
  sherwani: ["sherwani", "sherwanis", "shervani", "shervanis"],
  anarkali: ["anarkali", "anarkalis", "anarkalee"],
  child: ["kid", "kids", "child", "children", "kiddies"],
};
const SYNONYM_LOOKUP = Object.fromEntries(
  Object.entries(SYNONYM_GROUPS).flatMap(([canonical, spellings]) =>
    spellings.map((s) => [s, canonical])
  )
);

// Lower-cases, maps known spellings to one form, and otherwise drops a plural
// "s"/"es" so "dupattas" finds "dupatta". Words with digits (product codes)
// are left alone.
export function normaliseWord(word) {
  const w = (word || "").toLowerCase();
  if (SYNONYM_LOOKUP[w]) return SYNONYM_LOOKUP[w];
  if (/\d/.test(w) || w.length <= 3) return w;
  if (/(sses|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// Words of a sanitised query, normalised, without repeats or single letters.
export function splitSearchWords(clean) {
  const words = (clean || "")
    .split(" ")
    .map(normaliseWord)
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, SEARCH_MAX_WORDS);
}

// Product ids look like BC25001; matched whole and case-insensitively.
export function isProductCode(word) {
  return /^[a-z]{1,4}\d{4,}$/i.test(word || "");
}

// Category names live in a separate table; match the (small) category list
// client-side and return the ids to fold into the products query.
export function matchCategoryIds(clean, categories) {
  if (!clean) return [];
  const needle = clean.toLowerCase();
  return (categories || [])
    .filter((c) => (c.name || "").toLowerCase().includes(needle))
    .map((c) => c.categoryid);
}

// A word counts as a colour when it is a colour family ("red", "white" for
// White/Cream) or exactly a colour name ("maroon"). Returns every colour code
// in that family so "red" finds Maroon Red, Wine Red and the like; [] when the
// word is not a colour. Looser matching would turn "print" or "check" (parts of
// names like "Black Print") into colours.
export function matchColourCodes(word, colours) {
  const needle = (word || "").toLowerCase();
  if (!needle) return [];
  const rows = colours || [];
  const inFamily = (c) =>
    (c.families || []).some((f) => f.toLowerCase().split("/").includes(needle));
  const families = rows.filter(inFamily);
  if (families.length) return families.map((c) => c.code);
  return rows.filter((c) => c.code.toLowerCase() === needle).map((c) => c.code);
}

// One PostgREST `.or()` group for a text word: it must appear in the name,
// display title, description or fabric, or in a matching category. Digit words
// may also be (part of) a product id; a full code matches the id exactly.
export function buildWordOr(word, categoryIds) {
  const conditions = [
    `name.ilike.%${word}%`,
    `display_title.ilike.%${word}%`,
    `description.ilike.%${word}%`,
    `fabric.ilike.%${word}%`,
  ];
  if (/\d/.test(word)) {
    conditions.push(isProductCode(word) ? `productid.ilike.${word}` : `productid.ilike.%${word}%`);
  }
  if (categoryIds && categoryIds.length) {
    conditions.push(`categoryid.in.(${categoryIds.join(",")})`);
  }
  return conditions.join(",");
}

// Every word must match (AND). Colour words become variant colour filters
// (colour lives on product variants); the rest become `.or()` groups.
export function buildSearchFilters(clean, { categories, colours }) {
  const orGroups = [];
  const colourFilters = [];
  splitSearchWords(clean).forEach((word) => {
    const codes =
      colourFilters.length < SEARCH_MAX_COLOUR_WORDS ? matchColourCodes(word, colours) : [];
    if (codes.length) {
      colourFilters.push({ alias: `colour${colourFilters.length}`, codes });
    } else {
      orGroups.push(buildWordOr(word, matchCategoryIds(word, categories)));
    }
  });
  return { orGroups, colourFilters };
}
