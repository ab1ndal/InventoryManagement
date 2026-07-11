import { useState, useEffect, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import {
  SEARCH_MIN_CHARS,
  sanitizeSearchQuery,
  matchCategoryIds,
  buildNameCategoryOr,
} from "../lib/searchUtils";

const LIMIT = 20;
const DEBOUNCE_MS = 150;

// Client-initiated product search: debounced Supabase `ilike` over name +
// category. No backend/edge function, no full-catalog cache (3.5k rows exceed
// the 1000-row cap and go stale) — each keystroke burst runs one small query.
export function useProductSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  // Category list is tiny and stable — fetch once, reuse across keystrokes.
  const categoriesRef = useRef(null);

  useEffect(() => {
    const clean = sanitizeSearchQuery(query);
    if (clean.length < SEARCH_MIN_CHARS) {
      setResults([]);
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

      const { data } = await supabase
        .from("products")
        .select("productid, name, retailprice, categoryid, categories(name)")
        .or(buildNameCategoryOr(clean, categoryIds))
        .order("name")
        .limit(LIMIT);

      if (!cancelled) {
        setResults(data || []);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
}
