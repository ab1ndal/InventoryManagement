import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import { buildFamilyIndex } from "../../utility/attributeFamilies";
import { sortOrderClause } from "./sortOptions";
import {
  buildAvailabilityArgs,
  colorCodesFor,
  fabricCodesFor,
  mapAvailability,
} from "./shopAvailability";

const PAGE_SIZE = 24;

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
async function fetchAvailableOptions(filters, fabricIndex, colorIndex) {
  const args = buildAvailabilityArgs(filters, colorIndex.familyToCodes, fabricIndex.familyToCodes);
  const { data, error } = await supabase.rpc("get_shop_available_options", args);
  if (error || !data) {
    console.error("useShopFilters: get_shop_available_options failed", { error, args });
    return null;
  }
  return mapAvailability(data, colorIndex.codeToFamilies, fabricIndex.codeToFamilies);
}

export default function useShopFilters() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState("newest");
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
  // fabric family <-> code maps, loaded once from the `fabrics` lookup. A ref
  // (not state) so the query callbacks read the latest without re-subscribing.
  const fabricIndexRef = useRef({ familyToCodes: {}, codeToFamilies: {} });
  // color maps: family -> [codes] (multi-family), code -> [families].
  const colorIndexRef = useRef({ familyToCodes: {}, codeToFamilies: {} });

  useEffect(() => {
    async function fetchOptions() {
      // All filter vocabularies come from one RPC (get_shop_filter_options) in
      // a single round-trip. This replaces seven parallel anon queries whose
      // concurrent burst was what triggered Cloudflare's `__cf_bm` bot cookie.
      // The fetch layer (src/lib/supabaseFetch.js) adds timeout + retry; on
      // failure the filters simply stay at their defaults.
      const { data, error } = await supabase.rpc("get_shop_filter_options");
      if (error || !data) return;

      setCategoryOptions(data.categories || []);

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

      // Every distinct size code on any variant (no stock or storefront
      // visibility filter; baseOptions hides the ones no shop product has),
      // sorted by the reference table order.
      const rawSizes = (data.distinct_sizes || []).filter(Boolean);
      const sizeDefs = data.sizes || [];
      if (sizeDefs.length) {
        // `sizes.label` is the canonical display string — the stored code
        // already encodes letter+numeric (e.g. "S|36"), so use label directly.
        const displayMap = {};
        sizeDefs.forEach((s) => {
          displayMap[s.code] = s.label;
        });
        setSizeDisplayMap(displayMap);

        const orderMap = Object.fromEntries(sizeDefs.map((s) => [s.code, s.sort_order]));
        setSizeOptions([...rawSizes].sort((a, b) => (orderMap[a] ?? 9999) - (orderMap[b] ?? 9999)));
      } else {
        // Fallback if sizes reference table is empty
        setSizeOptions([...rawSizes].sort());
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
      setBaseOptions(
        await fetchAvailableOptions(INITIAL_FILTERS, fabricIndexRef.current, colorIndexRef.current)
      );
    }
    fetchOptions();
  }, []);

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
        filters,
        fabricIndexRef.current,
        colorIndexRef.current
      );
      if (requestId !== availabilityRequestRef.current) return;
      setAvailableOptions(available);
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [filters]);

  const runQuery = useCallback(async (currentFilters, currentOffset, append, currentSort) => {
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

      const { column, ascending } = sortOrderClause(currentSort);
      query = query
        .order(column, { ascending })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      const { data, count, error: queryError } = await query;
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

      const fetched = data || [];
      setError(null);
      setProducts((prev) => (append ? [...prev, ...fetched] : fetched));
      setTotalCount(count || 0);
      setHasMore(fetched.length === PAGE_SIZE);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

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
