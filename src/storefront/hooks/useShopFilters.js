import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import { buildFamilyIndex } from "../../utility/attributeFamilies";
import { CURATED_SORT, sortByCuratedOrder, sortOptionsFor, sortOrderClause } from "./sortOptions";
import { formatSize } from "../lib/sizes";
import {
  buildAvailabilityArgs,
  colorCodesFor,
  computeAvailability,
  fabricCodesFor,
  mapAvailability,
} from "./shopAvailability";

const PAGE_SIZE = 24;

// A product-id scope (curated collection) is loaded whole: its filter options
// are computed client-side from every scoped variant, and the curated sort
// orders all of it in the browser before paging. That is only safe while the
// list stays far below PostgREST's 1000-row response cap (which would silently
// truncate it) and short enough for the `in` filter's GET URL.
export const MAX_SCOPED_PRODUCT_IDS = 200;

const SCOPE_OPTION_COLUMNS = "productid, categoryid, fabric, retailprice, productsizecolors(color, size)";

const INITIAL_FILTERS = {
  categories: [],
  colors: [],
  sizes: [],
  fabrics: [],
  priceMin: null,
  priceMax: null,
};

// Which filter options still have matching products, per dimension, computed
// in SQL by get_shop_available_options (each dimension ignores its own filter
// so selecting a colour never greys out other colours). Returns family-level
// Sets, or null on failure so the UI fails open (nothing greyed or hidden).
//
// The RPC can't filter by product id, so a product-id scope passes its loaded
// rows as `scopeRows` and the same computation runs locally (null rows = the
// scope failed to load, so fail open).
async function fetchAvailableOptions(filters, fabricIndex, colorIndex, scopeRows) {
  const args = buildAvailabilityArgs(filters, colorIndex.familyToCodes, fabricIndex.familyToCodes);
  if (scopeRows !== undefined) {
    if (!scopeRows) return null;
    return mapAvailability(
      computeAvailability(scopeRows, args),
      colorIndex.codeToFamilies,
      fabricIndex.codeToFamilies
    );
  }
  const { data, error } = await supabase.rpc("get_shop_available_options", args);
  if (error || !data) {
    console.error("useShopFilters: get_shop_available_options failed", { error, args });
    return null;
  }
  return mapAvailability(data, colorIndex.codeToFamilies, fabricIndex.codeToFamilies);
}

// A category page (e.g. Suits = ["ST", "RMS"]) limits every query to its
// categories until the shopper narrows further with the Category filter.
export function scopeFilters(filters, scopeCategoryIds) {
  if (!scopeCategoryIds?.length || filters.categories.length) return filters;
  return { ...filters, categories: scopeCategoryIds };
}

// A curated collection's product list, with every variant's colour/size, for
// local filter options. Null on failure.
async function fetchScopeRows(scopeProductIds) {
  const { data, error } = await supabase
    .from("products")
    .select(SCOPE_OPTION_COLUMNS)
    .in("productid", scopeProductIds);
  if (error || !data) {
    console.error("useShopFilters: scoped product options query failed", { error, scopeProductIds });
    return null;
  }
  return data;
}

