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
