import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "lib/supabaseClient";
import { computeAvailableOptions } from "./filterUtils";

const PAGE_SIZE = 24;

const INITIAL_FILTERS = {
  categories: [],
  colors: [],
  sizes: [],
  fabrics: [],
  priceMin: null,
  priceMax: null,
};

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
  const [fabricOptions, setFabricOptions] = useState([]);
  const [priceBounds, setPriceBounds] = useState({ min: 0, max: 25000 });
  const [catalogIndex, setCatalogIndex] = useState(null);

  useEffect(() => {
    async function fetchOptions() {
      const [cats, variants, fabrics, priceRange, allProducts] = await Promise.all([
        supabase.from("categories").select("categoryid, name").order("name"),
        supabase.from("productsizecolors").select("productid, color, size"),
        supabase.from("products").select("fabric").not("fabric", "is", null),
        supabase
          .from("products")
          .select("retailprice")
          .order("retailprice", { ascending: false })
          .limit(1),
        supabase.from("products").select("productid, categoryid, fabric, retailprice"),
      ]);

      setCategoryOptions(cats.data || []);

      if (variants.data) {
        const colors = [...new Set(variants.data.map((r) => r.color).filter(Boolean))].sort();
        const sizes = [...new Set(variants.data.map((r) => r.size).filter(Boolean))].sort();
        setColorOptions(colors);
        setSizeOptions(sizes);
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

      if (allProducts.data && variants.data) {
        const variantMap = {};
        variants.data.forEach((v) => {
          if (!variantMap[v.productid]) variantMap[v.productid] = [];
          variantMap[v.productid].push({ color: v.color || null, size: v.size || null });
        });

        setCatalogIndex(
          allProducts.data.map((p) => ({
            productid: p.productid,
            categoryid: p.categoryid,
            fabric: p.fabric,
            retailprice: Number(p.retailprice),
            variants: variantMap[p.productid] || [],
          }))
        );
      }
    }
    fetchOptions();
  }, []);

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

  const availableOptions = useMemo(
    () => (catalogIndex !== null ? computeAvailableOptions(catalogIndex, filters) : null),
    [catalogIndex, filters]
  );

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
    fabricOptions,
    priceBounds,
    availableOptions,
  };
}
