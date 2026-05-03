# Phase 0: Product Detail Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/product/:productid` route showing product image, details, size/colour variant picker, stock status, and a (stub) Add to Cart button — the prerequisite for all cart and checkout phases.

**Architecture:** `ProductDetailPage` fetches product + variants via `useProduct` hook, passes variants to `VariantPicker` for selection, enables the Add to Cart button only when a fully valid in-stock variant is selected. The button is a stub (no-op) in this phase — wired to `CartContext` in Phase 1.

**Tech Stack:** React 19, Supabase (`lib/supabaseClient`), React Router v6 (`useParams`), Tailwind CSS (storefront theme classes), `@testing-library/react` + Jest

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/storefront/hooks/useProduct.js` | Create | Fetch product + variants from Supabase |
| `src/storefront/components/product/VariantPicker.jsx` | Create | Size → colour cascading selector with stock-aware disabling |
| `src/storefront/pages/ProductDetailPage.jsx` | Create | Page layout: image, details, VariantPicker, Add to Cart |
| `src/storefront/__tests__/useProduct.test.js` | Create | Hook unit tests (Supabase mocked) |
| `src/storefront/__tests__/VariantPicker.test.jsx` | Create | Component unit tests |
| `src/App.js` | Modify | Add `/product/:productid` route inside `StorefrontLayout` |

---

### Task 1: Add route and skeleton page

**Files:**
- Modify: `src/App.js`
- Create: `src/storefront/pages/ProductDetailPage.jsx`

- [ ] **Step 1: Create skeleton ProductDetailPage**

Create `src/storefront/pages/ProductDetailPage.jsx`:

```jsx
import React from "react";

export default function ProductDetailPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
      <p className="font-montserrat text-storefront-muted">Loading product…</p>
    </div>
  );
}
```

- [ ] **Step 2: Add route to App.js**

In `src/App.js`, add the import after the existing storefront page imports:

```js
import ProductDetailPage from "./storefront/pages/ProductDetailPage";
```

Inside `<Route path="/" element={<StorefrontLayout />}>`, add after the `shop` route:

```jsx
<Route path="product/:productid" element={<ProductDetailPage />} />
```

The `StorefrontLayout` route block should now read:

```jsx
<Route path="/" element={<StorefrontLayout />}>
  <Route index element={<HomePage />} />
  <Route path="shop" element={<ShopPage />} />
  <Route path="product/:productid" element={<ProductDetailPage />} />
</Route>
```

- [ ] **Step 3: Verify route renders**

```bash
npm start
```

Navigate to `http://localhost:3000/product/BC25001`. Expect: "Loading product…" text on screen, no console errors, header and footer visible.

- [ ] **Step 4: Commit**

```bash
git add src/App.js src/storefront/pages/ProductDetailPage.jsx
git commit -m "feat(storefront): add /product/:productid route with skeleton page"
```

---

### Task 2: useProduct hook (TDD)

**Files:**
- Create: `src/storefront/__tests__/useProduct.test.js`
- Create: `src/storefront/hooks/useProduct.js`

- [ ] **Step 1: Write failing tests**

Create `src/storefront/__tests__/useProduct.test.js`:

```js
import { renderHook, waitFor } from "@testing-library/react";
import { useProduct } from "../hooks/useProduct";

jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = require("lib/supabaseClient");

const MOCK_PRODUCT = {
  productid: "BC25001",
  name: "Silk Kurta",
  retailprice: 3500,
  fabric: "Silk",
  producturl: null,
  image_url: null,
  categories: { name: "Kurtas" },
};

const MOCK_VARIANTS = [
  { id: "v1", size: "S", color: "Red", stock: 2 },
  { id: "v2", size: "S", color: "Blue", stock: 0 },
  { id: "v3", size: "M", color: "Red", stock: 1 },
];

function mockSuccess() {
  supabase.from.mockImplementation((table) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: MOCK_PRODUCT, error: null }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: MOCK_VARIANTS, error: null }),
          }),
        }),
      }),
    };
  });
}

function mockProductError() {
  supabase.from.mockImplementation((table) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: null, error: { message: "Not found" } }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    };
  });
}

beforeEach(() => jest.clearAllMocks());

describe("useProduct", () => {
  it("starts in loading state", () => {
    mockSuccess();
    const { result } = renderHook(() => useProduct("BC25001"));
    expect(result.current.loading).toBe(true);
    expect(result.current.product).toBeNull();
    expect(result.current.variants).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("returns product and variants on success", async () => {
    mockSuccess();
    const { result } = renderHook(() => useProduct("BC25001"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.product).toEqual(MOCK_PRODUCT);
    expect(result.current.variants).toEqual(MOCK_VARIANTS);
    expect(result.current.error).toBeNull();
  });

  it("returns error when product fetch fails", async () => {
    mockProductError();
    const { result } = renderHook(() => useProduct("BC25001"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual({ message: "Not found" });
    expect(result.current.product).toBeNull();
  });

  it("does nothing when productId is undefined", () => {
    const { result } = renderHook(() => useProduct(undefined));
    expect(result.current.loading).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --watchAll=false --testPathPattern="useProduct"
```

