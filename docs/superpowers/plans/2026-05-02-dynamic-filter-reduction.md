# Dynamic Filter Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a filter option is selected, other filter options that would yield zero results are sorted to the bottom and grayed out, preventing dead-end filter states.

**Architecture:** Client-side catalog index built once on mount by joining `products` + `productsizecolors`. A pure `computeAvailableOptions` function cross-filters the index per dimension on every filter change, returning Sets of valid keys. UI components consume these Sets to sort and gray options.

**Tech Stack:** React 19, Supabase JS client, Tailwind CSS, Jest (CRA)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/storefront/hooks/filterUtils.js` | Create | Pure functions: `computeAvailableOptions`, `sortByAvailability` |
| `src/storefront/__tests__/filterUtils.test.js` | Create | Unit tests for both pure functions |
| `src/storefront/hooks/useShopFilters.js` | Modify | Fetch catalog index, call `computeAvailableOptions`, expose `availableOptions` |
| `src/storefront/components/shop/FilterDropdown.jsx` | Modify | Accept `availableSet` prop, sort + gray per type |
| `src/storefront/components/shop/FilterBar.jsx` | Modify | Accept + pass `availableOptions` slices to `FilterDropdown` |
| `src/storefront/components/shop/AllFiltersPanel.jsx` | Modify | Accept `availableOptions`, sort + gray all 4 dimensions |

---

## Task 1: Create `filterUtils.js` with pure computation functions

**Files:**
- Create: `src/storefront/hooks/filterUtils.js`

- [ ] **Step 1: Write the file**

```js
// src/storefront/hooks/filterUtils.js

function matchExcluding(entry, filters, exclude) {
  if (exclude !== "categories" && filters.categories.length > 0) {
    if (!filters.categories.includes(entry.categoryid)) return false;
  }
  if (exclude !== "fabrics" && filters.fabrics.length > 0) {
    if (!filters.fabrics.includes(entry.fabric)) return false;
  }
  if (exclude !== "price") {
    if (filters.priceMin !== null && entry.retailprice < filters.priceMin) return false;
    if (filters.priceMax !== null && entry.retailprice > filters.priceMax) return false;
  }
  if (exclude !== "colors" && filters.colors.length > 0) {
    if (!entry.colors.some((c) => filters.colors.includes(c))) return false;
  }
  if (exclude !== "sizes" && filters.sizes.length > 0) {
    if (!entry.sizes.some((s) => filters.sizes.includes(s))) return false;
  }
  return true;
}

export function computeAvailableOptions(catalogIndex, filters) {
  if (!catalogIndex.length) {
    return { categories: new Set(), colors: new Set(), sizes: new Set(), fabrics: new Set() };
  }

  const cats = new Set();
  const colors = new Set();
  const sizes = new Set();
  const fabrics = new Set();

  for (const entry of catalogIndex) {
    if (matchExcluding(entry, filters, "categories")) cats.add(entry.categoryid);
    if (matchExcluding(entry, filters, "colors")) entry.colors.forEach((c) => colors.add(c));
    if (matchExcluding(entry, filters, "sizes")) entry.sizes.forEach((s) => sizes.add(s));
    if (matchExcluding(entry, filters, "fabrics") && entry.fabric) fabrics.add(entry.fabric);
  }

  return { categories: cats, colors, sizes, fabrics };
}

export function sortByAvailability(items, getKey, availableSet) {
  if (!availableSet) return items;
  return [...items].sort((a, b) => {
    const aAvail = availableSet.has(getKey(a));
    const bAvail = availableSet.has(getKey(b));
    if (aAvail === bAvail) return 0;
    return aAvail ? -1 : 1;
  });
}
```

---

## Task 2: Write and pass tests for `filterUtils.js`

**Files:**
- Create: `src/storefront/__tests__/filterUtils.test.js`

- [ ] **Step 1: Write the test file**

```js
import { computeAvailableOptions, sortByAvailability } from "../hooks/filterUtils";

const CATALOG = [
  { productid: "p1", categoryid: "cat-kurta", fabric: "cotton", retailprice: 1000, colors: ["red", "blue"], sizes: ["S", "M"] },
  { productid: "p2", categoryid: "cat-kurta", fabric: "silk", retailprice: 2000, colors: ["green"], sizes: ["L"] },
  { productid: "p3", categoryid: "cat-saree", fabric: "cotton", retailprice: 1500, colors: ["red"], sizes: ["Free Size"] },
];

