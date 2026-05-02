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

  const needColors = exclude !== "colors" && filters.colors.length > 0;
  const needSizes = exclude !== "sizes" && filters.sizes.length > 0;

  if (needColors || needSizes) {
    const variants = entry.variants || [];
    const hasMatch = variants.some((v) => {
      if (needColors && !filters.colors.includes(v.color)) return false;
      if (needSizes && !filters.sizes.includes(v.size)) return false;
      return true;
    });
    if (!hasMatch) return false;
  }

  return true;
}

export function computeAvailableOptions(catalogIndex, filters) {
  if (!catalogIndex || !catalogIndex.length) {
    return { categories: new Set(), colors: new Set(), sizes: new Set(), fabrics: new Set() };
  }

  const cats = new Set();
  const colors = new Set();
  const sizes = new Set();
  const fabrics = new Set();

  for (const entry of catalogIndex) {
    const variants = entry.variants || [];
    if (matchExcluding(entry, filters, "categories")) cats.add(entry.categoryid);
    if (matchExcluding(entry, filters, "colors")) {
      // collect colors from variants that satisfy the size filter (if active)
      const needSizes = filters.sizes.length > 0;
      variants.forEach((v) => {
        if (needSizes && !filters.sizes.includes(v.size)) return;
        if (v.color) colors.add(v.color);
      });
    }
    if (matchExcluding(entry, filters, "sizes")) {
      // collect sizes from variants that satisfy the color filter (if active)
      const needColors = filters.colors.length > 0;
      variants.forEach((v) => {
        if (needColors && !filters.colors.includes(v.color)) return;
        if (v.size) sizes.add(v.size);
      });
    }
    if (matchExcluding(entry, filters, "fabrics") && entry.fabric) fabrics.add(entry.fabric);
  }

  return { categories: cats, colors, sizes, fabrics };
}

export function sortByAvailability(items, getKey, availableSet) {
  if (!availableSet) return items;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const aAvail = availableSet.has(getKey(a.item));
      const bAvail = availableSet.has(getKey(b.item));
      if (aAvail !== bAvail) return aAvail ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ item }) => item);
}
