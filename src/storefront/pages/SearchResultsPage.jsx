import React from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import Seo from "../components/Seo";
import { useProductSearch } from "../hooks/useProductSearch";
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

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") || "";
  const clean = sanitizeSearchQuery(q);
  const { results, loading } = useProductSearch(q);

  return (
    <div className="min-h-screen bg-storefront-cream">
      <Seo title={`Search: ${q}`} noindex />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="font-display font-semibold text-3xl sm:text-4xl text-storefront-charcoal leading-none mb-2">
          Results for “{q}”
        </h1>

        {clean.length < SEARCH_MIN_CHARS ? (
          <p className="font-sans text-sm text-storefront-muted mt-6">
            Type something to search for.
          </p>
        ) : (
          <>
            {!loading && (
              <p className="font-sans text-sm text-storefront-muted mb-6">
                {results.length} {results.length === 1 ? "result" : "results"}
              </p>
            )}

            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <ProductSkeleton key={i} />
                ))}
              </div>
            )}

            {!loading && results.length === 0 && (
              <p className="font-sans text-sm text-storefront-charcoal py-12 text-center">
                No products match “{clean}”.
              </p>
            )}

            {!loading && results.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
                {results.map((p, i) => (
                  <ProductCard key={p.productid} product={p} priority={i < 3} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
