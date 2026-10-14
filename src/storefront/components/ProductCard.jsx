import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Heart, ChevronLeft, ChevronRight } from "lucide-react";
import { getProductImagePaths } from "../lib/productImage";
import { useWishlist } from "../context/WishlistContext";
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

const LOW_STOCK_THRESHOLD = 3;

// Badge from the product's real variant stock. Some card sources (wishlist
// snapshots, the home rail) don't load `productsizecolors`; without variant
// data the stock is unknown, so show nothing rather than guess.
function stockBadge(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const total = variants.reduce((sum, v) => sum + Math.max(0, Number(v.stock) || 0), 0);
  if (total === 0) return { label: "Sold out", soldOut: true };
  if (total <= LOW_STOCK_THRESHOLD) return { label: `Only ${total} left`, soldOut: false };
  return null;
}

export default function ProductCard({ product, priority = false }) {
  const [images, setImages] = useState([]); // storage object paths
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);
  const { has, toggle } = useWishlist();
  const wishlisted = has(product.productid);

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
  const badge = stockBadge(product.productsizecolors);

  return (
    <Link
      to={`/product/${product.productid}`}
      className="group block bg-white overflow-hidden border border-storefront-border/60 hover:border-storefront-gold/60 transition-colors duration-200"
    >
      {/* Image / carousel */}
      <div
        className="relative aspect-[3/4] overflow-hidden bg-storefront-cream"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {count > 0 ? (
          <div
            className={`flex h-full w-full transition-transform duration-500 ease-out ${
              badge?.soldOut ? "opacity-60" : ""
            }`}
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
                  fit="cover"
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

        {/* Wishlist */}
        <button
          type="button"
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle(product);
          }}
          className={`absolute top-2 right-2 sm:top-3 sm:right-3 z-10 p-2 bg-white/80 backdrop-blur-sm transition-[opacity,background-color] duration-200 hover:bg-white cursor-pointer ${
            wishlisted ? "opacity-100" : "sm:opacity-0 sm:group-hover:opacity-100"
          }`}
        >
          <Heart
            size={14}
            className={wishlisted ? "text-storefront-gold fill-storefront-gold" : "text-storefront-charcoal"}
          />
        </button>

        {/* Category + stock badges */}
        {(categoryName || badge) && (
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 max-w-[calc(100%-3.5rem)] flex flex-col items-start gap-1">
            {categoryName && (
              <span className="max-w-full truncate bg-white/85 backdrop-blur-sm text-storefront-charcoal text-[9px] tracking-[0.18em] uppercase px-2 sm:px-2.5 py-1 font-sans font-medium">
                {categoryName}
              </span>
            )}
            {badge && (
              <span
                className={`text-[9px] tracking-[0.14em] uppercase px-2 sm:px-2.5 py-1 font-sans font-semibold ${
                  badge.soldOut
                    ? "bg-storefront-charcoal text-storefront-cream"
                    : "bg-storefront-gold text-white"
                }`}
              >
                {badge.label}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 sm:px-4">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="font-sans text-base font-semibold text-storefront-charcoal tabular-nums">
            ₹{Number(product.retailprice).toLocaleString("en-IN")}
          </span>
          {product.fabric && (
            <span className="text-[10px] text-storefront-muted font-sans tracking-[0.12em] uppercase truncate">
              {product.fabric}
            </span>
          )}
        </div>
        <h3 className="font-sans text-[13px] sm:text-sm text-storefront-warm leading-5 line-clamp-2 min-h-[2.5rem]">
          {product.name?.replace(/-/g, " ")}
        </h3>
      </div>
    </Link>
  );
}