Expected: `FAIL` — `Cannot find module '../hooks/useProduct'`

- [ ] **Step 3: Implement useProduct hook**

Create `src/storefront/hooks/useProduct.js`:

```js
import { useState, useEffect } from "react";
import { supabase } from "lib/supabaseClient";

export function useProduct(productId) {
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!productId) return;

    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);

      const [productRes, variantsRes] = await Promise.all([
        supabase
          .from("products")
          .select("*, categories(name)")
          .eq("productid", productId)
          .single(),
        supabase
          .from("productsizecolors")
          .select("id, size, color, stock")
          .eq("productid", productId)
          .order("size")
          .order("color"),
      ]);

      if (cancelled) return;

      if (productRes.error) {
        setError(productRes.error);
        setLoading(false);
        return;
      }

      setProduct(productRes.data);
      setVariants(variantsRes.data ?? []);
      setLoading(false);
    }

    fetch();
    return () => { cancelled = true; };
  }, [productId]);

  return { product, variants, loading, error };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --watchAll=false --testPathPattern="useProduct"
```

Expected: `PASS src/storefront/__tests__/useProduct.test.js` — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/storefront/hooks/useProduct.js src/storefront/__tests__/useProduct.test.js
git commit -m "feat(storefront): add useProduct hook with tests"
```

---

### Task 3: VariantPicker component (TDD)

**Files:**
- Create: `src/storefront/__tests__/VariantPicker.test.jsx`
- Create: `src/storefront/components/product/VariantPicker.jsx`

- [ ] **Step 1: Write failing tests**

Create `src/storefront/__tests__/VariantPicker.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import VariantPicker from "../components/product/VariantPicker";

const VARIANTS = [
  { id: "v1", size: "S", color: "Red", stock: 2 },
  { id: "v2", size: "S", color: "Blue", stock: 0 },
  { id: "v3", size: "M", color: "Red", stock: 1 },
  { id: "v4", size: "M", color: "Blue", stock: 3 },
  { id: "v5", size: "L", color: "Red", stock: 0 },
];

// L has only stock=0 — all colours unavailable, so size L is unavailable overall.

describe("VariantPicker — sizes", () => {
  it("renders all unique sizes", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "S" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "M" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "L" })).toBeInTheDocument();
  });

  it("disables a size when all its colours have stock=0", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "L" })).toBeDisabled();
  });

  it("does not disable a size that has at least one colour in stock", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "S" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "M" })).not.toBeDisabled();
  });
});

describe("VariantPicker — colour reveal", () => {
  it("does not show colours before a size is selected", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
    expect(screen.queryByText("Blue")).not.toBeInTheDocument();
  });

  it("shows colours for selected size after clicking a size", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("disables a colour when its stock=0 for the selected size", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
  });

  it("enables a colour when its stock>0 for the selected size", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByRole("button", { name: "Red" })).not.toBeDisabled();
  });

  it("resets colours shown when size changes", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    // M has Red and Blue — different set from S (S also has Red+Blue but both available for M)
    expect(screen.getByRole("button", { name: "Red" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Blue" })).not.toBeDisabled();
  });
});