const NO_FILTERS = { categories: [], colors: [], sizes: [], fabrics: [], priceMin: null, priceMax: null };

describe("computeAvailableOptions", () => {
  it("returns all options when no filters active", () => {
    const r = computeAvailableOptions(CATALOG, NO_FILTERS);
    expect(r.categories).toEqual(new Set(["cat-kurta", "cat-saree"]));
    expect(r.colors).toEqual(new Set(["red", "blue", "green"]));
    expect(r.sizes).toEqual(new Set(["S", "M", "L", "Free Size"]));
    expect(r.fabrics).toEqual(new Set(["cotton", "silk"]));
  });

  it("restricts colors/sizes/fabrics when category filter active, not categories itself", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, categories: ["cat-kurta"] });
    expect(r.categories).toEqual(new Set(["cat-kurta", "cat-saree"]));
    expect(r.colors).toEqual(new Set(["red", "blue", "green"]));
    expect(r.sizes).toEqual(new Set(["S", "M", "L"]));
    expect(r.fabrics).toEqual(new Set(["cotton", "silk"]));
  });

  it("restricts categories when color filter active, not colors itself", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, colors: ["green"] });
    expect(r.categories).toEqual(new Set(["cat-kurta"]));
    expect(r.colors).toEqual(new Set(["red", "blue", "green"]));
  });

  it("filters by price range", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, priceMin: 1200, priceMax: 2000 });
    expect(r.categories).toEqual(new Set(["cat-kurta", "cat-saree"]));
    expect(r.colors).toEqual(new Set(["green", "red"]));
    expect(r.fabrics).toEqual(new Set(["silk", "cotton"]));
  });

  it("returns empty sets for empty catalog", () => {
    const r = computeAvailableOptions([], NO_FILTERS);
    expect(r.categories.size).toBe(0);
    expect(r.colors.size).toBe(0);
  });

  it("cross-filters: category + color restricts sizes", () => {
    const r = computeAvailableOptions(CATALOG, { ...NO_FILTERS, categories: ["cat-kurta"], colors: ["red"] });
    // only p1 matches both: sizes S, M
    expect(r.sizes).toEqual(new Set(["S", "M"]));
  });
});

