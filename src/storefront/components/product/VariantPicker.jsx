import React, { useState, useMemo, useEffect } from "react";

// Shared look for size and colour options: square-cornered boxes, charcoal
// when selected, struck through when out of stock.
function optionClass(selected, available) {
  return `min-w-[3rem] h-10 px-3.5 text-xs border font-sans tracking-wide transition-colors duration-150 ${
    selected
      ? "border-storefront-charcoal bg-storefront-charcoal text-storefront-cream"
      : available
      ? "border-storefront-border bg-white text-storefront-charcoal hover:border-storefront-charcoal cursor-pointer"
      : "border-storefront-border text-storefront-muted line-through cursor-not-allowed opacity-40"
  }`;
}

// `sizeAction` renders beside the Size label (the PDP puts its size-guide
// trigger there, next to the options it explains).
export default function VariantPicker({ variants, onVariantSelect, sizeAction = null }) {
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
    // With a single in-stock colour there is nothing to choose: select it so
    // Add to Cart is ready instead of waiting on a click with one option.
    const inStock = variants.filter((v) => v.size === size && v.stock > 0);
    if (inStock.length === 1) {
      setSelectedColor(inStock[0].color);
      onVariantSelect(inStock[0]);
    } else {
      setSelectedColor(null);
      onVariantSelect(null);
    }
  }

  // Many pieces come in one size only (e.g. UNSTITCHED, FREE-SIZE); pre-select it.
  useEffect(() => {
    const availableSizes = sizes.filter((s) => s.available);
    if (availableSizes.length === 1 && selectedSize === null) {
      handleSizeClick(availableSizes[0].size, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes]);

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
        <div className="flex items-center justify-between gap-4 mb-2.5">
          <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal font-sans">
            Size
            {selectedSize && (
              <span className="font-normal text-storefront-muted ml-2 normal-case tracking-normal">
                — {selectedSize}
              </span>
            )}
          </p>
          {sizeAction}
        </div>
        <div className="flex flex-wrap gap-2">
          {sizes.map(({ size, available }) => (
            <button
              key={size}
              onClick={() => handleSizeClick(size, available)}
              disabled={!available}
              className={optionClass(selectedSize === size, available)}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Colours — only shown after a size is selected */}
      {selectedSize && (
        <div>
          <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal mb-2.5 font-sans">
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
                className={optionClass(
                  selectedColor === variantOption.color,
                  variantOption.available
                )}
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
