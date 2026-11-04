import { useState, useEffect, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import {
  SEARCH_MIN_CHARS,
  sanitizeSearchQuery,
  matchCategoryIds,
  buildNameCategoryOr,
} from "../lib/searchUtils";

export const SEARCH_PAGE_SIZE = 20;
const DEBOUNCE_MS = 150;

// Client-initiated product search: debounced Supabase `ilike` over name +
// category. No backend/edge function, no full-catalog cache (3.5k rows exceed
// the 1000-row cap and go stale) — each keystroke burst runs one small query.
//
// `limit` grows rather than paging by offset: the sort is by title, which repeats, so offset pages could
// show a piece twice or skip it. `results` stays on screen while a larger limit loads.
export function useProductSearch(query, limit = SEARCH_PAGE_SIZE) {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Category list is tiny and stable — fetch once, reuse across keystrokes.
  const categoriesRef = useRef(null);

  useEffect(() => {
    const clean = sanitizeSearchQuery(query);
    if (clean.length < SEARCH_MIN_CHARS) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      if (!categoriesRef.current) {
        const { data } = await supabase.from("categories").select("categoryid, name");
        categoriesRef.current = data || [];
      }
      const categoryIds = matchCategoryIds(clean, categoriesRef.current);

      const { data, count } = await supabase
        .from("products")
        .select(
          "productid, name:display_title, retailprice, categoryid, categories(name), productsizecolors(stock)",
          { count: "exact" }
        )
        .or(buildNameCategoryOr(clean, categoryIds))
        .order("display_title")
        .limit(limit);

      if (!cancelled) {
        setResults(data || []);
        setTotal(count ?? data?.length ?? 0);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, limit]);

  return { results, total, loading };
}
