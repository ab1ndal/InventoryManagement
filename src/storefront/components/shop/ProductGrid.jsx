import React, { useEffect, useRef } from "react";
import ProductCard from "../ProductCard";

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

// Scrolling auto-loads only the first two pages; after that a button, so the
// footer can be reached on big collections.
const AUTO_LOAD_LIMIT = 48;

export default function ProductGrid({
  products,
  loading,
  loadingMore,
  hasMore,
  fetchNextPage,
}) {
  const sentinelRef = useRef(null);
  const autoLoad = products.length < AUTO_LOAD_LIMIT;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && autoLoad && hasMore && !loadingMore) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [autoLoad, hasMore, loadingMore, fetchNextPage]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="font-display text-3xl text-storefront-charcoal mb-3">
          No products found
        </p>
        <p className="font-sans text-sm text-storefront-muted">
          Try adjusting your filters to see more results.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-5">
        {products.map((p, i) => (
          <ProductCard key={p.productid} product={p} priority={i < 4} />
        ))}
      </div>

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />

      {loadingMore && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 lg:gap-5 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProductSkeleton key={i} />
          ))}
        </div>
      )}

      {hasMore && !autoLoad && !loadingMore && (
        <div className="text-center mt-10">
          <button
            type="button"
            onClick={fetchNextPage}
            className="border border-storefront-charcoal text-storefront-charcoal hover:bg-storefront-charcoal hover:text-storefront-cream font-sans text-sm font-medium tracking-widest uppercase px-10 py-3.5 transition-colors duration-200 cursor-pointer"
          >
            Load more
          </button>
        </div>
      )}

      {!hasMore && products.length > 0 && (
        <p className="text-center font-sans text-xs tracking-[0.2em] uppercase text-storefront-muted mt-12">
          End of results
        </p>
      )}
    </>
  );
}
