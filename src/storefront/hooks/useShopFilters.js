import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import { buildFamilyIndex } from "../../utility/attributeFamilies";

const PAGE_SIZE = 24;

const INITIAL_FILTERS = {
  categories: [],
  colors: [],
  sizes: [],
  fabrics: [],
  priceMin: null,
  priceMax: null,
};

// The fabric filter operates on families ("Group Name"), but products store the
// trade-name code. Expand selected families to their member codes for the query.
// Sentinel keeps an empty expansion from matching every row (Supabase `.in([])`).
function fabricCodesFor(families, familyToCodes) {
  const codes = [...new Set(families.flatMap((f) => familyToCodes[f] || []))];
  return codes.length ? codes : ["__no_match__"];
}

// Color works the same way, but a code can belong to several families
// (multi-family). Expanding a family yields every code that lists it.
function colorCodesFor(families, familyToCodes) {
  const codes = [...new Set(families.flatMap((f) => familyToCodes[f] || []))];
  return codes.length ? codes : ["__no_match__"];
}

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
      const [cats, colorRows, colorFams, fabrics, priceRange, distinctSizes, sizeDefs] = await Promise.all([
        supabase.from("categories").select("categoryid, name").order("name"),
        supabase.from("colors").select("code, families"),
        supabase.from("color_families").select("family, hex, sort_order").order("sort_order"),
        supabase.from("fabrics").select("code, families"),
        supabase
          .from("products")
          .select("retailprice")
          .order("retailprice", { ascending: false })
          .limit(1),
        supabase.rpc("get_distinct_sizes"),
        supabase.from("sizes").select("code, label, sort_order"),
      ]);

      setCategoryOptions(cats.data || []);

      if (colorFams.data) {
        // Filter buckets = families, ordered by color_families.sort_order.
        setColorOptions(colorFams.data.map((f) => f.family));
        setColorFamilyHex(
          Object.fromEntries(colorFams.data.map((f) => [f.family, f.hex]))
        );
      }

      if (colorRows.data) {
        // Multi-family maps: a code lists 1..n families; each family gathers
        // every code that includes it, so filtering any family surfaces it.
        const familyToCodes = {};
        const codeToFamilies = {};
        colorRows.data.forEach(({ code, families }) => {
          const fams = families || [];
          codeToFamilies[code] = fams;
          fams.forEach((fam) => (familyToCodes[fam] ||= []).push(code));
        });
        colorIndexRef.current = { familyToCodes, codeToFamilies };
      }

      if (sizeDefs.data) {
        // `sizes.label` is the canonical display string — the stored code
        // already encodes letter+numeric (e.g. "S|36"), so use label directly.
        const displayMap = {};
        sizeDefs.data.forEach((s) => {
          displayMap[s.code] = s.label;
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
        // Multi-family: a fabric code lists 1..n families. Shared index builder;
        // the filter lists families ordered by member-code count (proxy volume).
        const { familyToCodes, codeToFamilies, orderedFamilies } =
          buildFamilyIndex(fabrics.data);
        fabricIndexRef.current = { familyToCodes, codeToFamilies };
        setFabricOptions(orderedFamilies);
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
      const available = await fetchAvailableOptionsFromDB(
        filters,
        fabricIndexRef.current,
        colorIndexRef.current
      );
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
        if (currentFilters.colors.length > 0)
          q = q.in("color", colorCodesFor(currentFilters.colors, colorIndexRef.current.familyToCodes));
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
        query = query.in(
          "fabric",
          fabricCodesFor(currentFilters.fabrics, fabricIndexRef.current.familyToCodes)
        );

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
    colorFamilyHex,
    sizeOptions,
    sizeDisplayMap,
    fabricOptions,
    priceBounds,
    availableOptions,
  };
}
