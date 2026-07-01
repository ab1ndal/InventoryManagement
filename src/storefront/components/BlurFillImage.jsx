import React, { useState } from "react";
import { imageUrl } from "../lib/productImage";

// Renders a product image fully visible (object-contain) over a blurred,
// zoomed copy of itself that fills the (typically square) container — so
// portrait garment shots never get cropped. The blur layer uses a tiny 48px
// transform, so the fill costs almost no bandwidth.
export default function BlurFillImage({
  path,
  alt,
  width = 600,
  quality = 75,
  eager = false,
  className = "",
}) {
  const [loaded, setLoaded] = useState(false);
  const fg = imageUrl(path, { width, quality });
  const bg = imageUrl(path, { width: 48, quality: 30 });

  return (
    <div className={`relative w-full h-full overflow-hidden bg-storefront-cream ${className}`}>
      {bg && (
        <img
          src={bg}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-80"
        />
      )}
      <img
        src={fg}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={`relative w-full h-full object-contain transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
