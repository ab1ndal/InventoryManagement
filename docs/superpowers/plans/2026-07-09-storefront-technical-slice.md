# Storefront Phase 1 Technical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the content-independent technical + trust work of Storefront Phase 1 — SEO, 404, shop sort, PDP delivery/low-stock honesty, footer/claims truth fixes, and an FAQ page — without any owner-content dependency.

**Architecture:** React 19 CRA SPA. Native React 19 document metadata for SEO (no library). Small pure helpers (`sortOrderClause`, `stockNote`, `buildProductJsonLd`) carry the testable logic; components stay thin. All storefront routes live under the `StorefrontLayout` in `src/App.js`. Supabase read via existing anon client.

**Tech Stack:** React 19.1, react-router-dom 7, Tailwind (storefront tokens: cream/charcoal/gold/muted/border, Fraunces display + Inter sans), react-scripts test (jest + jsdom + RTL), Supabase JS.

## Global Constraints

- **No new npm dependency.** SEO uses React 19 native metadata (`<title>`/`<meta>`/`<link>` hoist to `<head>`).
- **Real values only, verbatim:** phone/WhatsApp `919810873280` (display `+91 98108 73280`); email `bindalscreations@gmail.com`; Instagram `https://instagram.com/bindals_creation_shop`; Facebook `https://www.facebook.com/profile.php?id=61579168104897`; registered name `BINDAL'S CREATION`; address `58 Sihani Gate Market, Ghaziabad 201001`; GSTIN `09ABVPB4203A1Z4`; delivery `Dispatches in 2 days · Delivered in 5–7 days`; exchange `no returns; exchange within 7 days of purchase, unworn, in-store only`.
- **No COD anywhere.** Not offered; make no claim about it.
- Display brand stays `Bindal's Creations`; legal name `BINDAL'S CREATION` only in the footer legitimacy block + JSON-LD seller.
- Match existing storefront Tailwind idioms (`storefront-*` tokens, `font-display`/`font-sans`).
- Do NOT touch or attempt to fix `src/storefront/__tests__/CartDrawer.test.jsx` (pre-existing react-router-dom resolution failure, unrelated).
- Test run command: `CI=true npx react-scripts test <path> --watchAll=false`.
- Each task ends with a commit on branch `storefront-technical-slice`.

---

### Task 1: `Seo` component (React 19 native metadata)

**Files:**
- Create: `src/storefront/components/Seo.jsx`
- Test: `src/storefront/__tests__/Seo.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `export default function Seo({ title, description, image, type = "website", noindex = false, jsonLd })` — renders native `<title>`, `<meta>`, and optional JSON-LD `<script>`. Title is composed as `` `${title} — Bindal's Creations` `` (or just `Bindal's Creations` when `title` omitted). `image` may be an absolute URL or a root-relative path; a path is made absolute against `window.location.origin`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/Seo.test.jsx
import React from "react";
import { render } from "@testing-library/react";
import Seo from "../components/Seo";

describe("Seo", () => {
  it("composes the document title with the site name", () => {
    render(<Seo title="Shop" description="Browse" />);
    expect(document.title).toBe("Shop — Bindal's Creations");
  });

  it("falls back to the bare site name when no title", () => {
    render(<Seo description="Home" />);
    expect(document.title).toBe("Bindal's Creations");
  });

  it("renders a JSON-LD script when jsonLd provided", () => {
    const { container } = render(
      <Seo title="P" jsonLd={{ "@type": "Product", name: "P" }} />
    );
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script.innerHTML).name).toBe("P");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/Seo.test.jsx --watchAll=false`
Expected: FAIL — cannot find module `../components/Seo`.

- [ ] **Step 3: Write the component**

