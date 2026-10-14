import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import { buildFamilyIndex } from "../../utility/attributeFamilies";
import { sortOrderClause } from "./sortOptions";
import { colorCodesFor, fabricCodesFor } from "./shopAvailability";

const PAGE_SIZE = 24;

const INITIAL_FILTERS = {
  categories: [],
  colors: [],
  sizes: [],
  fabrics: [],
  priceMin: null,
  priceMax: null,
};

// Returns product IDs matching all filters except the excluded dimension.
// Mirrors the runQuery join logic so results are always consistent.
async function getMatchingPids(filters, excludeDim, fabricIndex, colorIndex) {
  const colors = excludeDim === "colors" ? [] : filters.colors;
  const sizes = excludeDim === "sizes" ? [] : filters.sizes;
  const categories = excludeDim === "categories" ? [] : filters.categories;
  const fabrics = excludeDim === "fabrics" ? [] : filters.fabrics;

  let productIds = null;
  if (colors.length > 0 || sizes.length > 0) {
    let q = supabase.from("productsizecolors").select("productid");
    if (colors.length > 0) q = q.in("color", colorCodesFor(colors, colorIndex.familyToCodes));
    if (sizes.length > 0) q = q.in("size", sizes);
    const { data } = await q;
    productIds = [...new Set((data || []).map((r) => r.productid))];
    if (productIds.length === 0) return [];
  }

  let q = supabase.from("products").select("productid");
  if (categories.length > 0) q = q.in("categoryid", categories);
  if (productIds !== null) q = q.in("productid", productIds);
  if (filters.priceMin !== null) q = q.gte("retailprice", filters.priceMin);
  if (filters.priceMax !== null) q = q.lte("retailprice", filters.priceMax);
  if (fabrics.length > 0)
    q = q.in("fabric", fabricCodesFor(fabrics, fabricIndex.familyToCodes));

  const { data } = await q;
  return (data || []).map((r) => r.productid);
}

async function fetchAvailableOptionsFromDB(filters, fabricIndex, colorIndex) {
  const [catPids, colorPids, sizePids, fabricPids] = await Promise.all([
    getMatchingPids(filters, "categories", fabricIndex, colorIndex),
    getMatchingPids(filters, "colors", fabricIndex, colorIndex),
    getMatchingPids(filters, "sizes", fabricIndex, colorIndex),
    getMatchingPids(filters, "fabrics", fabricIndex, colorIndex),
  ]);

  const [cats, colorRows, sizeRows, fabRows] = await Promise.all([
    catPids.length
      ? supabase.from("products").select("categoryid").in("productid", catPids)
      : Promise.resolve({ data: [] }),
    // Apply active size filter so colors returned co-occur with selected sizes
    colorPids.length
      ? (() => {
          let q = supabase.from("productsizecolors").select("color").in("productid", colorPids);
          if (filters.sizes.length) q = q.in("size", filters.sizes);
          return q;
        })()
      : Promise.resolve({ data: [] }),
    // Apply active color filter so sizes returned co-occur with selected colors
    sizePids.length
      ? (() => {
          let q = supabase.from("productsizecolors").select("size").in("productid", sizePids);
          if (filters.colors.length)
            q = q.in("color", colorCodesFor(filters.colors, colorIndex.familyToCodes));
          return q;
        })()
      : Promise.resolve({ data: [] }),
    fabricPids.length
      ? supabase.from("products").select("fabric").in("productid", fabricPids).not("fabric", "is", null)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    categories: new Set((cats.data || []).map((r) => r.categoryid).filter(Boolean)),
    // Color availability is in the filter's vocabulary — families — so map each
    // product color code up to every family it belongs to (multi-family).
    colors: new Set(
      (colorRows.data || []).flatMap((r) => colorIndex.codeToFamilies[r.color] || [])
    ),
    sizes: new Set((sizeRows.data || []).map((r) => r.size).filter(Boolean)),
    // Availability is expressed in the filter's own vocabulary — families, not
    // codes — so map each product's fabric code back up to its family.
    fabrics: new Set(
      (fabRows.data || [])
        .flatMap((r) => fabricIndex.codeToFamilies[r.fabric] || [])
        .filter(Boolean)
    ),
  };
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
  const debounceRef = useRef(null);
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

      // Distinct in-stock size codes, sorted by the reference table order.
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
    }
    fetchOptions();
  }, []);

  // Debounced server-side available options — fires only when filters are active
  useEffect(() => {
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
      const available = await fetchAvailableOptionsFromDB(
        filters,
        fabricIndexRef.current,
        colorIndexRef.current
      );
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

  const clearPrice = useCallback(() => {
    setFilters((prev) => ({ ...prev, priceMin: null, priceMax: null }));
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
    clearPrice,
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
    error,
    retry,
  };
}