// `scopeCategoryIds` / `scopeProductIds` must be stable for the hook's
// lifetime; callers remount (key) when they change.
export default function useShopFilters({ scopeCategoryIds = null, scopeProductIds = null } = {}) {
  if (scopeProductIds && scopeProductIds.length > MAX_SCOPED_PRODUCT_IDS) {
    throw new Error(
      `useShopFilters: scopeProductIds has ${scopeProductIds.length} ids; at most ${MAX_SCOPED_PRODUCT_IDS} are supported`
    );
  }

  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState(scopeProductIds ? CURATED_SORT : "newest");
  const [error, setError] = useState(null); // user-facing product load failure

  const [categoryOptions, setCategoryOptions] = useState([]);
  const [colorOptions, setColorOptions] = useState([]); // family names (filter buckets)
  const [colorFamilyHex, setColorFamilyHex] = useState({}); // family -> swatch hex
  const [sizeOptions, setSizeOptions] = useState([]);
  const [sizeDisplayMap, setSizeDisplayMap] = useState({});
  const [fabricOptions, setFabricOptions] = useState([]);
  const [priceBounds, setPriceBounds] = useState({ min: 0, max: 25000 });

  const [availableOptions, setAvailableOptions] = useState(null);
  const [baseOptions, setBaseOptions] = useState(null);
  const debounceRef = useRef(null);
  // Incremented per filter change; responses carrying an older id are stale.
  const availabilityRequestRef = useRef(0);
  // Product-list generation: bumped by every fresh (non-append) query. A
  // response from an older generation (superseded filters/sort, or a next
  // page requested before they changed) is discarded so it can't overwrite
  // or append to newer results.
  const queryGenerationRef = useRef(0);
  // fabric family <-> code maps, loaded once from the `fabrics` lookup. A ref
  // (not state) so the query callbacks read the latest without re-subscribing.
  const fabricIndexRef = useRef({ familyToCodes: {}, codeToFamilies: {} });
  // color maps: family -> [codes] (multi-family), code -> [families].
  const colorIndexRef = useRef({ familyToCodes: {}, codeToFamilies: {} });
  // Product-id scope rows for local availability; undefined = no such scope.
  const scopeRowsRef = useRef(undefined);

  useEffect(() => {
    async function fetchOptions() {
      // All filter vocabularies come from one RPC (get_shop_filter_options) in
      // a single round-trip. This replaces seven parallel anon queries whose
      // concurrent burst was what triggered Cloudflare's `__cf_bm` bot cookie.
      // The fetch layer (src/lib/supabaseFetch.js) adds timeout + retry; on
      // failure the filters simply stay at their defaults.
      const [{ data, error }, scopeRows] = await Promise.all([
        supabase.rpc("get_shop_filter_options"),
        scopeProductIds ? fetchScopeRows(scopeProductIds) : undefined,
      ]);
      scopeRowsRef.current = scopeRows;
      if (error || !data) return;

      // Inside a category page or curated list, offer only the categories it
      // covers, and none when there is just one (a single always-on checkbox
      // filters nothing).
      const scopeCategories = scopeProductIds
        ? (scopeRows || []).map((p) => p.categoryid)
        : scopeCategoryIds;
      const categories = data.categories || [];
      const scopedCategories = scopeCategories
        ? categories.filter((c) => scopeCategories.includes(c.categoryid))
        : categories;
      setCategoryOptions(scopedCategories.length > 1 || !scopeCategories ? scopedCategories : []);

      const colorFams = data.color_families || [];
      if (colorFams.length) {
        // Filter buckets = families, ordered by color_families.sort_order.
        setColorOptions(colorFams.map((f) => f.family));
        setColorFamilyHex(Object.fromEntries(colorFams.map((f) => [f.family, f.hex])));
      }

      const colorRows = data.colors || [];
      if (colorRows.length) {
        // Multi-family maps: a code lists 1..n families; each family gathers
        // every code that includes it, so filtering any family surfaces it.
        const familyToCodes = {};
        const codeToFamilies = {};
        colorRows.forEach(({ code, families }) => {
          const fams = families || [];
          codeToFamilies[code] = fams;
          fams.forEach((fam) => (familyToCodes[fam] ||= []).push(code));
        });
        colorIndexRef.current = { familyToCodes, codeToFamilies };
      }

      // Every distinct size code on any variant, including products the
      // storefront hides (no images). Sorted by the reference table order; the
      // list is narrowed to shop products below, once base availability lands.
      const rawSizes = (data.distinct_sizes || []).filter(Boolean);
      const sizeDefs = data.sizes || [];
      let sortedSizes;
      if (sizeDefs.length) {
        // Labels that are still raw codes ("XL|42") get the shared
        // customer-facing format; worded ones ("28 (Waist)") are kept.
        const displayMap = {};
        sizeDefs.forEach((s) => {
          displayMap[s.code] = s.label.includes("|") ? formatSize(s.code) : s.label;
        });
        setSizeDisplayMap(displayMap);

        const orderMap = Object.fromEntries(sizeDefs.map((s) => [s.code, s.sort_order]));
        sortedSizes = [...rawSizes].sort((a, b) => (orderMap[a] ?? 9999) - (orderMap[b] ?? 9999));
      } else {
        // Fallback if sizes reference table is empty
        sortedSizes = [...rawSizes].sort();
      }

      const fabrics = data.fabrics || [];
      if (fabrics.length) {
        // Multi-family: a fabric code lists 1..n families. Shared index builder;
        // the filter lists families ordered by member-code count (proxy volume).
        const { familyToCodes, codeToFamilies, orderedFamilies } = buildFamilyIndex(fabrics);
        fabricIndexRef.current = { familyToCodes, codeToFamilies };
        setFabricOptions(orderedFamilies);
      }

      if (data.price_max != null) {
        const max = Math.ceil(Number(data.price_max) / 500) * 500;
        setPriceBounds({ min: 0, max: max || 25000 });
      }

      // Base availability (no filters) hides options no shop product has, e.g.
      // reference sizes never stocked. Runs after the indices above are set
      // because code -> family mapping depends on them.
      const base = await fetchAvailableOptions(
        scopeFilters(INITIAL_FILTERS, scopeCategoryIds),
        fabricIndexRef.current,
        colorIndexRef.current,
        scopeRowsRef.current
      );
      setBaseOptions(base);
      // Sizes are published only now: the variant-size vocabulary spans every
      // product, mostly hidden ones, so showing it before base availability
      // flashed dozens of sizes no shop product has behind "View more". If
      // availability failed (null), fail open with the full list like the
      // other filters.
      setSizeOptions(base ? sortedSizes.filter((s) => base.sizes.has(s)) : sortedSizes);
    }
    fetchOptions();
  }, [scopeCategoryIds, scopeProductIds]);

  // Debounced server-side available options — fires only when filters are active
  useEffect(() => {
    // Any filter change invalidates in-flight requests, including the switch
    // back to "no filters" below, so a slow older response can't overwrite.
    const requestId = ++availabilityRequestRef.current;

    const hasActiveFilters =
      filters.categories.length > 0 ||
      filters.colors.length > 0 ||
      filters.sizes.length > 0 ||
      filters.fabrics.length > 0 ||
      filters.priceMin !== null ||
      filters.priceMax !== null;

    if (!hasActiveFilters) {
      setAvailableOptions(null);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const available = await fetchAvailableOptions(
        scopeFilters(filters, scopeCategoryIds),
        fabricIndexRef.current,
        colorIndexRef.current,
        scopeRowsRef.current
      );
      if (requestId !== availabilityRequestRef.current) return;
      setAvailableOptions(available);
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [filters, scopeCategoryIds]);

  const runQuery = useCallback(async (requestedFilters, currentOffset, append, currentSort) => {
    const currentFilters = scopeFilters(requestedFilters, scopeCategoryIds);
    const generation = append ? queryGenerationRef.current : ++queryGenerationRef.current;
    const isStale = () => generation !== queryGenerationRef.current;
    append ? setLoadingMore(true) : setLoading(true);

    try {
      // Colour/size live on variant rows. Filter them inside PostgREST with an
      // aliased inner embed instead of fetching matching product IDs first:
      // that ID list was capped at 1000 rows (of ~10.6k) and silently
      // truncated, and paging it would overflow the GET URL. Colour and size
      // apply to the same embedded row, so they must co-occur on one variant.
      // The plain `productsizecolors(stock)` embed stays unfiltered because the
      // Sold-out badge needs every variant's stock.
      let select =
        "productid, name, retailprice, producturl, fabric, categoryid, categories(name), productsizecolors(stock)";
      if (currentFilters.colors.length > 0 || currentFilters.sizes.length > 0)
        select += ", match:productsizecolors!inner(productid)";

      let query = supabase.from("products").select(select, { count: "exact" });

      if (scopeProductIds) query = query.in("productid", scopeProductIds);

      if (currentFilters.colors.length > 0)
        query = query.in(
          "match.color",
          colorCodesFor(currentFilters.colors, colorIndexRef.current.familyToCodes)
        );
      if (currentFilters.sizes.length > 0)
        query = query.in("match.size", currentFilters.sizes);
      if (currentFilters.categories.length > 0)
        query = query.in("categoryid", currentFilters.categories);
      if (currentFilters.priceMin !== null)
        query = query.gte("retailprice", currentFilters.priceMin);
      if (currentFilters.priceMax !== null)
        query = query.lte("retailprice", currentFilters.priceMax);
      if (currentFilters.fabrics.length > 0)
        query = query.in(
          "fabric",
          fabricCodesFor(currentFilters.fabrics, fabricIndexRef.current.familyToCodes)
        );

      // The database can't order by position in the curated list, so that
      // sort fetches the whole scope (bounded by MAX_SCOPED_PRODUCT_IDS) and
      // orders and pages it here.
      const curated = scopeProductIds && currentSort === CURATED_SORT;
      if (!curated) {
        const { column, ascending } = sortOrderClause(currentSort);
        query = query
          .order(column, { ascending })
          .range(currentOffset, currentOffset + PAGE_SIZE - 1);
      }

      const { data, count, error: queryError } = await query;
      if (isStale()) return;
      if (queryError) {
        console.error("useShopFilters: product query failed", {
          error: queryError,
          filters: currentFilters,
          offset: currentOffset,
          sort: currentSort,
        });
        setError("Couldn't load products.");
        // Stop infinite scroll from re-requesting a failing page, and don't
        // leave the previous filters' results on screen after a failed reload.
        setHasMore(false);
        if (!append) {
          setProducts([]);
          setTotalCount(0);
        }
        return;
      }

      const rows = data || [];
      const fetched = curated
        ? sortByCuratedOrder(rows, scopeProductIds).slice(currentOffset, currentOffset + PAGE_SIZE)
        : rows;
      setError(null);
      setProducts((prev) => (append ? [...prev, ...fetched] : fetched));
      setTotalCount(count || 0);
      setHasMore(curated ? currentOffset + PAGE_SIZE < rows.length : fetched.length === PAGE_SIZE);
    } finally {
      // A superseded query leaves the loading flags to the current one.
      if (!isStale()) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [scopeCategoryIds, scopeProductIds]);

  useEffect(() => {
    setOffset(0);
    runQuery(filters, 0, false, sortBy);
  }, [filters, sortBy, runQuery]);

  // Re-runs the current query from the first page (after a load failure).
  const retry = useCallback(() => {
    setOffset(0);
    runQuery(filters, 0, false, sortBy);
  }, [filters, runQuery, sortBy]);

  const fetchNextPage = useCallback(() => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    runQuery(filters, next, true, sortBy);
  }, [filters, offset, runQuery, sortBy]);

  const toggle = useCallback((field, value) => {
    setFilters((prev) => {
      const arr = prev[field];
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
      };
    });
  }, []);

  const setPrice = useCallback((min, max) => {
    setFilters((prev) => ({ ...prev, priceMin: min, priceMax: max }));
  }, []);

  const clearField = useCallback((field) => {
    setFilters((prev) => ({ ...prev, [field]: [] }));
  }, []);

  const clearAll = useCallback(() => setFilters(INITIAL_FILTERS), []);

  const clearOne = useCallback((field, value) => {
    if (field === "price") {
      setFilters((prev) => ({ ...prev, priceMin: null, priceMax: null }));
    } else {
      setFilters((prev) => ({
        ...prev,
        [field]: prev[field].filter((v) => v !== value),
      }));
    }
  }, []);

  const activeCount =
    filters.categories.length +
    filters.colors.length +
    filters.sizes.length +
    filters.fabrics.length +
    (filters.priceMin !== null || filters.priceMax !== null ? 1 : 0);

  return {
    filters,
    products,
    loading,
    loadingMore,
    hasMore,
    totalCount,
    fetchNextPage,
    sortBy,
    setSortBy,
    sortOptions: sortOptionsFor(Boolean(scopeProductIds)),
    toggle,
    setPrice,
    clearAll,
    clearOne,
    clearField,
    activeCount,
    categoryOptions,
    colorOptions,
    colorFamilyHex,
    sizeOptions,
    sizeDisplayMap,
    fabricOptions,
    priceBounds,
    availableOptions,
    baseOptions,
    error,
    retry,
  };
}
