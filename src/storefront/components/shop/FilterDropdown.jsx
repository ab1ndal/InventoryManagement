import React from "react";
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

function ColorSwatch({ color, selected, onToggle, unavailable }) {
  const hex = COLOR_MAP[color.toLowerCase().trim()];
  const isLight = hex
    ? (() => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return 0.299 * r + 0.587 * g + 0.114 * b > 200;
      })()
    : false;

  const dimClass = unavailable && !selected ? "opacity-40 cursor-not-allowed pointer-events-none" : "";

  if (hex) {
    return (
      <button
        title={color}
        onClick={() => onToggle(color)}
        aria-label={`${selected ? "Remove" : "Select"} color ${color}`}
        className={`relative w-8 h-8 rounded-full cursor-pointer transition-all duration-150 flex-shrink-0 ${dimClass} ${
          selected
            ? "ring-2 ring-storefront-gold ring-offset-2"
            : isLight
            ? "ring-1 ring-storefront-border hover:ring-storefront-charcoal"
            : "hover:ring-2 hover:ring-storefront-charcoal hover:ring-offset-1"
        }`}
        style={{ backgroundColor: hex }}
      >
        {selected && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Check
              size={12}
              className={isLight ? "text-storefront-charcoal" : "text-white"}
            />
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      title={color}
      onClick={() => onToggle(color)}
      aria-label={`${selected ? "Remove" : "Select"} color ${color}`}
      className={`px-3 py-1.5 text-[11px] font-montserrat font-medium tracking-wide border whitespace-nowrap cursor-pointer transition-colors duration-150 ${dimClass} ${
        selected
          ? "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal"
          : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal"
      }`}
    >
      {color}
    </button>
  );
}

export default function FilterDropdown({
  type,
  options,
  selected,
  onToggle,
  priceMin,
  priceMax,
  onSetPrice,
  onApply,
  availableSet,
  sizeDisplayMap = {},
}) {
  const selectedCount =
    type === "price"
      ? priceMin !== null || priceMax !== null ? 1 : 0
      : selected.length;

  return (
    <div className={`absolute top-full left-0 mt-1 bg-white border border-storefront-border shadow-lg z-50 ${type === "category" ? "w-56" : "w-72"}`}>
      <div className="p-4">
        {type === "category" && (
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {sortByAvailability(options, (cat) => cat.categoryid, availableSet).map((cat) => {
              const isSelected = selected.includes(cat.categoryid);
              const unavailable = availableSet && !availableSet.has(cat.categoryid) && !isSelected;
              return (
                <button
                  key={cat.categoryid}
                  onClick={() => onToggle(cat.categoryid)}
                  className={`w-full flex items-center gap-3 py-1.5 text-left cursor-pointer group ${
                    unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                  }`}
                >
                  <span className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
                    isSelected
                      ? "bg-storefront-charcoal border-storefront-charcoal"
                      : "border-storefront-border group-hover:border-storefront-charcoal"
                  }`}>
                    {isSelected && <Check size={10} className="text-white" />}
                  </span>
                  <span className="text-sm font-montserrat text-storefront-charcoal">
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {type === "color" && (
          <div className="flex flex-wrap gap-2.5">
            {sortByAvailability(options, (c) => c, availableSet).map((color) => (
              <ColorSwatch
                key={color}
                color={color}
                selected={selected.includes(color)}
                onToggle={onToggle}
                unavailable={availableSet ? !availableSet.has(color) && !selected.includes(color) : false}
              />
            ))}
          </div>
        )}

        {type === "size" && (
          <div className="flex flex-wrap gap-2">
            {sortByAvailability(options, (s) => s, availableSet).map((size) => {
              const isSelected = selected.includes(size);
              const unavailable = availableSet && !availableSet.has(size) && !isSelected;
              return (
                <button
                  key={size}
                  onClick={() => onToggle(size)}
                  className={`px-3 py-1.5 text-[11px] font-montserrat font-medium tracking-wide border cursor-pointer transition-colors duration-150 ${
                    unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                  } ${
                    isSelected
                      ? "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal"
                      : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal hover:text-storefront-charcoal"
                  }`}
                >
                  {sizeDisplayMap[size] ?? size}
                </button>
              );
            })}
          </div>
        )}

        {type === "price" && (
          <PriceInputs
            priceMin={priceMin}
            priceMax={priceMax}
            onSetPrice={onSetPrice}
          />
        )}

        {type === "fabric" && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {sortByAvailability(options, (f) => f, availableSet).map((fabric) => {
              const isSelected = selected.includes(fabric);
              const unavailable = availableSet && !availableSet.has(fabric) && !isSelected;
              return (
                <button
                  key={fabric}
                  onClick={() => onToggle(fabric)}
                  className={`w-full flex items-center gap-3 py-1.5 text-left cursor-pointer group ${
                    unavailable ? "opacity-40 cursor-not-allowed pointer-events-none" : ""
                  }`}
                >
                  <span className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
                    isSelected
                      ? "bg-storefront-charcoal border-storefront-charcoal"
                      : "border-storefront-border group-hover:border-storefront-charcoal"
                  }`}>
                    {isSelected && <Check size={10} className="text-white" />}
                  </span>
                  <span className="text-sm font-montserrat text-storefront-charcoal capitalize">
                    {fabric}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-storefront-border px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] text-storefront-muted font-montserrat">
          {selectedCount > 0 ? `${selectedCount} selected` : " "}
        </span>
        <button
          onClick={onApply}
          className="text-[11px] font-montserrat font-medium tracking-widest uppercase text-storefront-cream bg-storefront-charcoal px-4 py-1.5 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
