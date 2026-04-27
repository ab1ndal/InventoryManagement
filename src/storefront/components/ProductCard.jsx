import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";

function PriceBadge({ price }) {
  return (
    <span className="font-montserrat font-semibold text-storefront-charcoal tabular-nums">
      ₹{Number(price).toLocaleString("en-IN")}
    </span>
  );
}

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
      className="group block bg-white rounded-sm overflow-hidden border border-storefront-border hover:border-storefront-gold/40 hover:shadow-md transition-all duration-200"
    >
      {/* Image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-storefront-cream">
        {imageUrl && !imgFailed ? (
          <img
            src={imageUrl}
            alt={product.name}
            loading={priority ? "eager" : "lazy"}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <PlaceholderImage name={product.name} />
        )}

        {/* Wishlist button */}
        <button
          aria-label="Add to wishlist"
          onClick={(e) => {
            e.preventDefault();
          }}
          className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur-sm rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-white cursor-pointer"
        >
          <Heart size={15} className="text-storefront-charcoal" />
        </button>

        {/* Category badge */}
        {categoryName && (
          <span className="absolute bottom-3 left-3 bg-storefront-charcoal/70 backdrop-blur-sm text-storefront-cream text-[10px] tracking-widest uppercase px-2 py-1 font-montserrat">
            {categoryName}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <p className="font-montserrat text-sm font-medium text-storefront-charcoal leading-snug line-clamp-2">
          {product.name}
        </p>
        <div className="flex items-center justify-between pt-0.5">
          <PriceBadge price={product.retailprice} />
          <span className="text-[11px] text-storefront-muted font-montserrat">
            {product.fabric || ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
