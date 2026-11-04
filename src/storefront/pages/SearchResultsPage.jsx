import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import Seo from "../components/Seo";
import { SEARCH_PAGE_SIZE, useProductSearch } from "../hooks/useProductSearch";
import { SEARCH_MIN_CHARS, sanitizeSearchQuery } from "../lib/searchUtils";

function ProductSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="aspect-[3/4] bg-storefront-border/40 animate-pulse" />
      <div className="mt-3 space-y-2 p-4 pt-3">
        <div className="h-3 bg-storefront-border/40 animate-pulse rounded-sm w-3/4" />
        <div className="h-3 bg-storefront-border/40 animate-pulse rounded-sm w-1/3" />
      </div>
    </div>
  );
}

// Keyed by the search, so a new search starts at the first page with no old results on screen.
export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") || "";
  return <SearchResults key={q} q={q} />;
}

function SearchResults({ q }) {
  const [limit, setLimit] = useState(SEARCH_PAGE_SIZE);
  const clean = sanitizeSearchQuery(q);
  const { results, total, loading } = useProductSearch(q, limit);
  const firstLoad = loading && results.length === 0;

  return (
    <div className="min-h-screen bg-storefront-cream">
      <Seo title={`Search: ${q}`} noindex />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="font-display font-semibold text-3xl sm:text-4xl text-storefront-charcoal leading-none mb-2">
          {clean.length < SEARCH_MIN_CHARS ? "Search" : `Results for “${q}”`}
        </h1>

        {clean.length < SEARCH_MIN_CHARS ? (
          <p className="font-sans text-sm text-storefront-muted mt-6">
            Type something to search for.
          </p>
        ) : (
          <>
            {!firstLoad && (
              <p className="font-sans text-sm text-storefront-muted mb-6">
                {total.toLocaleString("en-IN")} {total === 1 ? "result" : "results"}
              </p>
            )}

            {firstLoad && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <ProductSkeleton key={i} />
                ))}
              </div>
            )}

            {!loading && results.length === 0 && (
              <p className="font-sans text-sm text-storefront-charcoal py-12 text-center">
                No products match “{clean}”.
              </p>
            )}

            {results.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">
                {results.map((p, i) => (
                  <ProductCard key={p.productid} product={p} priority={i < 4} />
                ))}
              </div>
            )}

            {total > results.length && results.length > 0 && (
              <div className="mt-8 text-center">
                <p className="font-sans text-xs text-storefront-muted tabular-nums mb-3">
                  Showing {results.length} of {total.toLocaleString("en-IN")}
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setLimit((n) => n + SEARCH_PAGE_SIZE)}
                  className="bg-storefront-charcoal text-storefront-cream font-sans text-[11px] font-medium tracking-widest uppercase px-8 py-3 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-gold focus-visible:ring-offset-2"
                >
                  {loading ? "Loading…" : "Show more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
