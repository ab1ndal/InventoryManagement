// Pure helpers for client-initiated product search. Kept separate from the
// hook so the query-building logic is unit-testable without mocking Supabase.

export const SEARCH_MIN_CHARS = 2;

// PostgREST `.or()` uses commas to separate conditions and parentheses for
// `in.()` lists, and ilike treats `%`/`_` as wildcards. Strip those so raw user
// input can't break the filter syntax or inject accidental wildcards.
export function sanitizeSearchQuery(raw) {
  return (raw || "")
    .replace(/[%_,()*\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
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

// Build the PostgREST `.or()` filter: product name substring OR (when any
// category name matched) membership in those category ids.
export function buildNameCategoryOr(clean, categoryIds) {
  const conditions = [`name.ilike.%${clean}%`];
  if (categoryIds && categoryIds.length) {
    conditions.push(`categoryid.in.(${categoryIds.join(",")})`);
  }
  return conditions.join(",");
}
