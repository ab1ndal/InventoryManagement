import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Heart, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { getProductImagePaths } from "../lib/productImage";
import BlurFillImage from "./BlurFillImage";

function PlaceholderImage({ name }) {
  const initials = name
    ? name
        .split(/[\s-]+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "BC";
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-storefront-charcoal to-storefront-warm gap-2">
      <span className="font-display text-3xl font-semibold text-storefront-gold opacity-60">
        {initials}
      </span>
      <span className="text-[10px] text-storefront-cream/40 tracking-widest uppercase font-sans">
        Image coming soon
      </span>
    </div>
  );
}

export default function ProductCard({ product, priority = false }) {
  const [images, setImages] = useState([]); // storage object paths
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);

  useEffect(() => {
    let active = true;
    getProductImagePaths(product.productid).then((paths) => {
      if (active && paths.length) setImages(paths);
    });
    return () => {
      active = false;
    };
  }, [product.productid]);

  const count = images.length;
  const hasCarousel = count > 1;

  // Stop the parent <Link> from navigating when using carousel controls.
  const go = useCallback(
    (e, dir) => {
      e.preventDefault();
      e.stopPropagation();
      setIndex((i) => (i + dir + count) % count);
    },
    [count]
  );

  const goTo = useCallback((e, i) => {
    e.preventDefault();
    e.stopPropagation();
    setIndex(i);
  }, []);

  const onTouchStart = (e) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (touchX.current === null || !hasCarousel) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) setIndex((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
    touchX.current = null;
  };

  const categoryName = product.categories?.name || product.category_name || null;

  return (
    <Link
      to={`/product/${product.productid}`}
      className="group block bg-white overflow-hidden border border-storefront-border/70 hover:border-storefront-gold/60 transition-[border-color,box-shadow] duration-300 hover:shadow-[0_12px_40px_-12px_rgba(28,25,23,0.25)]"
    >
      {/* Image / carousel */}
      <div
        className="relative aspect-[3/4] overflow-hidden bg-storefront-cream"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {count > 0 ? (
          <div
            className="flex h-full w-full transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {images.map((path, i) => (
              <div key={path} className="w-full h-full flex-shrink-0">
                <BlurFillImage
                  path={path}
                  alt={`${product.name}${count > 1 ? ` — view ${i + 1}` : ""}`}
                  width={600}
                  quality={70}
                  eager={priority && i === 0}
                />
              </div>
            ))}
          </div>
        ) : (
          <PlaceholderImage name={product.name} />
        )}

        {/* Carousel arrows (desktop hover) */}
        {hasCarousel && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={(e) => go(e, -1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/85 backdrop-blur-sm text-storefront-charcoal opacity-0 group-hover:opacity-100 hover:bg-white transition-opacity duration-200 cursor-pointer hidden sm:flex"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={(e) => go(e, 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white/85 backdrop-blur-sm text-storefront-charcoal opacity-0 group-hover:opacity-100 hover:bg-white transition-opacity duration-200 cursor-pointer hidden sm:flex"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}

        {/* Dots */}
        {hasCarousel && (
          <div className="absolute bottom-2.5 left-0 right-0 flex items-center justify-center gap-1.5 z-10">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                onClick={(e) => goTo(e, i)}
                className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                  i === index
                    ? "w-4 bg-white"
                    : "w-1.5 bg-white/60 hover:bg-white/90"
                }`}
              />
            ))}
          </div>
        )}

        {/* Hover veil + CTA (non-interactive so controls stay clickable) */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-storefront-charcoal/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-7">
          <span className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-sm text-storefront-charcoal font-sans text-[10px] font-medium tracking-[0.18em] uppercase px-4 py-2 translate-y-3 group-hover:translate-y-0 transition-transform duration-300 ease-out">
            View <ArrowRight size={11} />
          </span>
        </div>

        {/* Wishlist */}
        <button
          type="button"
          aria-label={`Add ${product.name} to wishlist`}
          onClick={(e) => e.preventDefault()}
          className="absolute top-3 right-3 z-10 p-2 bg-white/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-[opacity,background-color] duration-200 hover:bg-white cursor-pointer"
        >
          <Heart size={14} className="text-storefront-charcoal" />
        </button>

        {/* Category badge */}
        {categoryName && (
          <span className="absolute top-3 left-3 z-10 bg-white/85 backdrop-blur-sm text-storefront-charcoal text-[9px] tracking-[0.18em] uppercase px-2.5 py-1 font-sans font-medium">
            {categoryName}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4 pt-3.5">
        <h3 className="font-display text-[15px] font-medium text-storefront-charcoal leading-snug line-clamp-1 mb-2 tracking-[0.01em]">
          {product.name?.replace(/-/g, " ")}
        </h3>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-sans text-[15px] font-semibold text-storefront-charcoal tabular-nums">
            ₹{Number(product.retailprice).toLocaleString("en-IN")}
          </span>
          {product.fabric && (
            <span className="text-[10px] text-storefront-muted font-sans tracking-[0.12em] uppercase truncate">
              {product.fabric}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
