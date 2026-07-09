import React from "react";
import { Check } from "lucide-react";
import PriceInputs from "./PriceInputs";
import { sortByAvailability } from "../../hooks/filterUtils";

// Swatch for a color FAMILY (the filter bucket). hex comes from color_families;
// null hex (Multi/Printed) renders a rainbow dot. Family name is the label.
const MULTI_GRADIENT =
  "conic-gradient(from 0deg, #e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)";

function ColorSwatch({ color, hex, selected, onToggle, unavailable }) {
  const isLight = hex
    ? (() => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return 0.299 * r + 0.587 * g + 0.114 * b > 200;
      })()
    : false;

  const dimClass = unavailable && !selected ? "opacity-40 cursor-not-allowed pointer-events-none" : "";

  return (
    <button
      title={color}
      onClick={() => onToggle(color)}
      aria-label={`${selected ? "Remove" : "Select"} color ${color}`}
      aria-pressed={selected}
      className={`relative w-8 h-8 rounded-full cursor-pointer transition-all duration-150 flex-shrink-0 ${dimClass} ${
        selected
          ? "ring-2 ring-storefront-gold ring-offset-2"
          : isLight
          ? "ring-1 ring-storefront-border hover:ring-storefront-charcoal"
          : "hover:ring-2 hover:ring-storefront-charcoal hover:ring-offset-1"
      }`}
      style={hex ? { backgroundColor: hex } : { background: MULTI_GRADIENT }}
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
  colorFamilyHex = {},
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
                  <span className="text-sm font-sans text-storefront-charcoal">
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
                hex={colorFamilyHex[color]}
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
                  className={`px-3 py-1.5 text-[11px] font-sans font-medium tracking-wide border cursor-pointer transition-colors duration-150 ${
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
                  <span className="text-sm font-sans text-storefront-charcoal capitalize">
                    {fabric}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-storefront-border px-4 py-2.5 flex items-center justify-between">
        <span className="text-[11px] text-storefront-muted font-sans">
          {selectedCount > 0 ? `${selectedCount} selected` : " "}
        </span>
        <button
          onClick={onApply}
          className="text-[11px] font-sans font-medium tracking-widest uppercase text-storefront-cream bg-storefront-charcoal px-4 py-1.5 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
