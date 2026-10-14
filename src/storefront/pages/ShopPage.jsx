import React, { useState, useCallback } from "react";
import { X, SlidersHorizontal } from "lucide-react";
import useShopFilters from "../hooks/useShopFilters";
import FilterSidebar from "../components/shop/FilterSidebar";
import FilterDrawer from "../components/shop/FilterDrawer";
import ProductGrid from "../components/shop/ProductGrid";
import SortControl from "../components/shop/SortControl";
import Seo from "../components/Seo";

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
    <div className="flex items-center gap-2 flex-wrap mt-3">
      {chips.map((chip, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onClearOne(chip.field, chip.value)}
          aria-label={`Remove filter ${chip.label}`}
          className="flex items-center gap-1.5 bg-storefront-charcoal text-storefront-cream font-sans text-[10px] tracking-wide px-3 py-1 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-storefront-charcoal focus-visible:ring-offset-2"
        >
          {chip.label}
          <X size={10} className="opacity-70" aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-[10px] font-sans text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2 transition-colors duration-150 cursor-pointer ml-1 tracking-wide"
      >
        Clear all
      </button>
    </div>
  );
}

function productCountLabel(n) {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? "product" : "products"}`;
}

function LoadError({ message, onRetry }) {
  return (
    <div role="alert" className="py-24 text-center">
      <p className="font-display text-2xl text-storefront-charcoal mb-2">
        Couldn't load products
      </p>
      <p className="font-sans text-sm text-storefront-muted mb-6">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="bg-storefront-charcoal text-storefront-cream font-sans text-[11px] font-medium tracking-widest uppercase px-8 py-2.5 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-gold focus-visible:ring-offset-2"
        >
          Retry
        </button>
      )}
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
    sortBy,
    setSortBy,
    toggle,
    setPrice,
    clearAll,
    clearOne,
    clearField,
    activeCount,
    categoryOptions,
    colorOptions,
    colorFamilyHex,
    sizeOptions,
    sizeDisplayMap,
    fabricOptions,
    availableOptions,
    baseOptions,
    error,
    retry,
  } = useShopFilters();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Stable so the drawer's open effect (focus, scroll lock) runs once per open.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Mounted twice: desktop column and mobile drawer. Each is display:none at
  // the other breakpoint, so only one is ever interactive.
  const sidebar = (
    <FilterSidebar
      filters={filters}
      categoryOptions={categoryOptions}
      colorOptions={colorOptions}
      colorFamilyHex={colorFamilyHex}
      sizeOptions={sizeOptions}
      sizeDisplayMap={sizeDisplayMap}
      fabricOptions={fabricOptions}
      availableOptions={availableOptions}
      baseOptions={baseOptions}
      toggle={toggle}
      setPrice={setPrice}
      clearField={clearField}
      clearOne={clearOne}
    />
  );

  return (
    <div className="min-h-screen bg-storefront-cream">
      <Seo title="Shop" description="Browse our handpicked sarees, lehengas, suits, and ethnic wear." />
      {/* Page header */}
      <div className="border-b border-storefront-border bg-storefront-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display font-semibold text-3xl sm:text-4xl text-storefront-charcoal leading-none">
            Shop
          </h1>
          <p className="font-sans text-sm text-storefront-muted">
            Handpicked with love, for every occasion.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 lg:flex lg:gap-10">
        {/* Desktop sidebar: sticks below the site header, scrolls on its own */}
        <aside aria-label="Product filters" className="hidden lg:block w-[220px] flex-shrink-0">
          <div className="sticky top-[174px] max-h-[calc(100vh-198px)] overflow-y-auto overscroll-contain pr-4 pb-6">
            {sidebar}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {/* Toolbar: filters (mobile) · count · sort, then active chips */}
          <div className="mb-5 pb-4 border-b border-storefront-border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={drawerOpen}
                  className="lg:hidden flex items-center gap-2 border border-storefront-border px-3 py-1.5 font-sans text-xs tracking-wide text-storefront-charcoal hover:border-storefront-charcoal transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-storefront-charcoal"
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  Filters{activeCount > 0 && ` (${activeCount})`}
                </button>
                <p
                  aria-live="polite"
                  className="font-sans text-xs tracking-wide text-storefront-muted tabular-nums"
                >
                  {loading ? "Loading…" : productCountLabel(totalCount)}
                </p>
              </div>
              <SortControl value={sortBy} onChange={setSortBy} />
            </div>
            <ActiveChips
              filters={filters}
              categoryOptions={categoryOptions}
              sizeDisplayMap={sizeDisplayMap}
              onClearOne={clearOne}
              onClearAll={clearAll}
            />
          </div>

          {error ? (
            <LoadError message={error} onRetry={retry} />
          ) : (
            <ProductGrid
              products={products}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              fetchNextPage={fetchNextPage}
            />
          )}
        </div>
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        footerLabel={loading ? "Show products" : `Show ${productCountLabel(totalCount)}`}
      >
        {sidebar}
      </FilterDrawer>
    </div>
  );
}
