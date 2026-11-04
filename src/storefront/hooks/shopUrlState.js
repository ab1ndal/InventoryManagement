// Shop filters and sort live in the URL, so Back restores them and a filtered list can be shared. Pure, so
// the rules for reading a link anyone could have edited are testable. The canonical tag ignores all of
// this: it is always the bare page (components/Seo.jsx, src/seoRender/pages.js).

const LIST_PARAMS = { categories: "category", colors: "color", sizes: "size", fabrics: "fabric" };
const PRICE_PARAMS = { priceMin: "min", priceMax: "max" };
const SORT_PARAM = "sort";

function readPrice(params, name) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// Picking a category or size replaces the page's scope (scopeFilters), so a link must not use one from
// outside it to show lehengas on the sarees page.
export function readFilters(params, { scopeCategoryIds = null, scopeSizes = null } = {}) {
  const list = (field) => [...new Set(params.getAll(LIST_PARAMS[field]).filter(Boolean))];
  const within = (values, scope) => (scope?.length ? values.filter((v) => scope.includes(v)) : values);
  return {
    categories: within(list("categories"), scopeCategoryIds),
    colors: list("colors"),
    sizes: within(list("sizes"), scopeSizes),
    fabrics: list("fabrics"),
    priceMin: readPrice(params, PRICE_PARAMS.priceMin),
    priceMax: readPrice(params, PRICE_PARAMS.priceMax),
  };
}

// Leaves every other parameter alone: ad and campaign tags must survive a filter change.
export function writeFilters(params, filters) {
  const next = new URLSearchParams(params);
  Object.entries(LIST_PARAMS).forEach(([field, name]) => {
    next.delete(name);
    filters[field].forEach((value) => next.append(name, value));
  });
  Object.entries(PRICE_PARAMS).forEach(([field, name]) => {
    next.delete(name);
    if (filters[field] !== null) next.set(name, String(filters[field]));
  });
  return next;
}

export function readSort(params, options, defaultSort) {
  const value = params.get(SORT_PARAM);
  return options.some((o) => o.value === value) ? value : defaultSort;
}

// The default stays out of the URL, so an untouched list keeps its plain address.
export function writeSort(params, sort, defaultSort) {
  const next = new URLSearchParams(params);
  if (sort === defaultSort) next.delete(SORT_PARAM);
  else next.set(SORT_PARAM, sort);
  return next;
}
