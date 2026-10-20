import React, { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import ProductCard from "../ProductCard";

// Columns used by ProductCard; shared by every home rail query.
export const RAIL_PRODUCT_COLUMNS =
  "productid, name, retailprice, producturl, fabric, categoryid, categories(name), productsizecolors(stock)";
export const RAIL_SIZE = 12;

const ITEM_CLASS = "w-44 flex-shrink-0 sm:w-56";

function ProductSkeleton() {
  return (
    <div className={ITEM_CLASS} aria-hidden="true">
      <div className="aspect-[3/4] animate-pulse rounded-sm bg-storefront-border/50" />
      <div className="mt-2 space-y-1.5">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-storefront-border/50" />
        <div className="h-3.5 w-1/3 animate-pulse rounded bg-storefront-border/50" />
      </div>
    </div>
  );
}

const arrowClass =
  "flex h-9 w-9 items-center justify-center rounded-full border border-storefront-border text-storefront-charcoal transition-colors hover:border-storefront-gold hover:text-storefront-gold cursor-pointer";

/**
 * A titled, horizontally scrolling row of product cards.
 * Renders nothing once loaded if there are no products.
 */
export default function ProductRail({
  title,
  eyebrow,
  products,
  loading,
  viewAllHref,
  viewAllLabel = "View all",
  tone = "white",
}) {
  const scrollRef = useRef(null);

  if (!loading && products.length === 0) return null;

  function scroll(dir) {
    scrollRef.current?.scrollBy({ left: dir * 480, behavior: "smooth" });
  }

  return (
    <section className={`py-10 sm:py-12 ${tone === "cream" ? "bg-storefront-cream" : "bg-white"}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            {eyebrow && (
              <div className="mb-1.5 flex items-center gap-3">
                <span className="h-px w-6 bg-storefront-gold/60" aria-hidden="true" />
                <span className="font-sans text-[11px] uppercase tracking-[0.25em] text-storefront-gold">
                  {eyebrow}
                </span>
              </div>
            )}
            <h2 className="font-display text-2xl font-semibold text-storefront-charcoal sm:text-3xl">
              {title}
            </h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {viewAllHref && (
              <Link
                to={viewAllHref}
                className="group mr-1 inline-flex items-center gap-1.5 font-sans text-xs font-medium uppercase tracking-widest text-storefront-charcoal hover:text-storefront-gold"
              >
                {viewAllLabel}
                <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
            <button type="button" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`} className={`hidden sm:flex ${arrowClass}`}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`} className={`hidden sm:flex ${arrowClass}`}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="scrollbar-hide -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0"
        >
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <ProductSkeleton key={i} />)
            : products.map((p) => (
                <div key={p.productid} className={`${ITEM_CLASS} snap-start`}>
                  <ProductCard product={p} />
                </div>
              ))}
        </div>
      </div>
    </section>
  );
}
