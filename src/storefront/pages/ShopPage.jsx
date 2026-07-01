import React, { useState, useCallback } from "react";
import { X } from "lucide-react";
import useShopFilters from "../hooks/useShopFilters";
import FilterBar from "../components/shop/FilterBar";
import AllFiltersPanel from "../components/shop/AllFiltersPanel";
import ProductGrid from "../components/shop/ProductGrid";

function ActiveChips({ filters, categoryOptions, sizeDisplayMap, onClearOne, onClearAll }) {
  const chips = [];

  filters.categories.forEach((id) => {
    const cat = categoryOptions.find((c) => c.categoryid === id);
    if (cat) chips.push({ label: cat.name, field: "categories", value: id });
  });
  filters.colors.forEach((v) => chips.push({ label: v, field: "colors", value: v }));
  filters.sizes.forEach((v) => chips.push({ label: sizeDisplayMap[v] ?? v, field: "sizes", value: v }));
  filters.fabrics.forEach((v) => chips.push({ label: v, field: "fabrics", value: v }));
  if (filters.priceMin !== null || filters.priceMax !== null) {
    const min = filters.priceMin != null ? `₹${Number(filters.priceMin).toLocaleString("en-IN")}` : "₹0";
    const max = filters.priceMax != null ? `₹${Number(filters.priceMax).toLocaleString("en-IN")}` : "";
    chips.push({ label: max ? `${min} – ${max}` : `From ${min}`, field: "price", value: "price" });
  }

  if (chips.length === 0) return null;

  return (
    <div className="border-b border-storefront-border bg-storefront-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => onClearOne(chip.field, chip.value)}
              className="flex items-center gap-1.5 bg-storefront-charcoal text-storefront-cream font-sans text-[10px] tracking-wide px-3 py-1 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer"
            >
              {chip.label}
              <X size={10} className="opacity-70" />
            </button>
          ))}
          <button
            onClick={onClearAll}
            className="text-[10px] font-sans text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2 transition-colors duration-150 cursor-pointer ml-1 tracking-wide"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShopPage() {
  const {
    filters,
    products,
    loading,
    loadingMore,
    hasMore,
    totalCount,
    fetchNextPage,
    toggle,
    setPrice,
    clearAll,
    clearOne,
    clearField,
    activeCount,
    categoryOptions,
    colorOptions,
    sizeOptions,
    sizeDisplayMap,
    fabricOptions,
    priceBounds,
    availableOptions,
  } = useShopFilters();

  const [openDropdown, setOpenDropdown] = useState(null);
  const [showAllFilters, setShowAllFilters] = useState(false);

  const handleToggleDropdown = useCallback((type) => {
    setShowAllFilters(false);
    setOpenDropdown(type);
  }, []);

  const handleAllFilters = useCallback(() => {
    setOpenDropdown(null);
    setShowAllFilters((prev) => !prev);
  }, []);

  const clearCategories = useCallback(() => {
    clearField("categories");
  }, [clearField]);

  return (
    <div className="min-h-screen bg-storefront-cream">
      {/* Page header */}
      <div className="border-b border-storefront-border bg-storefront-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 pb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
            <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
              Collection
            </span>
          </div>
          <h1 className="font-display font-semibold text-5xl sm:text-6xl text-storefront-charcoal leading-none">
            Shop
          </h1>
          <p className="font-sans text-sm text-storefront-muted mt-3">
            Handcrafted garments, thoughtfully made.
          </p>
        </div>
      </div>

      {/* Filters */}
      <FilterBar
        filters={filters}
        openDropdown={openDropdown}
        onToggleDropdown={handleToggleDropdown}
        onAllFilters={handleAllFilters}
        onToggle={toggle}
        onSetPrice={setPrice}
        activeCount={activeCount}
        totalCount={totalCount}
        loading={loading}
        categoryOptions={categoryOptions}
        colorOptions={colorOptions}
        sizeOptions={sizeOptions}
        sizeDisplayMap={sizeDisplayMap}
        fabricOptions={fabricOptions}
        availableOptions={availableOptions}
      />

      <AllFiltersPanel
        open={showAllFilters}
        filters={filters}
        categoryOptions={categoryOptions}
        colorOptions={colorOptions}
        sizeOptions={sizeOptions}
        sizeDisplayMap={sizeDisplayMap}
        fabricOptions={fabricOptions}
        priceBounds={priceBounds}
        onToggle={toggle}
        onClearCategories={clearCategories}
        onSetPrice={setPrice}
        onClearAll={clearAll}
        onClose={() => setShowAllFilters(false)}
        availableOptions={availableOptions}
      />

      <ActiveChips
        filters={filters}
        categoryOptions={categoryOptions}
        sizeDisplayMap={sizeDisplayMap}
        onClearOne={clearOne}
        onClearAll={clearAll}
      />

      {/* Product grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <ProductGrid
          products={products}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          fetchNextPage={fetchNextPage}
        />
      </div>
    </div>
  );
}
