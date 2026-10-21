// Pure helpers for the /shop filter queries and the availability RPC
// (get_shop_available_options). Kept free of Supabase/React so they are unit
// testable; useShopFilters wires them to the client.

// The fabric filter operates on families ("Group Name"), but products store the
// trade-name code. Expand selected families to their member codes for the query.
// Sentinel keeps an empty expansion from matching every row (Supabase `.in([])`,
// or a NULL RPC arg, would mean "unfiltered").
export function fabricCodesFor(families, familyToCodes) {
  const codes = [...new Set(families.flatMap((f) => familyToCodes[f] || []))];
  return codes.length ? codes : ["__no_match__"];
}

// Color works the same way, but a code can belong to several families
// (multi-family). Expanding a family yields every code that lists it.
export function colorCodesFor(families, familyToCodes) {
  const codes = [...new Set(families.flatMap((f) => familyToCodes[f] || []))];
  return codes.length ? codes : ["__no_match__"];
}

// RPC args for get_shop_available_options. NULL means "dimension not
// filtered"; an empty array would instead match nothing, so never send one.
export function buildAvailabilityArgs(filters, colorFamilyToCodes, fabricFamilyToCodes) {
  return {
    p_categories: filters.categories.length ? filters.categories : null,
    p_color_codes: filters.colors.length ? colorCodesFor(filters.colors, colorFamilyToCodes) : null,
    p_sizes: filters.sizes.length ? filters.sizes : null,
    p_fabric_codes: filters.fabrics.length
      ? fabricCodesFor(filters.fabrics, fabricFamilyToCodes)
      : null,
    p_price_min: filters.priceMin,
    p_price_max: filters.priceMax,
  };
}

// The RPC returns raw codes; the filter UI speaks families. Map each colour /
// fabric code up to every family it belongs to (multi-family). Codes without a
// family can't be shown as an option, so they are dropped.
export function mapAvailability(raw, colorCodeToFamilies, fabricCodeToFamilies) {
  return {
    categories: new Set(raw.categories || []),
    colors: new Set((raw.color_codes || []).flatMap((c) => colorCodeToFamilies[c] || [])),
    sizes: new Set(raw.sizes || []),
    fabrics: new Set((raw.fabric_codes || []).flatMap((c) => fabricCodeToFamilies[c] || [])),
  };
}

// Client-side twin of get_shop_available_options for a product-id scope
// (curated collections), which the RPC can't filter by. `rows` are the scoped
// products with their variants (`productsizecolors(color, size)`); `args` are
// buildAvailabilityArgs output. Same semantics as the SQL: each dimension
// ignores its own filter, colour and size match on one variant row, and the
// result has the RPC's raw shape for mapAvailability.
export function computeAvailability(rows, args) {
  const { p_categories, p_color_codes, p_sizes, p_fabric_codes, p_price_min, p_price_max } = args;
  const inList = (list, value) => list == null || list.includes(value);
  const base = rows.filter(
    (p) =>
      (p_price_min == null || p.retailprice >= p_price_min) &&
      (p_price_max == null || p.retailprice <= p_price_max)
  );
  const variantsOf = (p) => p.productsizecolors || [];
  const hasVariantMatch = (p) =>
    (p_color_codes == null && p_sizes == null) ||
    variantsOf(p).some((v) => inList(p_color_codes, v.color) && inList(p_sizes, v.size));
  const distinct = (values) => [...new Set(values.filter((v) => v != null))];

  return {
    categories: distinct(
      base.filter((p) => inList(p_fabric_codes, p.fabric) && hasVariantMatch(p)).map((p) => p.categoryid)
    ),
    fabric_codes: distinct(
      base.filter((p) => inList(p_categories, p.categoryid) && hasVariantMatch(p)).map((p) => p.fabric)
    ),
    color_codes: distinct(
      base
        .filter((p) => inList(p_categories, p.categoryid) && inList(p_fabric_codes, p.fabric))
        .flatMap((p) => variantsOf(p).filter((v) => inList(p_sizes, v.size)).map((v) => v.color))
    ),
    sizes: distinct(
      base
        .filter((p) => inList(p_categories, p.categoryid) && inList(p_fabric_codes, p.fabric))
        .flatMap((p) => variantsOf(p).filter((v) => inList(p_color_codes, v.color)).map((v) => v.size))
    ),
  };
}
