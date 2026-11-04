import { useState, useEffect, useRef } from "react";
import { supabase } from "lib/supabaseClient";
import {
  SEARCH_MIN_CHARS,
  sanitizeSearchQuery,
  buildSearchFilters,
} from "../lib/searchUtils";

export const SEARCH_PAGE_SIZE = 20;
const DEBOUNCE_MS = 150;

// Client-initiated product search: debounced Supabase query where every word of
// the search must match name, title, description, fabric, category or colour.
// No backend/edge function, no full-catalog cache (3.5k rows exceed the
// 1000-row cap and go stale) — each keystroke burst runs one small query.
//
// `limit` grows rather than paging by offset: the sort is by title, which repeats, so offset pages could
// show a piece twice or skip it. `results` stays on screen while a larger limit loads.
export function useProductSearch(query, limit = SEARCH_PAGE_SIZE) {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Category and colour lists are tiny and stable — fetch once, reuse across keystrokes.
  const categoriesRef = useRef(null);
  const coloursRef = useRef(null);

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
      if (!coloursRef.current) {
        const { data } = await supabase.from("colors").select("code, families");
        coloursRef.current = data || [];
      }
      const { orGroups, colourFilters } = buildSearchFilters(clean, {
        categories: categoriesRef.current,
        colours: coloursRef.current,
      });

      // Colour sits on variant rows: an aliased inner embed per colour word keeps
      // only products with a variant in that colour (same approach as the shop).
      // The plain `productsizecolors(stock)` embed stays unfiltered for Sold out.
      const colourEmbeds = colourFilters.map((f) => `, ${f.alias}:productsizecolors!inner(productid)`);
      let query = supabase
        .from("products")
        .select(
          `productid, name:display_title, retailprice, categoryid, categories(name), productsizecolors(stock)${colourEmbeds.join("")}`,
          { count: "exact" }
        );
      colourFilters.forEach((f) => {
        query = query.in(`${f.alias}.color`, f.codes);
      });
      orGroups.forEach((group) => {
        query = query.or(group);
      });
      const { data, count } = await query.order("display_title").limit(limit);

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