describe("sortByAvailability", () => {
  it("puts available items before unavailable", () => {
    const items = ["blue", "red", "green"];
    const available = new Set(["red", "green"]);
    const sorted = sortByAvailability(items, (x) => x, available);
    expect(sorted.indexOf("red")).toBeLessThan(sorted.indexOf("blue"));
    expect(sorted.indexOf("green")).toBeLessThan(sorted.indexOf("blue"));
  });

  it("returns items unchanged when availableSet is null", () => {
    expect(sortByAvailability(["a", "b"], (x) => x, null)).toEqual(["a", "b"]);
  });

  it("does not mutate the original array", () => {
    const items = ["blue", "red"];
    const available = new Set(["red"]);
    sortByAvailability(items, (x) => x, available);
    expect(items).toEqual(["blue", "red"]);
  });
});
```

- [ ] **Step 2: Run tests — expect all to pass**

```bash
npx react-scripts test --watchAll=false --testPathPattern="filterUtils" --forceExit
```

Expected: `Tests: 9 passed`

- [ ] **Step 3: Commit**

```bash
git add src/storefront/hooks/filterUtils.js src/storefront/__tests__/filterUtils.test.js
git commit -m "feat(shop): add filterUtils pure functions for available-options computation"
```

---

## Task 3: Add catalog index + `availableOptions` to `useShopFilters`

**Files:**
- Modify: `src/storefront/hooks/useShopFilters.js`

- [ ] **Step 1: Add import at top of file**

Replace:
```js
import { useState, useEffect, useCallback } from "react";
```
With:
```js
import { useState, useEffect, useCallback, useMemo } from "react";
import { computeAvailableOptions } from "./filterUtils";
```

- [ ] **Step 2: Add `catalogIndex` state after existing state declarations (after line 28, `priceBounds`)**

Add this line after `const [priceBounds, setPriceBounds] = useState({ min: 0, max: 25000 });`:
```js
const [catalogIndex, setCatalogIndex] = useState([]);
```

- [ ] **Step 3: Extend `fetchOptions` to also fetch the catalog index**

The existing `fetchOptions` `useEffect` runs `Promise.all([cats, variants, fabrics, priceRange])`. Extend it to a 5-way Promise.all and build the index. Key change: add `productid` to the variants query so it doubles as the catalog index join — no extra sequential fetch needed. Replace the entire `useEffect` block (lines 30–64) with:

```js
useEffect(() => {
  async function fetchOptions() {
    const [cats, variants, fabrics, priceRange, allProducts] = await Promise.all([
      supabase.from("categories").select("categoryid, name").order("name"),
      supabase.from("productsizecolors").select("productid, color, size"),
      supabase.from("products").select("fabric").not("fabric", "is", null),
      supabase
        .from("products")
        .select("retailprice")
        .order("retailprice", { ascending: false })
        .limit(1),
      supabase.from("products").select("productid, categoryid, fabric, retailprice"),
    ]);

    setCategoryOptions(cats.data || []);

    if (variants.data) {
      const colors = [...new Set(variants.data.map((r) => r.color).filter(Boolean))].sort();
      const sizes = [...new Set(variants.data.map((r) => r.size).filter(Boolean))].sort();
      setColorOptions(colors);
      setSizeOptions(sizes);
    }

    if (fabrics.data) {
      setFabricOptions(
        [...new Set(fabrics.data.map((r) => r.fabric).filter(Boolean))].sort()
      );
    }

    if (priceRange.data?.[0]) {
      const max = Math.ceil(Number(priceRange.data[0].retailprice) / 500) * 500;
      setPriceBounds({ min: 0, max: max || 25000 });
    }

    if (allProducts.data && variants.data) {
      const variantMap = {};
      variants.data.forEach((v) => {
        if (!variantMap[v.productid]) variantMap[v.productid] = { colors: [], sizes: [] };
        if (v.color) variantMap[v.productid].colors.push(v.color);
        if (v.size) variantMap[v.productid].sizes.push(v.size);
      });

      setCatalogIndex(
        allProducts.data.map((p) => ({
          productid: p.productid,
          categoryid: p.categoryid,
          fabric: p.fabric,
          retailprice: Number(p.retailprice),
          colors: variantMap[p.productid]?.colors || [],
          sizes: variantMap[p.productid]?.sizes || [],
        }))
      );
    }
  }
  fetchOptions();
}, []);
```

- [ ] **Step 4: Add `availableOptions` memo after `runQuery` (after line 118)**

Add after the `runQuery` declaration:
```js
const availableOptions = useMemo(
  () => computeAvailableOptions(catalogIndex, filters),
  [catalogIndex, filters]
);
```

- [ ] **Step 5: Add `availableOptions` to the return object**

In the `return` block at the bottom, add `availableOptions` alongside the existing fields:
```js
return {
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
  clearPrice,
  clearField,
  activeCount,
  categoryOptions,
  colorOptions,
  sizeOptions,
  fabricOptions,
  priceBounds,
  availableOptions,
};
```

- [ ] **Step 6: Verify dev server starts without errors**

```bash
npm start
```

Check browser console — no errors. Filter bar loads with all options. Commit once clean.

- [ ] **Step 7: Commit**

```bash
git add src/storefront/hooks/useShopFilters.js
git commit -m "feat(shop): build catalog index and compute availableOptions in useShopFilters"
```

---

## Task 4: Update `FilterDropdown` to sort and gray options

**Files:**
- Modify: `src/storefront/components/shop/FilterDropdown.jsx`

- [ ] **Step 1: Add `sortByAvailability` import at top of file**

Add after existing imports:
```js
import { sortByAvailability } from "../../hooks/filterUtils";
```

- [ ] **Step 2: Add `availableSet` to the component props**

Replace:
```js
export default function FilterDropdown({
  type,
  options,
  selected,
  onToggle,
  priceMin,
  priceMax,
  onSetPrice,
  onApply,
}) {
```
With:
```js
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
}) {
```

- [ ] **Step 3: Add `ColorSwatch` unavailable prop and graying**

Replace the `ColorSwatch` component definition with:
```js
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
```

- [ ] **Step 4: Update category rendering block to sort + gray**

Replace the `{type === "category" && (...)}` block with:
```jsx
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
```

- [ ] **Step 5: Update color rendering block to sort + gray**

Replace the `{type === "color" && (...)}` block with:
```jsx
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
```

- [ ] **Step 6: Update size rendering block to sort + gray**

Replace the `{type === "size" && (...)}` block with:
```jsx
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
          {size}
        </button>
      );
    })}
  </div>
)}
```

- [ ] **Step 7: Update fabric rendering block to sort + gray**

Replace the `{type === "fabric" && (...)}` block with:
```jsx
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
```

- [ ] **Step 8: Commit**

```bash
git add src/storefront/components/shop/FilterDropdown.jsx
git commit -m "feat(shop): sort and gray unavailable options in FilterDropdown"
```

---

## Task 5: Pass `availableOptions` through `FilterBar` to `FilterDropdown`

**Files:**
- Modify: `src/storefront/components/shop/FilterBar.jsx`

- [ ] **Step 1: Add `availableOptions` to FilterBar props**

Replace:
```js
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
  fabricOptions,
}) {
```
With:
```js
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
  fabricOptions,
  availableOptions,
}) {
```

- [ ] **Step 2: Map pill types to their `availableSet`**

Add a helper inside the component, after `getBadgeCount`:
```js
function getAvailableSet(type) {
  if (!availableOptions) return undefined;
  if (type === "category") return availableOptions.categories;
  if (type === "color") return availableOptions.colors;
  if (type === "size") return availableOptions.sizes;
  if (type === "fabric") return availableOptions.fabrics;
  return undefined;
}
```

- [ ] **Step 3: Pass `availableSet` to `FilterDropdown`**

In the `FilterDropdown` render inside the PILLS map, add the `availableSet` prop:
```jsx
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
/>
```

- [ ] **Step 4: Update `ShopPage.jsx` to pass `availableOptions` to `FilterBar`**

In `src/storefront/pages/ShopPage.jsx`, destructure `availableOptions` from `useShopFilters()`:
```js
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
  fabricOptions,
  priceBounds,
  availableOptions,
} = useShopFilters();
```

Then pass it to `FilterBar`:
```jsx
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
  fabricOptions={fabricOptions}
  availableOptions={availableOptions}
