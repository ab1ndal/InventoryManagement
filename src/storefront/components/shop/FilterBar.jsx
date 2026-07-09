import React, { useRef, useEffect } from "react";
import { SlidersHorizontal } from "lucide-react";
import FilterDropdown from "./FilterDropdown";

const PILLS = [
  { label: "Category", type: "category", field: "categories" },
  { label: "Color", type: "color", field: "colors" },
  { label: "Size", type: "size", field: "sizes" },
  { label: "Price", type: "price", field: "price" },
  { label: "Fabric", type: "fabric", field: "fabrics" },
];

export default function FilterBar({
  filters,
  openDropdown,
  onToggleDropdown,
  onAllFilters,
  onToggle,
  onSetPrice,
  activeCount,
  totalCount,
  loading,
  categoryOptions,
  colorOptions,
  sizeOptions,
  sizeDisplayMap = {},
  colorFamilyHex = {},
  fabricOptions,
  availableOptions,
}) {
  const barRef = useRef(null);

  useEffect(() => {
    if (!openDropdown) return;
    function handle(e) {
      if (barRef.current && !barRef.current.contains(e.target)) {
        onToggleDropdown(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openDropdown, onToggleDropdown]);

  function getOptions(type) {
    if (type === "category") return categoryOptions;
    if (type === "color") return colorOptions;
    if (type === "size") return sizeOptions;
    if (type === "fabric") return fabricOptions;
    return [];
  }

  function getSelected(field) {
    if (field === "price") return [];
    return filters[field] ?? [];
  }

  function getBadgeCount(pill) {
    if (pill.type === "price") {
      return filters.priceMin !== null || filters.priceMax !== null ? 1 : 0;
    }
    return filters[pill.field]?.length ?? 0;
  }

  function getAvailableSet(type) {
    if (!availableOptions) return undefined;
    if (type === "category") return availableOptions.categories;
    if (type === "color") return availableOptions.colors;
    if (type === "size") return availableOptions.sizes;
    if (type === "fabric") return availableOptions.fabrics;
    return undefined;
  }

  return (
    <div
      ref={barRef}
      className="border-b border-storefront-border bg-storefront-cream"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3 gap-4">
          {/* Filter pills */}
          <div className="flex items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {PILLS.map((pill) => {
              const count = getBadgeCount(pill);
              const isOpen = openDropdown === pill.type;

              return (
                <div key={pill.type} className="relative flex-shrink-0">
                  <button
                    onClick={() => onToggleDropdown(isOpen ? null : pill.type)}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-sans font-medium tracking-[0.14em] uppercase border transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                      count > 0 || isOpen
                        ? "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal"
                        : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal hover:text-storefront-charcoal"
                    }`}
                  >
                    {pill.label}
                    {count > 0 && (
                      <span className="ml-0.5 text-[10px] opacity-75">
                        ({count})
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <FilterDropdown
                      type={pill.type}
                      options={getOptions(pill.type)}
                      selected={getSelected(pill.field)}
                      onToggle={(val) => onToggle(pill.field, val)}
                      priceMin={filters.priceMin}
                      priceMax={filters.priceMax}
                      onSetPrice={onSetPrice}
                      onApply={() => onToggleDropdown(null)}
                      availableSet={getAvailableSet(pill.type)}
                      sizeDisplayMap={sizeDisplayMap}
                      colorFamilyHex={colorFamilyHex}
                    />
                  )}
                </div>
              );
            })}

            {/* All Filters */}
            <button
              onClick={onAllFilters}
              className={`flex items-center gap-1.5 flex-shrink-0 px-4 py-1.5 text-[11px] font-sans font-medium tracking-[0.14em] uppercase border transition-colors duration-150 cursor-pointer ${
                activeCount > 0
                  ? "border-storefront-gold text-storefront-gold hover:border-storefront-charcoal hover:text-storefront-charcoal"
                  : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal hover:text-storefront-charcoal"
              }`}
            >
              <SlidersHorizontal size={12} />
              All Filters
              {activeCount > 0 && (
                <span className="ml-0.5 text-[10px] opacity-75">
                  ({activeCount})
                </span>
              )}
            </button>
          </div>

          {/* Item count */}
          {!loading && (
            <span className="flex-shrink-0 text-[11px] font-sans tracking-[0.12em] text-storefront-muted uppercase">
              {totalCount.toLocaleString("en-IN")} items
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
