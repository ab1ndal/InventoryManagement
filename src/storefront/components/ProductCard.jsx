import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Heart, ArrowRight } from "lucide-react";

function PlaceholderImage({ name }) {
  const initials = name
    ? name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "BC";
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-storefront-charcoal to-storefront-warm gap-2">
      <span className="font-cormorant text-3xl font-semibold text-storefront-gold opacity-60">
        {initials}
      </span>
      <span className="text-[10px] text-storefront-cream/40 tracking-widest uppercase font-montserrat">
        Image coming soon
      </span>
    </div>
  );
}

export default function ProductCard({ product, priority = false }) {
  const [imgFailed, setImgFailed] = useState(false);

  const imageUrl =
    product.image_url ||
    (product.producturl ? `${product.producturl}/display/image.jpg` : null);

  const categoryName =
    product.categories?.name || product.category_name || null;

  return (
    <Link
      to={`/product/${product.productid}`}
      className="group block bg-white overflow-hidden border border-storefront-border hover:border-storefront-gold/50 hover:shadow-lg transition-all duration-300"
    >
      {/* Image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-storefront-cream">
        {imageUrl && !imgFailed ? (
          <img
            src={imageUrl}
            alt={product.name}
            loading={priority ? "eager" : "lazy"}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700 ease-out"
          />
        ) : (
          <PlaceholderImage name={product.name} />
        )}

        {/* Hover overlay with CTA */}
        <div className="absolute inset-0 bg-storefront-charcoal/0 group-hover:bg-storefront-charcoal/20 transition-colors duration-300 flex items-end justify-center pb-5">
          <span className="inline-flex items-center gap-1.5 bg-white text-storefront-charcoal font-montserrat text-[11px] font-medium tracking-widest uppercase px-4 py-2 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200">
            View Details <ArrowRight size={11} />
          </span>
        </div>

        {/* Wishlist button */}
        <button
          aria-label="Add to wishlist"
          onClick={(e) => e.preventDefault()}
          className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-white cursor-pointer"
        >
          <Heart size={14} className="text-storefront-charcoal" />
        </button>

        {/* Category badge */}
        {categoryName && (
          <span className="absolute top-3 left-3 bg-storefront-charcoal/75 backdrop-blur-sm text-storefront-cream text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 font-montserrat">
            {categoryName}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <p className="font-montserrat text-[13px] font-medium text-storefront-charcoal leading-snug line-clamp-2 mb-2.5 tracking-wide">
          {product.name}
        </p>
        <div className="flex items-center justify-between">
          <span className="font-montserrat text-base font-semibold text-storefront-charcoal tabular-nums">
            ₹{Number(product.retailprice).toLocaleString("en-IN")}
          </span>
          {product.fabric && (
            <span className="text-[11px] text-storefront-muted font-montserrat tracking-wide">
              {product.fabric}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
