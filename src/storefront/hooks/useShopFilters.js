import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "lib/supabaseClient";

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
async function getMatchingPids(filters, excludeDim) {
  const colors = excludeDim === "colors" ? [] : filters.colors;
  const sizes = excludeDim === "sizes" ? [] : filters.sizes;
  const categories = excludeDim === "categories" ? [] : filters.categories;
  const fabrics = excludeDim === "fabrics" ? [] : filters.fabrics;

  let productIds = null;
  if (colors.length > 0 || sizes.length > 0) {
    let q = supabase.from("productsizecolors").select("productid");
    if (colors.length > 0) q = q.in("color", colors);
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
  if (fabrics.length > 0) q = q.in("fabric", fabrics);

  const { data } = await q;
  return (data || []).map((r) => r.productid);
}

async function fetchAvailableOptionsFromDB(filters) {
  const [catPids, colorPids, sizePids, fabricPids] = await Promise.all([
    getMatchingPids(filters, "categories"),
    getMatchingPids(filters, "colors"),
    getMatchingPids(filters, "sizes"),
    getMatchingPids(filters, "fabrics"),
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
          if (filters.colors.length) q = q.in("color", filters.colors);
          return q;
        })()
      : Promise.resolve({ data: [] }),
    fabricPids.length
      ? supabase.from("products").select("fabric").in("productid", fabricPids).not("fabric", "is", null)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    categories: new Set((cats.data || []).map((r) => r.categoryid).filter(Boolean)),
    colors: new Set((colorRows.data || []).map((r) => r.color).filter(Boolean)),
    sizes: new Set((sizeRows.data || []).map((r) => r.size).filter(Boolean)),
    fabrics: new Set((fabRows.data || []).map((r) => r.fabric).filter(Boolean)),
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

  const [categoryOptions, setCategoryOptions] = useState([]);
  const [colorOptions, setColorOptions] = useState([]);
  const [sizeOptions, setSizeOptions] = useState([]);
  const [sizeDisplayMap, setSizeDisplayMap] = useState({});
  const [fabricOptions, setFabricOptions] = useState([]);
  const [priceBounds, setPriceBounds] = useState({ min: 0, max: 25000 });

  const [availableOptions, setAvailableOptions] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    async function fetchOptions() {
      const [cats, variants, fabrics, priceRange, distinctSizes, sizeDefs] = await Promise.all([
        supabase.from("categories").select("categoryid, name").order("name"),
        supabase.from("productsizecolors").select("color").limit(50000),
        supabase.from("products").select("fabric").not("fabric", "is", null).limit(10000),
        supabase
          .from("products")
          .select("retailprice")
          .order("retailprice", { ascending: false })
          .limit(1),
        supabase.rpc("get_distinct_sizes"),
        supabase.from("sizes").select("code, label, size_type, numeric_in, sort_order"),
      ]);

      setCategoryOptions(cats.data || []);

      if (variants.data) {
        const colors = [...new Set(variants.data.map((r) => r.color).filter(Boolean))].sort();
        setColorOptions(colors);
      }

      if (sizeDefs.data) {
        // Build letter↔numeric cross-reference for display
        const letterByNumeric = {};
        const numericByLetter = {};
        sizeDefs.data.forEach((s) => {
          if (s.size_type === "letter" && s.numeric_in) {
            letterByNumeric[s.numeric_in] = s.code;
            numericByLetter[s.code] = s.numeric_in;
          }
        });

        // Build display label map
        const displayMap = {};
        sizeDefs.data.forEach((s) => {
          if (s.size_type === "letter" && numericByLetter[s.code]) {
            displayMap[s.code] = `${s.code} / ${numericByLetter[s.code]}`;
          } else if ((s.size_type === "chest" || s.size_type === "waist") && letterByNumeric[s.numeric_in]) {
            displayMap[s.code] = `${s.code} / ${letterByNumeric[s.numeric_in]}`;
          } else {
            displayMap[s.code] = s.label;
          }
        });
        setSizeDisplayMap(displayMap);

        // Use RPC distinct sizes; sort by reference table order, unknowns last
        const rawSizes = (distinctSizes.data || []).map((r) => r.size).filter(Boolean);
        const orderMap = Object.fromEntries(sizeDefs.data.map((s) => [s.code, s.sort_order]));
        setSizeOptions(rawSizes.sort((a, b) => (orderMap[a] ?? 9999) - (orderMap[b] ?? 9999)));
      } else {
        // Fallback if sizes table unavailable
        const rawSizes = (distinctSizes.data || []).map((r) => r.size).filter(Boolean);
        setSizeOptions(rawSizes.sort());
      }

      if (fabrics.data) {
        setFabricOptions(
          [...new Set(fabrics.data.map((r) => r.fabric).filter(Boolean))].sort()
        );
      }

      if (priceRange.data?.[0]) {
        const max = Math.ceil(Number(priceRange.data[0].retailprice) / 500) * 500;
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
      const available = await fetchAvailableOptionsFromDB(filters);
      setAvailableOptions(available);
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [filters]);

  const runQuery = useCallback(async (currentFilters, currentOffset, append) => {
    append ? setLoadingMore(true) : setLoading(true);

    try {
      let productIds = null;

      if (currentFilters.colors.length > 0 || currentFilters.sizes.length > 0) {
        let q = supabase.from("productsizecolors").select("productid");
        if (currentFilters.colors.length > 0) q = q.in("color", currentFilters.colors);
        if (currentFilters.sizes.length > 0) q = q.in("size", currentFilters.sizes);
        const { data } = await q;
        productIds = [...new Set((data || []).map((r) => r.productid))];
        if (productIds.length === 0) {
          setProducts([]);
          setTotalCount(0);
          setHasMore(false);
          return;
        }
      }

      let query = supabase
        .from("products")
        .select(
          "productid, name, retailprice, producturl, fabric, categoryid, categories(name)",
          { count: "exact" }
        );

      if (currentFilters.categories.length > 0)
        query = query.in("categoryid", currentFilters.categories);
      if (productIds !== null)
        query = query.in("productid", productIds);
      if (currentFilters.priceMin !== null)
        query = query.gte("retailprice", currentFilters.priceMin);
      if (currentFilters.priceMax !== null)
        query = query.lte("retailprice", currentFilters.priceMax);
      if (currentFilters.fabrics.length > 0)
        query = query.in("fabric", currentFilters.fabrics);

      query = query
        .order("productid", { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      const { data, count } = await query;
      const fetched = data || [];

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
    runQuery(filters, 0, false);
  }, [filters, runQuery]);

  const fetchNextPage = useCallback(() => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    runQuery(filters, next, true);
  }, [filters, offset, runQuery]);

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
    toggle,
    setPrice,
    clearAll,
    clearOne,
    clearPrice,
    clearField,
    activeCount,
    categoryOptions,
    colorOptions,
    sizeOptions,
    sizeDisplayMap,
    fabricOptions,
    priceBounds,
    availableOptions,
  };
}
