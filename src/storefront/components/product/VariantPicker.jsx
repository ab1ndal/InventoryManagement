import React, { useState, useMemo } from "react";

export default function VariantPicker({ variants, onVariantSelect }) {
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedColor, setSelectedColor] = useState(null);

  const sizes = useMemo(() => {
    const totals = {};
    for (const v of variants) {
      totals[v.size] = (totals[v.size] ?? 0) + v.stock;
    }
    return Object.entries(totals).map(([size, totalStock]) => ({
      size,
      available: totalStock > 0,
    }));
  }, [variants]);

  const colors = useMemo(() => {
    if (!selectedSize) return [];
    return variants
      .filter((v) => v.size === selectedSize)
      .map((v) => ({ id: v.variantid, color: v.color, available: v.stock > 0 }));
  }, [variants, selectedSize]);

  function handleSizeClick(size, available) {
    if (!available) return;
    setSelectedSize(size);
    setSelectedColor(null);
    onVariantSelect(null);
  }

  function handleColorClick(variantOption) {
    if (!variantOption.available) return;
    setSelectedColor(variantOption.color);
    const match = variants.find(
      (v) => v.size === selectedSize && v.color === variantOption.color
    );
    onVariantSelect(match ?? null);
  }

  return (
    <div className="space-y-5">
      {/* Sizes */}
      <div>
        <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal mb-2.5 font-montserrat">
          Size
          {selectedSize && (
            <span className="font-normal text-storefront-muted ml-2 normal-case tracking-normal">
              — {selectedSize}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {sizes.map(({ size, available }) => (
            <button
              key={size}
              onClick={() => handleSizeClick(size, available)}
              disabled={!available}
              className={`px-3.5 py-1.5 text-xs border font-montserrat tracking-wide transition-colors duration-150 ${
                selectedSize === size
                  ? "border-storefront-charcoal bg-storefront-charcoal text-storefront-cream"
                  : available
                  ? "border-storefront-border text-storefront-charcoal hover:border-storefront-charcoal cursor-pointer"
                  : "border-storefront-border text-storefront-muted line-through cursor-not-allowed opacity-40"
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Colours — only shown after a size is selected */}
      {selectedSize && (
        <div>
          <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal mb-2.5 font-montserrat">
            Colour
            {selectedColor && (
              <span className="font-normal text-storefront-muted ml-2 normal-case tracking-normal">
                — {selectedColor}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((variantOption) => (
              <button
                key={variantOption.id}
                onClick={() => handleColorClick(variantOption)}
                disabled={!variantOption.available}
                className={`px-3.5 py-1.5 text-xs border font-montserrat tracking-wide transition-colors duration-150 ${
                  selectedColor === variantOption.color
                    ? "border-storefront-charcoal bg-storefront-charcoal text-storefront-cream"
                    : variantOption.available
                    ? "border-storefront-border text-storefront-charcoal hover:border-storefront-charcoal cursor-pointer"
                    : "border-storefront-border text-storefront-muted line-through cursor-not-allowed opacity-40"
                }`}
              >
                {variantOption.color}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
