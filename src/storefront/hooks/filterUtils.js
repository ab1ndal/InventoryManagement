function matchExcluding(entry, filters, exclude) {
  if (exclude !== "categories" && filters.categories.length > 0) {
    if (!filters.categories.includes(entry.categoryid)) return false;
  }
  if (exclude !== "fabrics" && filters.fabrics.length > 0) {
    if (!filters.fabrics.includes(entry.fabric)) return false;
  }
  if (exclude !== "price") {
    if (filters.priceMin !== null && entry.retailprice < filters.priceMin) return false;
    if (filters.priceMax !== null && entry.retailprice > filters.priceMax) return false;
  }
  if (exclude !== "colors" && filters.colors.length > 0) {
    if (!entry.colors.some((c) => filters.colors.includes(c))) return false;
  }
  if (exclude !== "sizes" && filters.sizes.length > 0) {
    if (!entry.sizes.some((s) => filters.sizes.includes(s))) return false;
  }
  return true;
}

export function computeAvailableOptions(catalogIndex, filters) {
  if (!catalogIndex.length) {
    return { categories: new Set(), colors: new Set(), sizes: new Set(), fabrics: new Set() };
  }

  const cats = new Set();
  const colors = new Set();
  const sizes = new Set();
  const fabrics = new Set();

  for (const entry of catalogIndex) {
    if (matchExcluding(entry, filters, "categories")) cats.add(entry.categoryid);
    if (matchExcluding(entry, filters, "colors")) entry.colors.forEach((c) => colors.add(c));
    if (matchExcluding(entry, filters, "sizes")) entry.sizes.forEach((s) => sizes.add(s));
    if (matchExcluding(entry, filters, "fabrics") && entry.fabric) fabrics.add(entry.fabric);
  }

  return { categories: cats, colors, sizes, fabrics };
}

export function sortByAvailability(items, getKey, availableSet) {
  if (!availableSet) return items;
  return [...items].sort((a, b) => {
    const aAvail = availableSet.has(getKey(a));
    const bAvail = availableSet.has(getKey(b));
    if (aAvail === bAvail) return 0;
    return aAvail ? -1 : 1;
  });
}
