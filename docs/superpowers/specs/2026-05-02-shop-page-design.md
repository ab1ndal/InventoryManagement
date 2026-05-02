# Shop Page Design

**Date:** 2026-05-02  
**Status:** Approved

## Overview

Public-facing storefront shop page at `/shop`. Allows customers to browse all products with multi-select filtering by category, color, size, price, and fabric. 3-column grid with infinite scroll and lazy-loaded images. Clean minimalist aesthetic using existing cream/charcoal/gold design system.

---

## Architecture

### Route

Add inside `StorefrontLayout` in `App.js`:
```jsx
<Route path="shop" element={<ShopPage />} />
```

### New Files

```
src/storefront/pages/ShopPage.jsx
src/storefront/hooks/useShopFilters.js
src/storefront/components/shop/CategoryRow.jsx
src/storefront/components/shop/FilterBar.jsx
src/storefront/components/shop/FilterDropdown.jsx
src/storefront/components/shop/AllFiltersPanel.jsx
src/storefront/components/shop/ProductGrid.jsx
```

### Component Hierarchy

```
ShopPage
├── CategoryRow
├── FilterBar
│   └── FilterDropdown (conditionally rendered per pill)
├── AllFiltersPanel (conditionally rendered)
├── ActiveFilterChips (inline, shown when ≥1 filter active)
└── ProductGrid
    └── ProductCard (existing, reused)
```

---

## Data Layer

### `useShopFilters` Hook

Owns all filter state and Supabase query logic. `ShopPage` calls this hook and passes slices to children.

**State shape:**
```js
{
  categories: [],   // string[] of category IDs
  colors: [],       // string[]
  sizes: [],        // string[]
  fabrics: [],      // string[]
  priceMin: null,   // number | null
  priceMax: null,   // number | null
}
```

**Exposed API:**
- `filters` — current state
- `toggle(field, value)` — add/remove value from array filter (multi-select)
- `setPrice(min, max)` — set price range
- `clearAll()` — reset all filters
- `clearOne(field, value)` — remove single value from array filter
- `clearPrice()` — reset price range to null/null
- `activeCount` — total active filter count (for badges)

**Option lists** (fetched once on mount, cached in hook):
- `categoryOptions` — from `categories` table
- `colorOptions` — distinct from `productsizecolors`
- `sizeOptions` — distinct from `productsizecolors`
- `fabricOptions` — distinct from `products.fabric`

### Supabase Query Strategy

**PAGE_SIZE:** 24 products per page.

**Pagination:** `.range(offset, offset + 23)` — `offset` increments by 24 on each infinite scroll trigger.

**Filter application:**
| Filter | Strategy |
|--------|----------|
| Category | `.in('category_id', selectedIds)` on `products` |
| Size / Color | Fetch matching `product_id[]` from `productsizecolors` first, then `.in('productid', ids)` |
| Price | `.gte('retailprice', priceMin).lte('retailprice', priceMax)` |
| Fabric | `.in('fabric', fabrics)` |

When filters change, reset `offset` to 0 and replace (not append) the products array.

---

## UI Components

### `CategoryRow`

- Horizontally scrollable, hidden scrollbar (`overflow-x: auto`, `scrollbar-width: none`)
- Pills: "All" + first ~8 categories visible + "+N more" chip
- "+N more" opens `AllFiltersPanel` pre-scrolled to Category section
- Selected: charcoal fill + cream text. Unselected: border-only
- Multi-select: clicking additional category appends, does not replace
- Clicking "All" clears category selection

### `FilterBar`

- Row of pill buttons: COLOR · SIZE · PRICE · FABRIC · `⊞ ALL FILTERS`
- Active badge on pill when selections exist: `SIZE (2)`
- Clicking pill toggles its `FilterDropdown` (closes others)
- "ALL FILTERS" opens `AllFiltersPanel`
- Clicking outside closes open dropdown

### `FilterDropdown`

Inline panel below its pill. `position: absolute`, `z-index: 50`. Closes on outside click or Apply.

| Filter | UI |
|--------|----|
| Color | Color swatch grid (circles), selected state: gold ring |
| Size | Pill grid, toggle charcoal fill on select |
| Price | Two `input[type=range]` overlaid, custom styled with gold track |
| Fabric | Checkbox list with label |

Footer: `{N} selected · Apply` — Apply closes dropdown. Fetch is triggered reactively by filter state change via `useEffect` in `ShopPage`.

### `AllFiltersPanel`

- Full-width panel, slides down from filter bar (`max-height` CSS transition)
- 4 columns: Category (scrollable list) · Size (pill grid) · Color (swatch grid) · Price + Fabric
- "Clear all" link + "Apply Filters" CTA (charcoal fill) at bottom right
- Clicking outside or Apply closes panel

### Active Filter Chips

- Row below `FilterBar`, only visible when ≥1 filter active
- Each chip: `{label} ×` — clicking × calls `clearOne`
- "Clear all" chip at end calls `clearAll`
- Chips use charcoal fill + cream text

### `ProductGrid`

- CSS grid, 3 columns (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`), `gap-6`
- Reuses existing `ProductCard` component
- **Loading skeleton:** 6 gray placeholder cards (`animate-pulse`) on initial load
- **Infinite scroll:** `IntersectionObserver` on sentinel `<div>` at grid bottom. When sentinel enters viewport and `hasMore === true`, fetch next page and append to `products[]`
- **Empty state:** minimal centered text "No products match your filters" + "Clear filters" link
- **Result count:** shown in `FilterBar` row right side: `{N} ITEMS`

---

## Design Tokens (existing)

| Token | Value |
|-------|-------|
| `storefront-charcoal` | `#1C1917` |
| `storefront-gold` | `#A16207` |
| `storefront-cream` | `#FAFAF9` |
| `storefront-muted` | `#78716C` |
| `storefront-border` | `#D6D3D1` |
| Font heading | Cormorant |
| Font body | Montserrat |

---

## Behaviour Notes

- Filter changes reset pagination and replace product list (not append)
- Only one `FilterDropdown` open at a time
- `AllFiltersPanel` and `FilterDropdown` are mutually exclusive
- Category selections from `CategoryRow` and `AllFiltersPanel` stay in sync (same state)
- Price range slider min cannot exceed max
- `loading="lazy"` on all product images (already on `ProductCard`)
