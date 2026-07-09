// Pure helpers for families[]-based attribute vocabularies (colors, fabrics).
// A "row" is { code: string, families: string[] }.

// Build family<->code maps from attribute rows. orderedFamilies is sorted by
// member-code count desc, then name asc — used where no family table drives
// display order (fabric). Colors override order from color_families.sort_order.
export function buildFamilyIndex(rows) {
  const familyToCodes = {};
  const codeToFamilies = {};
  (rows || []).forEach(({ code, families }) => {
    const fams = families || [];
    codeToFamilies[code] = fams;
    fams.forEach((f) => (familyToCodes[f] ||= []).push(code));
  });
  const orderedFamilies = Object.keys(familyToCodes).sort(
    (a, b) =>
      familyToCodes[b].length - familyToCodes[a].length || a.localeCompare(b)
  );
  return { familyToCodes, codeToFamilies, orderedFamilies };
}

// Immutable chip toggle: add val if absent, remove if present.
export function toggleInArray(arr, val) {
  const set = new Set(arr || []);
  set.has(val) ? set.delete(val) : set.add(val);
  return [...set];
}