/>
```

- [ ] **Step 5: Commit**

```bash
git add src/storefront/components/shop/FilterBar.jsx src/storefront/pages/ShopPage.jsx
git commit -m "feat(shop): wire availableOptions from hook through FilterBar to FilterDropdown"
```

---

## Task 6: Update `AllFiltersPanel` to sort and gray options

**Files:**
- Modify: `src/storefront/components/shop/AllFiltersPanel.jsx`

- [ ] **Step 1: Add `sortByAvailability` import**

Add after existing imports:
```js
import { sortByAvailability } from "../../hooks/filterUtils";
```

- [ ] **Step 2: Add `availableOptions` to component props**

Replace:
```js
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
}) {
```
With:
```js
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
```

- [ ] **Step 3: Update Category section to sort + gray**

Replace the Category `<div>` content (the `{categoryOptions.map(...)}` block) with:
```jsx
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
```

- [ ] **Step 4: Update Size section to sort + gray**

Replace the `{sizeOptions.map(...)}` block with:
```jsx
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
```

- [ ] **Step 5: Update Color section to sort + gray**

Replace the `{colorOptions.map((color) => {` block with:
```jsx
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
```

- [ ] **Step 6: Update Fabric section to sort + gray**

Replace the `{fabricOptions.map((fabric) => {` block with:
```jsx
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
      <span className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
        active
          ? "bg-storefront-charcoal border-storefront-charcoal"
          : "border-storefront-border group-hover:border-storefront-charcoal"
      }`}>
        {active && <Check size={10} className="text-white" />}
      </span>
      <span className="text-sm font-montserrat text-storefront-charcoal capitalize">
        {fabric}
      </span>
    </button>
  );
})}
```

- [ ] **Step 7: Pass `availableOptions` from `ShopPage` to `AllFiltersPanel`**

In `src/storefront/pages/ShopPage.jsx`, add `availableOptions` prop to `AllFiltersPanel`:
```jsx
<AllFiltersPanel
  open={showAllFilters}
  filters={filters}
  categoryOptions={categoryOptions}
  colorOptions={colorOptions}
  sizeOptions={sizeOptions}
  fabricOptions={fabricOptions}
  priceBounds={priceBounds}
  onToggle={toggle}
  onClearCategories={clearCategories}
  onSetPrice={setPrice}
  onClearAll={clearAll}
  onClose={() => setShowAllFilters(false)}
  availableOptions={availableOptions}
/>
```

- [ ] **Step 8: Smoke test in browser**

Start dev server (`npm start`). Navigate to shop page. Select a category filter — verify other filter dimensions reduce. Deselect — verify all options return. Check All Filters panel opens and shows same behavior.

- [ ] **Step 9: Commit**

```bash
git add src/storefront/components/shop/AllFiltersPanel.jsx src/storefront/pages/ShopPage.jsx
git commit -m "feat(shop): sort and gray unavailable options in AllFiltersPanel"
```