```jsx
// src/storefront/components/Seo.jsx
import React from "react";

const SITE_NAME = "Bindal's Creations";
const DEFAULT_OG_IMAGE = "/LOGO-BindalsCreation.png";

// React 19 hoists <title>/<meta>/<link> rendered anywhere into <head> and
// dedupes across route changes — no react-helmet needed. JSON-LD <script>
// is valid anywhere in the document for crawlers, so we render it in place.
export default function Seo({
  title,
  description,
  image,
  type = "website",
  noindex = false,
  jsonLd,
}) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const rawImage = image || DEFAULT_OG_IMAGE;
  const ogImage = rawImage.startsWith("http") ? rawImage : `${origin}${rawImage}`;
  const url = typeof window !== "undefined" ? window.location.href : undefined;

  return (
    <>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {noindex && <meta name="robots" content="noindex" />}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:type" content={type} />
      <meta property="og:image" content={ogImage} />
      {url && <meta property="og:url" content={url} />}
      <meta name="twitter:card" content="summary_large_image" />
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/Seo.test.jsx --watchAll=false`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storefront/components/Seo.jsx src/storefront/__tests__/Seo.test.jsx
git commit -m "Storefront SEO: add native-metadata Seo component"
```

---

### Task 2: 404 page + catch-all route

**Files:**
- Create: `src/storefront/pages/NotFoundPage.jsx`
- Modify: `src/App.js` (import + `*` route as last child of the `/` `StorefrontLayout` route, ~line 42-46)
- Test: `src/storefront/__tests__/NotFoundPage.test.jsx`

**Interfaces:**
- Consumes: `Seo` (Task 1).
- Produces: `export default function NotFoundPage()`; route `<Route path="*" element={<NotFoundPage />} />`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/NotFoundPage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotFoundPage from "../pages/NotFoundPage";

describe("NotFoundPage", () => {
  it("renders the not-found heading and a link to shop", () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /continue shopping/i })).toHaveAttribute("href", "/shop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/NotFoundPage.test.jsx --watchAll=false`
Expected: FAIL — cannot find module `../pages/NotFoundPage`.

> If this test errors on `react-router-dom` module resolution (the same quirk that breaks CartDrawer.test), drop the `MemoryRouter`/link assertion and assert only the heading with a plain `render(<NotFoundPage />)` — but keep the component's `<Link>` in the source.

- [ ] **Step 3: Write the component**

