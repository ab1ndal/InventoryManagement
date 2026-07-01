import React, { useRef } from "react";

export default function CategoryRow({
  categories,
  selected,
  onToggle,
  onClearCategories,
  onAllFilters,
}) {
  const scrollRef = useRef(null);
  const VISIBLE = 8;
  const visible = categories.slice(0, VISIBLE);
  const hidden = Math.max(0, categories.length - VISIBLE);
  const allSelected = selected.length === 0;

  const pillBase =
    "flex-shrink-0 px-4 py-1.5 text-[11px] font-medium font-sans tracking-[0.14em] uppercase border whitespace-nowrap transition-colors duration-150 cursor-pointer";
  const pillActive = "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal";
  const pillInactive =
    "border-storefront-border text-storefront-warm hover:border-storefront-charcoal hover:text-storefront-charcoal";

  return (
    <div className="border-b border-storefront-border bg-storefront-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          ref={scrollRef}
          className="flex items-center gap-2 py-3 overflow-x-auto"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <button
            onClick={onClearCategories}
            className={`${pillBase} ${allSelected ? pillActive : pillInactive}`}
          >
            All
          </button>

          {visible.map((cat) => (
            <button
              key={cat.categoryid}
              onClick={() => onToggle("categories", cat.categoryid)}
              className={`${pillBase} ${
                selected.includes(cat.categoryid) ? pillActive : pillInactive
              }`}
            >
              {cat.name}
            </button>
          ))}

          {hidden > 0 && (
            <button
              onClick={onAllFilters}
              className={`${pillBase} border-storefront-border text-storefront-muted hover:border-storefront-gold hover:text-storefront-gold`}
            >
              +{hidden} more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