describe("VariantPicker — onVariantSelect callback", () => {
  it("calls onVariantSelect(null) when a size is selected", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onVariantSelect with matching variant when colour selected after size", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    expect(onSelect).toHaveBeenLastCalledWith(VARIANTS[0]); // { id: "v1", size: "S", color: "Red", stock: 2 }
  });

  it("calls onVariantSelect(null) when size changes after a colour was selected", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("does not call onVariantSelect when a disabled colour is clicked", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Blue" })); // stock=0, disabled
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --watchAll=false --testPathPattern="VariantPicker"
```

Expected: `FAIL` — `Cannot find module '../components/product/VariantPicker'`

- [ ] **Step 3: Create directory and implement VariantPicker**

```bash
mkdir -p src/storefront/components/product
```

Create `src/storefront/components/product/VariantPicker.jsx`:

```jsx
import React, { useState, useMemo } from "react";

export default function VariantPicker({ variants, onVariantSelect }) {
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedColor, setSelectedColor] = useState(null);

  const sizes = useMemo(() => {
    const totals = {};
    for (const v of variants) {
      totals[v.size] = (totals[v.size] ?? 0) + v.stock;
    }
    return Object.entries(totals).map(([size, totalStock]) => ({
      size,
      available: totalStock > 0,
    }));
  }, [variants]);

  const colors = useMemo(() => {
    if (!selectedSize) return [];
    return variants
      .filter((v) => v.size === selectedSize)
      .map((v) => ({ id: v.id, color: v.color, available: v.stock > 0 }));
  }, [variants, selectedSize]);

  function handleSizeClick(size, available) {
    if (!available) return;
    setSelectedSize(size);
    setSelectedColor(null);
    onVariantSelect(null);
  }

  function handleColorClick(variantOption) {
    if (!variantOption.available) return;
    setSelectedColor(variantOption.color);
    const match = variants.find(
      (v) => v.size === selectedSize && v.color === variantOption.color
    );
    onVariantSelect(match ?? null);
  }

  return (
    <div className="space-y-5">
      {/* Sizes */}
      <div>
        <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal mb-2.5 font-montserrat">
          Size
          {selectedSize && (
            <span className="font-normal text-storefront-muted ml-2 normal-case tracking-normal">
              — {selectedSize}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {sizes.map(({ size, available }) => (
            <button
              key={size}
              onClick={() => handleSizeClick(size, available)}
              disabled={!available}
              className={`px-3.5 py-1.5 text-xs border font-montserrat tracking-wide transition-colors duration-150 ${
                selectedSize === size
                  ? "border-storefront-charcoal bg-storefront-charcoal text-storefront-cream"
                  : available
                  ? "border-storefront-border text-storefront-charcoal hover:border-storefront-charcoal cursor-pointer"
                  : "border-storefront-border text-storefront-muted line-through cursor-not-allowed opacity-40"
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Colours — only shown after a size is selected */}
      {selectedSize && (
        <div>
          <p className="text-[10px] font-medium tracking-[0.15em] uppercase text-storefront-charcoal mb-2.5 font-montserrat">
            Colour
            {selectedColor && (
              <span className="font-normal text-storefront-muted ml-2 normal-case tracking-normal">
                — {selectedColor}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((variantOption) => (
              <button
                key={variantOption.id}
                onClick={() => handleColorClick(variantOption)}
                disabled={!variantOption.available}
                className={`px-3.5 py-1.5 text-xs border font-montserrat tracking-wide transition-colors duration-150 ${
                  selectedColor === variantOption.color
                    ? "border-storefront-charcoal bg-storefront-charcoal text-storefront-cream"
                    : variantOption.available
                    ? "border-storefront-border text-storefront-charcoal hover:border-storefront-charcoal cursor-pointer"
                    : "border-storefront-border text-storefront-muted line-through cursor-not-allowed opacity-40"
                }`}
              >
                {variantOption.color}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --watchAll=false --testPathPattern="VariantPicker"
```

Expected: `PASS src/storefront/__tests__/VariantPicker.test.jsx` — 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/storefront/components/product/VariantPicker.jsx src/storefront/__tests__/VariantPicker.test.jsx
git commit -m "feat(storefront): add VariantPicker component with tests"
```

---

### Task 4: ProductDetailPage — full implementation

**Files:**
- Modify: `src/storefront/pages/ProductDetailPage.jsx`

No new tests for the page itself — `useProduct` and `VariantPicker` are tested in isolation. The page is an integration of already-tested units.

- [ ] **Step 1: Replace skeleton with full implementation**

Replace the contents of `src/storefront/pages/ProductDetailPage.jsx`:

```jsx
import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { useProduct } from "../hooks/useProduct";
import VariantPicker from "../components/product/VariantPicker";

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  const url =
    product.image_url ||
    (product.producturl ? `${product.producturl}/display/image.jpg` : null);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={product.name}
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    );
  }

  const initials = product.name
    ? product.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "BC";

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-storefront-charcoal to-storefront-warm gap-3">
      <span className="font-cormorant text-5xl font-semibold text-storefront-gold opacity-60">
        {initials}
      </span>
      <span className="text-[10px] text-storefront-cream/40 tracking-widest uppercase font-montserrat">
        Image coming soon
      </span>
    </div>
  );
}

export default function ProductDetailPage() {
  const { productid } = useParams();
  const { product, variants, loading, error } = useProduct(productid);
  const [selectedVariant, setSelectedVariant] = useState(null);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 flex justify-center">
        <div className="w-7 h-7 border-2 border-storefront-charcoal border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <p className="font-montserrat text-storefront-muted text-sm mb-4">
          Product not found.
        </p>
        <Link
          to="/shop"
          className="text-xs font-montserrat tracking-widest uppercase text-storefront-gold hover:underline"
        >
          ← Back to Shop
        </Link>
      </div>
    );
  }

  const categoryName = product.categories?.name;
  const canAddToCart = selectedVariant !== null;
  const stockLabel =
    selectedVariant && selectedVariant.stock <= 3
      ? `Only ${selectedVariant.stock} left`
      : selectedVariant
      ? "In stock"
      : null;

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-8">
        {/* Breadcrumb */}
        <Link
          to="/shop"
          className="inline-flex items-center gap-1.5 text-[10px] font-montserrat tracking-[0.15em] uppercase text-storefront-muted hover:text-storefront-charcoal transition-colors mb-8"
        >
          <ArrowLeft size={11} />
          Shop
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          {/* Image */}
          <div className="aspect-[3/4] overflow-hidden bg-storefront-cream">
            <ProductImage product={product} />
          </div>

          {/* Details */}
          <div className="flex flex-col">
            {categoryName && (
              <span className="text-[10px] tracking-[0.2em] uppercase text-storefront-muted font-montserrat mb-2">
                {categoryName}
              </span>
            )}

            <h1 className="font-cormorant text-3xl lg:text-4xl font-semibold text-storefront-charcoal leading-tight mb-3">
              {product.name}
            </h1>

            <p className="font-montserrat text-2xl font-semibold text-storefront-charcoal tabular-nums mb-1">
              ₹{Number(product.retailprice).toLocaleString("en-IN")}
            </p>

            {product.fabric && (
              <p className="text-xs text-storefront-muted font-montserrat tracking-wide mb-6">
                {product.fabric}
              </p>
            )}

            <div className="border-t border-storefront-border pt-6 mb-6">
              {variants.length > 0 ? (
                <VariantPicker
                  variants={variants}
                  onVariantSelect={setSelectedVariant}
                />
              ) : (
                <p className="text-xs text-storefront-muted font-montserrat">
                  No variants available.
                </p>
              )}
            </div>

            {/* Desktop Add to Cart */}
            <div className="hidden md:block">
              <button
                disabled={!canAddToCart}
                onClick={() => {}} /* wired in Phase 1 */
                className="w-full flex items-center justify-center gap-2 bg-storefront-charcoal text-storefront-cream font-montserrat text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ShoppingBag size={15} />
                {canAddToCart ? "Add to Cart" : "Select Size & Colour"}
              </button>
              {stockLabel && (
                <p className="text-xs text-center text-storefront-muted font-montserrat mt-2.5">
                  {stockLabel}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-storefront-border px-4 py-3 z-40">
        <button
          disabled={!canAddToCart}
          onClick={() => {}} /* wired in Phase 1 */
          className="w-full flex items-center justify-center gap-2 bg-storefront-charcoal text-storefront-cream font-montserrat text-xs tracking-widest uppercase py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ShoppingBag size={15} />
          {canAddToCart ? "Add to Cart" : "Select Size & Colour"}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run all tests to confirm nothing broke**

```bash
npm test -- --watchAll=false
```

Expected: All tests pass. No regressions.

- [ ] **Step 3: Start dev server and manually verify**

```bash
npm start
```

Open `http://localhost:3000/product/BC25001` (replace with a real product ID from your database).

Verify:
- Product name, price, fabric render correctly
- Size buttons appear; clicking a size reveals colour buttons
- Out-of-stock sizes/colours are greyed out and unclickable
- "Add to Cart" button is disabled until both size and colour selected
- "Add to Cart" button becomes active after valid selection
- Mobile: sticky bottom bar shows instead of inline button on narrow screens
- "Back to Shop" link returns to `/shop`
- Invalid product ID (e.g. `/product/FAKE`) shows "Product not found"

- [ ] **Step 4: Commit**

```bash
git add src/storefront/pages/ProductDetailPage.jsx
git commit -m "feat(storefront): implement ProductDetailPage with image, variant picker, and add-to-cart stub"
```

---

## Self-Review

**Spec coverage:**
- ✅ `/product/:productid` route
- ✅ Image with fallback placeholder (matches ProductCard pattern)
- ✅ Product name, price in ₹, fabric, category badge
- ✅ Variant picker: size → colour cascade
- ✅ Out-of-stock variants greyed out, not hidden
- ✅ Available stock indicator (low stock label when ≤ 3)
- ✅ Add to Cart button disabled until variant selected (stub, wired Phase 1)
- ✅ Sticky mobile Add to Cart bar
- ✅ `ProductCard` links already point to `/product/:id` — no change needed

**No placeholders:** All code is complete. No TBD/TODO.

**Type consistency:** `onVariantSelect` prop name consistent across VariantPicker definition, VariantPicker tests, and ProductDetailPage usage. `useProduct` return shape `{ product, variants, loading, error }` consistent across hook, tests, and page.
