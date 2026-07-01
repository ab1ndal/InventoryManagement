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

export default function ProductGrid({
  products,
  loading,
  loadingMore,
  hasMore,
  fetchNextPage,
}) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, fetchNextPage]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {products.map((p, i) => (
          <ProductCard key={p.productid} product={p} priority={i < 3} />
        ))}
      </div>

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />

      {loadingMore && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProductSkeleton key={i} />
          ))}
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
