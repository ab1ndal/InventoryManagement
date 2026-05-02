import React, { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import PriceInputs from "./PriceInputs";
import { sortByAvailability } from "../../hooks/filterUtils";

const COLOR_MAP = {
  white: "#F5F5F4",
  black: "#1C1917",
  red: "#DC2626",
  blue: "#1D4ED8",
  navy: "#1E3A5F",
  "navy blue": "#1E3A5F",
  green: "#16A34A",
  yellow: "#EAB308",
  orange: "#EA580C",
  pink: "#EC4899",
  purple: "#7C3AED",
  maroon: "#7F1D1D",
  grey: "#6B7280",
  gray: "#6B7280",
  beige: "#D2B48C",
  brown: "#92400E",
  cream: "#F5F5DC",
  ivory: "#FFFFF0",
  gold: "#A16207",
  silver: "#9CA3AF",
  peach: "#FBBF24",
  teal: "#0D9488",
  turquoise: "#06B6D4",
  khaki: "#A0845C",
  mustard: "#CA8A04",
  olive: "#4D7C0F",
  coral: "#F97316",
  lavender: "#A78BFA",
  rose: "#FB7185",
  mint: "#34D399",
  charcoal: "#374151",
  "off white": "#F5F5F4",
  "off-white": "#F5F5F4",
};

function SectionLabel({ children }) {
  return (
    <p className="font-montserrat text-[10px] tracking-[0.2em] uppercase text-storefront-muted mb-3">
      {children}
    </p>
  );
}

export default function AllFiltersPanel({
  open,
  filters,
  categoryOptions,
  colorOptions,
  sizeOptions,
  fabricOptions,
  priceBounds,
  onToggle,
  onClearCategories,
  onSetPrice,
  onClearAll,
  onClose,
  availableOptions,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handle(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);


  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-in-out border-b border-storefront-border"
      style={{ maxHeight: open ? "800px" : "0px" }}
    >
      <div
        ref={panelRef}
        className="bg-white border-t border-storefront-border"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            {/* Category */}
            <div>
              <SectionLabel>Category</SectionLabel>
              <div className="space-y-1 max-h-60 overflow-y-auto pr-2">
                <button
                  onClick={onClearCategories}
                  className={`w-full text-left py-1.5 px-2 text-sm font-montserrat transition-colors duration-150 cursor-pointer ${
                    filters.categories.length === 0
                      ? "text-storefront-charcoal font-medium bg-storefront-cream"
                      : "text-storefront-muted hover:text-storefront-charcoal"
                  }`}
                >
                  All Categories
                </button>
                {sortByAvailability(categoryOptions, (cat) => cat.categoryid, availableOptions?.categories).map((cat) => {
                  const active = filters.categories.includes(cat.categoryid);
                  const unavailable = availableOptions && !availableOptions.categories.has(cat.categoryid) && !active;
                  return (
                    <button
                      key={cat.categoryid}
                      onClick={() => onToggle("categories", cat.categoryid)}
                      className={`w-full flex items-center justify-between py-1.5 px-2 text-sm font-montserrat transition-colors duration-150 cursor-pointer ${
                        unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                      } ${
                        active
                          ? "text-storefront-charcoal font-medium"
                          : "text-storefront-muted hover:text-storefront-charcoal"
                      }`}
                    >
                      {cat.name}
                      {active && <Check size={12} className="text-storefront-charcoal flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Size */}
            <div>
              <SectionLabel>Size</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {sortByAvailability(sizeOptions, (s) => s, availableOptions?.sizes).map((size) => {
                  const active = filters.sizes.includes(size);
                  const unavailable = availableOptions && !availableOptions.sizes.has(size) && !active;
                  return (
                    <button
                      key={size}
                      onClick={() => onToggle("sizes", size)}
                      className={`px-3 py-1.5 text-[11px] font-montserrat font-medium tracking-wide border cursor-pointer transition-colors duration-150 ${
                        unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                      } ${
                        active
                          ? "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal"
                          : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal hover:text-storefront-charcoal"
                      }`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Color */}
            <div>
              <SectionLabel>Color</SectionLabel>
              <div className="flex flex-wrap gap-2.5">
                {sortByAvailability(colorOptions, (c) => c, availableOptions?.colors).map((color) => {
                  const hex = COLOR_MAP[color.toLowerCase().trim()];
                  const active = filters.colors.includes(color);
                  const unavailable = availableOptions && !availableOptions.colors.has(color) && !active;

                  if (hex) {
                    const isLight = (() => {
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      return 0.299 * r + 0.587 * g + 0.114 * b > 200;
                    })();
                    return (
                      <button
                        key={color}
                        title={color}
                        onClick={() => onToggle("colors", color)}
                        aria-label={`${active ? "Remove" : "Select"} ${color}`}
                        className={`relative w-8 h-8 rounded-full cursor-pointer transition-all duration-150 flex-shrink-0 ${
                          unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                        } ${
                          active
                            ? "ring-2 ring-storefront-gold ring-offset-2"
                            : isLight
                            ? "ring-1 ring-storefront-border hover:ring-storefront-charcoal"
                            : "hover:ring-2 hover:ring-storefront-charcoal hover:ring-offset-1"
                        }`}
                        style={{ backgroundColor: hex }}
                      >
                        {active && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Check size={12} className={isLight ? "text-storefront-charcoal" : "text-white"} />
                          </span>
                        )}
                      </button>
                    );
                  }

                  return (
                    <button
                      key={color}
                      onClick={() => onToggle("colors", color)}
                      className={`px-3 py-1.5 text-[11px] font-montserrat font-medium tracking-wide border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
                        unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                      } ${
                        active
                          ? "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal"
                          : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal"
                      }`}
                    >
                      {color}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Price + Fabric */}
            <div className="space-y-8">
              <div>
                <SectionLabel>Price Range</SectionLabel>
                <PriceInputs
                  priceMin={filters.priceMin}
                  priceMax={filters.priceMax}
                  onSetPrice={onSetPrice}
                />
              </div>

              <div>
                <SectionLabel>Fabric</SectionLabel>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {sortByAvailability(fabricOptions, (f) => f, availableOptions?.fabrics).map((fabric) => {
                    const active = filters.fabrics.includes(fabric);
                    const unavailable = availableOptions && !availableOptions.fabrics.has(fabric) && !active;
                    return (
                      <button
                        key={fabric}
                        onClick={() => onToggle("fabrics", fabric)}
                        className={`w-full flex items-center gap-3 py-1 text-left cursor-pointer group ${
                          unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                        }`}
                      >
                        <span
                          className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
                            active
                              ? "bg-storefront-charcoal border-storefront-charcoal"
                              : "border-storefront-border group-hover:border-storefront-charcoal"
                          }`}
                        >
                          {active && <Check size={10} className="text-white" />}
                        </span>
                        <span className="text-sm font-montserrat text-storefront-charcoal capitalize">
                          {fabric}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-storefront-border">
            <button
              onClick={onClearAll}
              className="text-xs font-montserrat text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2 transition-colors duration-150 cursor-pointer tracking-wide"
            >
              Clear all filters
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-2 bg-storefront-charcoal hover:bg-storefront-warm text-storefront-cream font-montserrat text-[11px] font-medium tracking-widest uppercase px-8 py-2.5 transition-colors duration-150 cursor-pointer"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