```jsx
// src/storefront/pages/NotFoundPage.jsx
import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-24">
      <Seo
        title="Page not found"
        description="The page you’re looking for doesn’t exist or may have moved."
        noindex
      />
      <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold mb-4">
        404
      </span>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold text-storefront-charcoal mb-4">
        Page not found
      </h1>
      <p className="font-sans text-sm text-storefront-muted mb-8 max-w-md">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/shop"
          className="bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase px-6 py-3 hover:bg-storefront-warm transition-colors duration-150"
        >
          Continue shopping
        </Link>
        <Link
          to="/"
          className="font-sans text-xs tracking-widest uppercase px-6 py-3 border border-storefront-border text-storefront-charcoal hover:border-storefront-charcoal transition-colors duration-150"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route in `src/App.js`**

Add to the imports block (near the other storefront page imports, ~line 11):

```js
import NotFoundPage from "./storefront/pages/NotFoundPage";
```

Change the storefront route group (currently lines ~42-46) to add the catch-all as the **last** child. Add ONLY the `*` route here — the `faq` route comes in Task 7 (its `FaqPage` import doesn't exist yet):

```jsx
          {/* Storefront */}
          <Route path="/" element={<StorefrontLayout />}>
            <Route index element={<HomePage />} />
            <Route path="shop" element={<ShopPage />} />
            <Route path="product/:productid" element={<ProductDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
```

> Order among siblings doesn't affect matching (specificity wins), so Task 7 can insert `faq` before `*` without issue.

- [ ] **Step 5: Run test + build**

Run: `CI=true npx react-scripts test src/storefront/__tests__/NotFoundPage.test.jsx --watchAll=false`
Expected: PASS.
Run: `npm run build`
Expected: compiles without new errors.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/pages/NotFoundPage.jsx src/storefront/__tests__/NotFoundPage.test.jsx src/App.js
git commit -m "Storefront: branded 404 page + catch-all route"
```

---

### Task 3: SEO on Home / Shop / PDP + Product JSON-LD

**Files:**
- Create: `src/storefront/lib/seo.js` (pure `buildProductJsonLd`)
- Modify: `src/storefront/pages/HomePage.jsx`, `src/storefront/pages/ShopPage.jsx`, `src/storefront/pages/ProductDetailPage.jsx`
- Test: `src/storefront/__tests__/seo.test.js`

**Interfaces:**
- Consumes: `Seo` (Task 1); `imageUrl` from `../lib/productImage`.
- Produces: `export function buildProductJsonLd({ product, variants, imagePaths, productid, categoryName })` → a schema.org `Product` object.

- [ ] **Step 1: Write the failing test**

```js
// src/storefront/__tests__/seo.test.js
import { buildProductJsonLd } from "../lib/seo";

const product = { name: "Silk Saree", description: "Handwoven", retailprice: "4500" };
const variants = [{ stock: 0 }, { stock: 2 }];

describe("buildProductJsonLd", () => {
  it("builds a Product with an InStock offer when any variant has stock", () => {
    const ld = buildProductJsonLd({
      product, variants, imagePaths: [], productid: "BC25001", categoryName: "Sarees",
    });
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Silk Saree");
    expect(ld.sku).toBe("BC25001");
    expect(ld.offers.price).toBe(4500);
    expect(ld.offers.priceCurrency).toBe("INR");
    expect(ld.offers.availability).toBe("https://schema.org/InStock");
    expect(ld.offers.seller.name).toBe("BINDAL'S CREATION");
    expect(ld.brand.name).toBe("Bindal's Creations");
  });

  it("marks OutOfStock when every variant is zero", () => {
    const ld = buildProductJsonLd({
      product, variants: [{ stock: 0 }], imagePaths: [], productid: "BC25002", categoryName: null,
    });
    expect(ld.offers.availability).toBe("https://schema.org/OutOfStock");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/seo.test.js --watchAll=false`
Expected: FAIL — cannot find module `../lib/seo`.

- [ ] **Step 3: Write the pure helper**

```js
// src/storefront/lib/seo.js
import { imageUrl } from "./productImage";

// Builds a schema.org Product object for JSON-LD on the product detail page.
export function buildProductJsonLd({ product, variants, imagePaths, productid, categoryName }) {
  const inStock = (variants || []).some((v) => Number(v.stock) > 0);
  const image = imagePaths && imagePaths.length
    ? [imageUrl(imagePaths[0], { width: 1000, quality: 80 })]
    : undefined;
  const description =
    product.description ||
    `${product.name}${categoryName ? ` — ${categoryName}` : ""}`;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image,
    description,
    sku: productid,
    brand: { "@type": "Brand", name: "Bindal's Creations" },
    offers: {
      "@type": "Offer",
      price: Number(product.retailprice),
      priceCurrency: "INR",
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: "BINDAL'S CREATION" },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/seo.test.js --watchAll=false`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `<Seo>` to HomePage**

In `src/storefront/pages/HomePage.jsx`: add `import Seo from "../components/Seo";` and render at the top of the returned fragment/root:

```jsx
<Seo description="Handcrafted sarees, lehengas, and ethnic wear from Bindal's Creations — rooted in tradition, crafted with love." />
```

- [ ] **Step 6: Add `<Seo>` to ShopPage**

In `src/storefront/pages/ShopPage.jsx`: add `import Seo from "../components/Seo";` and render as the first child inside the top-level `<div>` (before the page header):

```jsx
<Seo title="Shop" description="Browse the full collection of handcrafted sarees, lehengas, suits, and ethnic wear." />
```

- [ ] **Step 7: Add `<Seo>` + JSON-LD to ProductDetailPage**

In `src/storefront/pages/ProductDetailPage.jsx`:

Add imports:
```js
import Seo from "../components/Seo";
import { buildProductJsonLd } from "../lib/seo";
```

In the error/not-found branch (currently `if (error || !product) { return (...) }`), add a noindex Seo as the first child of that returned div:
```jsx
<Seo title="Product not found" noindex />
```

In the main return (after `const categoryName = ...` is computed), build the metadata and render `<Seo>` as the first child inside the top-level `<>`:
```jsx
const productLd = buildProductJsonLd({ product, variants, imagePaths, productid, categoryName });
const ogImage = imagePaths.length
  ? imageUrl(imagePaths[0], { width: 1200, quality: 80 })
  : undefined;
```
```jsx
<Seo
  title={product.name}
  description={
    product.description
      ? product.description.replace(/\*\*/g, "").slice(0, 160)
      : `${product.name}${categoryName ? ` — ${categoryName}` : ""} · ₹${Number(product.retailprice).toLocaleString("en-IN")}`
  }
  type="product"
  image={ogImage}
  jsonLd={productLd}
/>
```
(`imageUrl` is already imported in ProductDetailPage.jsx.)

- [ ] **Step 8: Run build to verify all three pages compile**

Run: `npm run build`
Expected: compiles without new errors.

- [ ] **Step 9: Commit**

```bash
git add src/storefront/lib/seo.js src/storefront/__tests__/seo.test.js src/storefront/pages/HomePage.jsx src/storefront/pages/ShopPage.jsx src/storefront/pages/ProductDetailPage.jsx
git commit -m "Storefront SEO: per-page metadata + Product JSON-LD on PDP"
```

---

### Task 4: Shop sort control

**Files:**
- Create: `src/storefront/hooks/sortOptions.js` (pure `sortOrderClause` + `SORT_OPTIONS`)
- Create: `src/storefront/components/shop/SortControl.jsx`
- Modify: `src/storefront/hooks/useShopFilters.js` (add `sortBy` state, thread into `runQuery`, reset offset on change, expose)
- Modify: `src/storefront/pages/ShopPage.jsx` (render `SortControl`)
- Test: `src/storefront/__tests__/sortOptions.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const SORT_OPTIONS = [{ value, label }, ...]`
  - `export function sortOrderClause(sortBy)` → `{ column: string, ascending: boolean }`
  - `useShopFilters()` return gains `sortBy` (string) and `setSortBy` (fn).
  - `SortControl({ value, onChange })`.

- [ ] **Step 1: Write the failing test**

```js
// src/storefront/__tests__/sortOptions.test.js
import { sortOrderClause, SORT_OPTIONS } from "../hooks/sortOptions";

describe("sortOrderClause", () => {
  it("defaults to newest (productid desc)", () => {
    expect(sortOrderClause("newest")).toEqual({ column: "productid", ascending: false });
    expect(sortOrderClause(undefined)).toEqual({ column: "productid", ascending: false });
  });
  it("maps price ascending", () => {
    expect(sortOrderClause("price_asc")).toEqual({ column: "retailprice", ascending: true });
  });
  it("maps price descending", () => {
    expect(sortOrderClause("price_desc")).toEqual({ column: "retailprice", ascending: false });
  });
  it("exposes three options whose values round-trip through sortOrderClause", () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(["newest", "price_asc", "price_desc"]);
    SORT_OPTIONS.forEach((o) => expect(sortOrderClause(o.value)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/sortOptions.test.js --watchAll=false`
Expected: FAIL — cannot find module `../hooks/sortOptions`.

- [ ] **Step 3: Write the pure helper**

```js
// src/storefront/hooks/sortOptions.js
export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

// Maps a sort selection to a Supabase .order() clause.
export function sortOrderClause(sortBy) {
  switch (sortBy) {
    case "price_asc":
      return { column: "retailprice", ascending: true };
    case "price_desc":
      return { column: "retailprice", ascending: false };
    case "newest":
    default:
      return { column: "productid", ascending: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/sortOptions.test.js --watchAll=false`
Expected: PASS (4 tests).

- [ ] **Step 5: Thread `sortBy` through `useShopFilters.js`**

Add the import at the top:
```js
import { sortOrderClause } from "./sortOptions";
```

Add state near the other `useState` calls (after `const [offset, setOffset] = useState(0);`):
```js
const [sortBy, setSortBy] = useState("newest");
```

In `runQuery`, change its signature to accept the sort and replace the hardcoded order. Current:
```js
  const runQuery = useCallback(async (currentFilters, currentOffset, append) => {
```
becomes:
```js
  const runQuery = useCallback(async (currentFilters, currentOffset, append, currentSort) => {
```
Replace this block:
```js
      query = query
        .order("productid", { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);
```
with:
```js
      const { column, ascending } = sortOrderClause(currentSort);
      query = query
        .order(column, { ascending })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);
```

Update the effect that runs the query so it resets to page 0 and refetches when either filters or sort change:
```js
  useEffect(() => {
    setOffset(0);
    runQuery(filters, 0, false, sortBy);
  }, [filters, sortBy, runQuery]);
```

Update `fetchNextPage` to pass the current sort:
```js
  const fetchNextPage = useCallback(() => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    runQuery(filters, next, true, sortBy);
  }, [filters, offset, runQuery, sortBy]);
```

Add `sortBy` and `setSortBy` to the returned object (alongside `fetchNextPage`):
```js
    sortBy,
    setSortBy,
```

- [ ] **Step 6: Write `SortControl.jsx`**

```jsx
// src/storefront/components/shop/SortControl.jsx
import React from "react";
import { SORT_OPTIONS } from "../../hooks/sortOptions";

export default function SortControl({ value, onChange }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-sans tracking-[0.12em] uppercase text-storefront-muted">
        Sort
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Sort products"
        className="bg-transparent border border-storefront-border text-storefront-charcoal font-sans text-xs tracking-wide px-2.5 py-1.5 cursor-pointer hover:border-storefront-charcoal focus:outline-none focus:border-storefront-charcoal transition-colors"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 7: Render `SortControl` in `ShopPage.jsx`**

Add imports:
```js
import SortControl from "../components/shop/SortControl";
```
Pull `sortBy`/`setSortBy` out of the `useShopFilters()` destructure (add them to the existing list).
In the product-grid section, add a header row above `<ProductGrid>`. Replace:
```jsx
      {/* Product grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <ProductGrid
```
with:
```jsx
      {/* Product grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-end mb-6">
          <SortControl value={sortBy} onChange={setSortBy} />
        </div>
        <ProductGrid
```

- [ ] **Step 8: Run tests + build**

Run: `CI=true npx react-scripts test src/storefront/__tests__/sortOptions.test.js src/storefront/__tests__/filterUtils.test.js --watchAll=false`
Expected: PASS.
Run: `npm run build`
Expected: compiles without new errors.

- [ ] **Step 9: Commit**

```bash
git add src/storefront/hooks/sortOptions.js src/storefront/__tests__/sortOptions.test.js src/storefront/components/shop/SortControl.jsx src/storefront/hooks/useShopFilters.js src/storefront/pages/ShopPage.jsx
git commit -m "Storefront Shop: server-side sort control (newest/price)"
```

---

### Task 5: PDP delivery estimate + low-stock reframe

**Files:**
- Create: `src/storefront/lib/deliveryEstimate.js` (`DELIVERY_ESTIMATE` const + pure `stockNote`)
- Modify: `src/storefront/pages/ProductDetailPage.jsx`
- Test: `src/storefront/__tests__/deliveryEstimate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const DELIVERY_ESTIMATE = "Dispatches in 2 days · Delivered in 5–7 days";`
  - `export function stockNote(stock)` → string (`Limited piece — only N in stock`) when 1 ≤ stock ≤ 3, else `null`.

- [ ] **Step 1: Write the failing test**

```js
// src/storefront/__tests__/deliveryEstimate.test.js
import { DELIVERY_ESTIMATE, stockNote } from "../lib/deliveryEstimate";

describe("stockNote", () => {
  it("shows a limited-piece note for low stock (1-3)", () => {
    expect(stockNote(1)).toBe("Limited piece — only 1 in stock");
    expect(stockNote(3)).toBe("Limited piece — only 3 in stock");
  });
  it("shows nothing for ample stock", () => {
    expect(stockNote(4)).toBeNull();
    expect(stockNote(20)).toBeNull();
  });
  it("shows nothing for zero/invalid stock", () => {
    expect(stockNote(0)).toBeNull();
    expect(stockNote(undefined)).toBeNull();
  });
});

describe("DELIVERY_ESTIMATE", () => {
  it("states dispatch and delivery windows", () => {
    expect(DELIVERY_ESTIMATE).toBe("Dispatches in 2 days · Delivered in 5–7 days");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/deliveryEstimate.test.js --watchAll=false`
Expected: FAIL — cannot find module `../lib/deliveryEstimate`.

- [ ] **Step 3: Write the helper**

```js
// src/storefront/lib/deliveryEstimate.js
export const DELIVERY_ESTIMATE = "Dispatches in 2 days · Delivered in 5–7 days";

// Most designs are stocked 1-2 deep, so "Only N left" would fire on nearly
// every product and read as false scarcity. Frame low stock as uniqueness,
// and stay silent once stock is ample.
export function stockNote(stock) {
  const n = Number(stock);
  if (!Number.isFinite(n) || n <= 0 || n > 3) return null;
  return `Limited piece — only ${n} in stock`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/deliveryEstimate.test.js --watchAll=false`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into ProductDetailPage.jsx**

Add import:
```js
import { DELIVERY_ESTIMATE, stockNote } from "../lib/deliveryEstimate";
```

Replace the current `stockLabel` block (lines ~189-194):
```js
  const stockLabel =
    selectedVariant && selectedVariant.stock <= 3
      ? `Only ${selectedVariant.stock} left`
      : selectedVariant
      ? "In stock"
      : null;
```
with:
```js
  const stockLabel = selectedVariant ? stockNote(selectedVariant.stock) : null;
```

Add the delivery line in the details column. After the fabric paragraph block (the `{product.fabric && (...)}` block, ~line 263-267) insert:
```jsx
            <p className="text-xs text-storefront-muted font-sans tracking-wide mb-3">
              {DELIVERY_ESTIMATE}
            </p>
```

(The desktop `stockLabel` render at ~line 326-330 stays as-is; it now shows the reframed copy or nothing. Because `stockNote` returns `null` for stock ≥ 4, the old "In stock" line disappears — intended.)

- [ ] **Step 6: Run tests + build**

Run: `CI=true npx react-scripts test src/storefront/__tests__/deliveryEstimate.test.js --watchAll=false`
Expected: PASS.
Run: `npm run build`
Expected: compiles without new errors.

- [ ] **Step 7: Commit**

```bash
git add src/storefront/lib/deliveryEstimate.js src/storefront/__tests__/deliveryEstimate.test.js src/storefront/pages/ProductDetailPage.jsx
git commit -m "Storefront PDP: delivery estimate + honest low-stock framing"
```

---

### Task 6: Footer/contact truth fix + TrustBar claim fix

**Files:**
- Modify: `src/storefront/components/StorefrontFooter.jsx`
- Modify: `src/storefront/components/home/TrustBar.jsx`
- Test: `src/storefront/__tests__/TrustBar.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: no new exports; corrected static content.

- [ ] **Step 1: Write the failing test (TrustBar)**

```jsx
// src/storefront/__tests__/TrustBar.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import TrustBar from "../components/home/TrustBar";

describe("TrustBar", () => {
  it("advertises 7-day in-store exchange, not returns", () => {
    render(<TrustBar />);
    expect(screen.getByText(/7-Day Exchange/i)).toBeInTheDocument();
    expect(screen.getByText(/In-store exchange within 7 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/returns/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/TrustBar.test.jsx --watchAll=false`
Expected: FAIL — current text is "Easy Returns" / "Hassle-free 7-day returns".

- [ ] **Step 3: Fix the TrustBar signal**

In `src/storefront/components/home/TrustBar.jsx`, replace line 7:
```js
  { icon: RefreshCw, title: "Easy Returns", desc: "Hassle-free 7-day returns" },
```
with:
```js
  { icon: RefreshCw, title: "7-Day Exchange", desc: "In-store exchange within 7 days" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/TrustBar.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Fix the footer contact + social + WhatsApp FAB, add legitimacy block**

In `src/storefront/components/StorefrontFooter.jsx`:

(a) Instagram + Facebook social links (currently `https://instagram.com` and `https://facebook.com`). Set real URLs:
```jsx
                href="https://instagram.com/bindals_creation_shop"
```
```jsx
                href="https://www.facebook.com/profile.php?id=61579168104897"
```

(b) Contact section — replace placeholder phone, email, and WhatsApp:
- phone span: `+91 98765 43210` → `+91 98108 73280`
- email span: `hello@bindalscreations.com` → `bindalscreations@gmail.com`
- WhatsApp anchor href: `https://wa.me/919876543210` → `https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question%20about%20a%20product`

(c) Add a business-legitimacy row. Immediately BEFORE the existing `{/* Bottom bar */}` block (the `<div className="border-t border-white/10">` at ~line 115), insert:
```jsx
        {/* Business legitimacy */}
        <div className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-[11px] text-storefront-cream/40 leading-relaxed">
            BINDAL'S CREATION · 58 Sihani Gate Market, Ghaziabad 201001 · GSTIN 09ABVPB4203A1Z4
          </div>
        </div>
```

(d) WhatsApp FAB anchor href (~line 130): `https://wa.me/919876543210` → `https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question%20about%20a%20product`

- [ ] **Step 6: Verify no placeholder strings remain**

Run:
```bash
grep -nE '919876543210|98765 43210|hello@bindalscreations|instagram\.com"|facebook\.com"' src/storefront/components/StorefrontFooter.jsx
```
Expected: no output (all placeholders replaced).

Run:
```bash
grep -nE '919810873280|bindalscreations@gmail\.com|09ABVPB4203A1Z4|Sihani Gate' src/storefront/components/StorefrontFooter.jsx
```
Expected: matches present.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: compiles without new errors.

- [ ] **Step 8: Commit**

```bash
git add src/storefront/components/StorefrontFooter.jsx src/storefront/components/home/TrustBar.jsx src/storefront/__tests__/TrustBar.test.jsx
git commit -m "Storefront: real contact info, GSTIN legitimacy block, 7-day exchange claim"
```

---

### Task 7: FAQ page + route + footer link

**Files:**
- Create: `src/storefront/pages/faqContent.js` (question/answer array)
- Create: `src/storefront/pages/FaqPage.jsx` (accordion via native `<details>`)
- Modify: `src/App.js` (add `faq` route — see Task 2 Step 4; add import)
- Modify: `src/storefront/components/StorefrontFooter.jsx` (Help list → add FAQ link)
- Test: `src/storefront/__tests__/FaqPage.test.jsx`

**Interfaces:**
- Consumes: `Seo` (Task 1).
- Produces: `export const FAQ_ITEMS = [{ q, a }, ...]`; `export default function FaqPage()`; route `<Route path="faq" element={<FaqPage />} />`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/FaqPage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import FaqPage from "../pages/FaqPage";

describe("FaqPage", () => {
  it("renders the exchange policy and delivery answers", () => {
    render(<FaqPage />);
    expect(screen.getByText(/exchanges are accepted within 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/dispatch within 2 working days/i)).toBeInTheDocument();
    // No COD claim anywhere on the page.
    expect(screen.queryByText(/cash on delivery|COD/i)).toBeNull();
  });
});
```

> FaqPage renders no `<Link>` (it uses `Seo` + `<details>` only), so no router wrapper is needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/FaqPage.test.jsx --watchAll=false`
Expected: FAIL — cannot find module `../pages/FaqPage`.

- [ ] **Step 3: Write the FAQ content**

```js
// src/storefront/pages/faqContent.js
// All answers are real (owner-confirmed 2026-07-09). A few are "draft" wording
// the owner may polish; none assert anything speculative. No COD is offered, so
// COD is not mentioned at all.
export const FAQ_ITEMS = [
  {
    q: "How long does delivery take, and do you ship across India?",
    a: "We dispatch within 2 working days. Delivery anywhere in India typically takes 5–7 days after dispatch.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept UPI, credit and debit cards, and net banking through a secure payment gateway.",
  },
  {
    q: "What is your return and exchange policy?",
    a: "We don't offer returns. Exchanges are accepted within 7 days of purchase, in-store only, provided the garment is unworn and in original condition with tags intact.",
  },
  {
    q: "Why is only one piece available? Can I reorder a sold-out design?",
    a: "Most of our designs are made in very limited numbers, so many are effectively one-of-a-kind. If a design is sold out, message us on WhatsApp and we'll tell you whether a repeat is possible.",
  },
  {
    q: "Do sarees come with a blouse? Is it stitched? Can you alter garments?",
    a: "Where a blouse piece is included it's noted in the product details, and it's supplied unstitched unless stated otherwise. For stitching or alterations, please ask us on WhatsApp.",
  },
  {
    q: "How do I choose the right size?",
    a: "Each product lists its available sizes. If you're unsure, message us on WhatsApp with your measurements and we'll help you pick the right fit.",
  },
  {
    q: "How do I care for silk and embroidered pieces?",
    a: "Silk and embroidered garments are best dry-cleaned. Store them folded in a cool, dry place and keep perfume and deodorant off the fabric. Follow any specific care note on the product.",
  },
  {
    q: "How do I track my order?",
    a: "Once your order ships we'll share tracking details. In the meantime, message us on WhatsApp with your order details for an update.",
  },
  {
    q: "Can I visit your store and buy in person?",
    a: "Yes — visit us at 58 Sihani Gate Market, Ghaziabad 201001. You're welcome to browse and buy in person.",
  },
  {
    q: "Are the colours true to the photos?",
    a: "We photograph products as accurately as we can, but screens vary. If the exact shade matters, ask us on WhatsApp for a quick photo or video before you buy.",
  },
  {
    q: "What's the fastest way to reach you?",
    a: "WhatsApp us at +91 98108 73280 — we're happy to answer any question before you buy.",
  },
];
```

- [ ] **Step 4: Write the FAQ page**

```jsx
// src/storefront/pages/FaqPage.jsx
import React from "react";
import Seo from "../components/Seo";
import { FAQ_ITEMS } from "./faqContent";

function FaqItem({ q, a }) {
  return (
    <details className="group border-b border-storefront-border py-5">
      <summary className="flex items-start justify-between gap-4 cursor-pointer list-none font-display text-lg text-storefront-charcoal">
        <span>{q}</span>
        <span className="text-storefront-gold text-xl leading-none flex-shrink-0 transition-transform duration-200 group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-3 text-sm text-storefront-muted font-sans leading-relaxed">
        {a}
      </p>
    </details>
  );
}

export default function FaqPage() {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo
        title="FAQ"
        description="Answers to common questions about delivery, exchanges, payments, sizing, and visiting Bindal's Creations."
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Help
          </span>
        </div>
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-none mb-10">
          Frequently Asked Questions
        </h1>
        <div>
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/FaqPage.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 6: Wire the route in `src/App.js`**

Add import near other storefront imports:
```js
import FaqPage from "./storefront/pages/FaqPage";
```
Ensure the storefront route group contains (add the `faq` line if not already present from Task 2):
```jsx
            <Route path="faq" element={<FaqPage />} />
```

- [ ] **Step 7: Add the footer FAQ link**

In `src/storefront/components/StorefrontFooter.jsx`, the Help list currently maps a single `{ label: "Shop All", to: "/shop" }`. Add FAQ:
```jsx
              {[
                { label: "Shop All", to: "/shop" },
                { label: "FAQ", to: "/faq" },
              ].map(({ label, to }) => (
```

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: compiles without new errors.

- [ ] **Step 9: Commit**

```bash
git add src/storefront/pages/faqContent.js src/storefront/pages/FaqPage.jsx src/storefront/__tests__/FaqPage.test.jsx src/App.js src/storefront/components/StorefrontFooter.jsx
git commit -m "Storefront: FAQ page + route + footer link"
```

---

### Task 8: Sitemap generator + robots.txt

**Files:**
- Create: `scripts/generate-sitemap.js`
- Create: `public/robots.txt`
- Generated (committed): `public/sitemap.xml`

**Interfaces:**
- Consumes: `.env` (`REACT_APP_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- Produces: `public/sitemap.xml` on run.

> **Site domain:** the canonical storefront domain is not yet confirmed. The script and robots.txt use `SITE_URL` (env override, default `https://bindalscreations.com`). Before the sitemap/robots are truthful, set the real domain (edit the default or pass `SITE_URL=...`). This is an owner input, not a code blocker.

- [ ] **Step 1: Write the sitemap script**

```js
// scripts/generate-sitemap.js
/**
 * Generates public/sitemap.xml from the products table + static routes.
 * Run on demand (NOT wired into `npm run build`):
 *   node scripts/generate-sitemap.js
 * Reads REACT_APP_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
 * Set SITE_URL to the real storefront domain before publishing.
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const SITE_URL = (env.SITE_URL || "https://bindalscreations.com").replace(/\/$/, "");
  const supaUrl = env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const res = await fetch(`${supaUrl}/rest/v1/products?select=productid`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error("Failed to fetch products:", res.status, await res.text());
    process.exit(1);
  }
  const products = await res.json();

  const staticPaths = ["/", "/shop", "/faq"];
  const urls = [
    ...staticPaths.map((p) => `${SITE_URL}${p}`),
    ...products.map((p) => `${SITE_URL}/product/${p.productid}`),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  const outPath = path.join(__dirname, "..", "public", "sitemap.xml");
  fs.writeFileSync(outPath, xml);
  console.log(`Wrote ${urls.length} URLs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Write robots.txt**

```
// public/robots.txt
User-agent: *
Allow: /

Sitemap: https://bindalscreations.com/sitemap.xml
```
(Remove the leading `//` comment line — it's just a file marker here. The file's first real line is `User-agent: *`. Update the domain when confirmed.)

- [ ] **Step 3: Run the generator**

Run: `node scripts/generate-sitemap.js`
Expected: `Wrote N URLs to .../public/sitemap.xml` (N = 3 static + product count, in the thousands). Verify the file exists and starts with `<?xml`.

- [ ] **Step 4: Sanity-check the output**

Run: `head -5 public/sitemap.xml && grep -c "<url>" public/sitemap.xml`
Expected: XML header + urlset; url count = 3 + number of products.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-sitemap.js public/robots.txt public/sitemap.xml
git commit -m "Storefront SEO: sitemap generator + robots.txt"
```

---

## Final verification (after all tasks)

- [ ] Run the full storefront test suite (excluding the known-broken CartDrawer test):

```bash
CI=true npx react-scripts test src/storefront/__tests__ --watchAll=false 2>&1 | tail -30
```
Expected: all pass except the pre-existing `CartDrawer.test.jsx` react-router-dom resolution failure (do not fix here).

- [ ] `npm run build` clean (no new warnings).
- [ ] Manual smoke (per spec §4): bad URL → 404; Shop sort reorders + infinite scroll intact + count correct; PDP shows delivery line + "Limited piece — only N in stock" for a 1–2 stock variant + `Product` JSON-LD in page source; footer shows real phone/email/Instagram/Facebook + GSTIN block + WhatsApp FAB → 919810873280; `/faq` accordion opens; sitemap.xml has product URLs.

## Spec coverage map

| Spec unit | Task(s) |
|---|---|
| U1 SEO (Seo component, per-page meta, JSON-LD, sitemap, robots) | 1, 3, 8 |
| U2 404 page + route | 2 |
| U3 Shop sort | 4 |
| U4 PDP delivery + low-stock reframe | 5 |
| U5 Footer/contact truth + TrustBar claim + legitimacy block | 6 |
| U6 FAQ page | 7 |

## Notes / deferred (not blockers)

- **Site domain** for sitemap/robots is a placeholder until confirmed (Task 8 note).
- FAQ answers 4, 5, 8, 10 are "draft" wording — owner may polish; all are factually true as written.
- Other TrustBar claims (free shipping above ₹5,000, secure checkout) become true in Phase 2 — left to the Home-restructure slice, not touched here.
