# Dynamic Filter Reduction — Design Spec

Date: 2026-05-02

## Overview

When a user selects a filter option, all other filter options that would produce zero results are grayed out (but remain visible). Available options are sorted to the top of each list. This prevents dead-end filter states and improves discoverability.

## Approach

Client-side catalog index. Fetch a lightweight index of all products and their variants once on mount. Compute available options in-memory on every filter change. No extra DB calls after initial load.

Chosen over server-side re-query because the catalog is small enough to fit in memory, and instant UX (no loading states between filter clicks) is significantly better for shoppers.

## Data Layer — `useShopFilters.js`

### Catalog Index

New state: `catalogIndex` — array of enriched product records:

```ts
type CatalogEntry = {
  productid: string;
  categoryid: string;
  fabric: string | null;
  retailprice: number;
  colors: string[];
  sizes: string[];
};
```

Built in the existing `fetchOptions` `useEffect` by joining:
- `products` table: `productid, categoryid, fabric, retailprice`
- `productsizecolors` table: `productid, color, size` (grouped by productid)

### Available Options Memo

`availableOptions` — recomputes whenever `filters` or `catalogIndex` changes.

For each dimension, the available set is computed by filtering `catalogIndex` using ALL other active dimensions (cross-filter faceting). The dimension itself is excluded from its own filter so users can still add to a multi-select.

```
availableCategories = products matching (colors ∩ sizes ∩ fabrics ∩ price)
availableColors     = products matching (categories ∩ sizes ∩ fabrics ∩ price)
availableSizes      = products matching (categories ∩ colors ∩ fabrics ∩ price)
availableFabrics    = products matching (categories ∩ colors ∩ sizes ∩ price)
```

Returns `{ categories: Set<string>, colors: Set<string>, sizes: Set<string>, fabrics: Set<string> }`.

Hook exposes `availableOptions` as a new return value.

## UI Layer

Affected components: `AllFiltersPanel.jsx`, `FilterBar.jsx`, `FilterDropdown.jsx`.

### Sorting

Each option list is split into two groups before rendering:
1. Available options (in `availableOptions` set for that dimension) — sorted to top
2. Unavailable options — sorted to bottom

Sorting is done with `useMemo` on `[options, availableSet]` to avoid re-sorting on every render.

### Graying

Unavailable options receive `opacity-40 cursor-not-allowed pointer-events-none` classes.

**Exception:** Options that are currently selected always render as active (full opacity, selected style), even if they become unavailable due to other filters. A user's explicit selection is never silently hidden.

### Unchanged

- Active filter chips
- Clear all / clear field
- Price range inputs
- Layout and spacing
- Pagination / product grid

## Files Changed

| File | Change |
|------|--------|
| `src/storefront/hooks/useShopFilters.js` | Add `catalogIndex` state, `availableOptions` memo, expose both |
| `src/storefront/components/shop/AllFiltersPanel.jsx` | Sort + gray options per dimension |
| `src/storefront/components/shop/FilterBar.jsx` | Pass `availableOptions` down to `FilterDropdown` |
| `src/storefront/components/shop/FilterDropdown.jsx` | Sort + gray options |
