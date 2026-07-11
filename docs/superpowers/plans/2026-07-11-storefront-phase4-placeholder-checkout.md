# Storefront Phase 4 + Placeholder Checkout/Shipping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the no-payment growth + journey-completion features: wishlist, full search results page, config-driven collections, GA4 analytics (env-gated), a UI-only placeholder checkout, and a `/track` order-lookup shell — all with **no Razorpay/Shiprocket wiring and no order persistence**.

**Architecture:** Pure client React (CRA) over Supabase anon key. Wishlist mirrors the existing `CartContext` localStorage pattern. Collections are a static config mapping slugs → category filters / product-id lists (no new DB). Checkout is a validated form that terminates in the existing WhatsApp-order fallback — nothing is written to the DB. Analytics is a thin env-gated GA4 wrapper.

**Tech Stack:** React 19, react-router-dom, @supabase/supabase-js, React Hook Form + Zod (already deps), Tailwind (storefront tokens), Jest + RTL, sonner, lucide-react.

## Global Constraints

- No payment, no shipping API, **no order DB writes** anywhere in this plan. Checkout's terminal action is the disabled "online checkout launching soon" state + the WhatsApp-order link (same pattern as `CartPage.jsx`). COD is **not** offered.
- Storefront anon key only; no secrets client-side. GA4 loads only when `process.env.REACT_APP_GA4_ID` is set AND `process.env.NODE_ENV === 'production'`.
- Shipping math (display only): flat **₹99** below ₹5,000, **free at/above ₹5,000**, India-only. (Owner-confirmed; single flat tier — no per-weight.)
- Store facts: address "58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, Uttar Pradesh 201001"; phone/WhatsApp `919810873280`; hours 10 AM–8:30 PM, closed Tuesdays.
- Canonical cart item shape: `{ variant_id, product_id, quantity, name, size, color, price, image_url }`.
- Indian address schema: name (required), 10-digit phone, email (optional but valid if present), line1 (required), line2, city (required), state (required, select), 6-digit pincode.
- Test command: `CI=true npx react-scripts test --watchAll=false <path>`.
- Follow existing storefront patterns/tokens (see `CartPage.jsx`, `ProductCard.jsx`, `SearchOverlay.jsx`, `StaticPage.jsx`, `CartContext.jsx`).

---

### Task 1: Wishlist (context + heart + page + header icon)

**Files:**
- Create: `src/storefront/context/WishlistContext.jsx`, `src/storefront/pages/WishlistPage.jsx`
- Modify: `src/storefront/components/StorefrontLayout.jsx` (mount provider), `src/storefront/components/ProductCard.jsx` (heart toggle), `src/storefront/components/StorefrontHeader.jsx` (heart icon → `/wishlist`), `src/App.js` (route)
- Test: `src/storefront/__tests__/WishlistContext.test.jsx`, `src/storefront/__tests__/WishlistPage.test.jsx`

**Interfaces (Produces):**
- `WishlistProvider`, `useWishlist()` → `{ items, has(productid), toggle(product), remove(productid), count }`. `items` = array of `{ productid, name, retailprice }` (minimal — page re-fetches image via existing `getProductImageUrl`). Persisted to localStorage key `bc_wishlist`.

- [ ] **Step 1: Failing test — context toggle + persistence**

```jsx
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { WishlistProvider, useWishlist } from "../context/WishlistContext";

function Probe() {
  const { toggle, has, count } = useWishlist();
  return (
    <>
      <span data-testid="count">{count}</span>
      <span data-testid="has">{has("BC1") ? "yes" : "no"}</span>
      <button onClick={() => toggle({ productid: "BC1", name: "Saree", retailprice: 1000 })}>t</button>
    </>
  );
}
beforeEach(() => localStorage.clear());
it("toggles items and persists to localStorage", () => {
  render(<WishlistProvider><Probe /></WishlistProvider>);
  act(() => screen.getByText("t").click());
  expect(screen.getByTestId("count").textContent).toBe("1");
  expect(screen.getByTestId("has").textContent).toBe("yes");
  expect(JSON.parse(localStorage.getItem("bc_wishlist"))).toHaveLength(1);
  act(() => screen.getByText("t").click());
  expect(screen.getByTestId("count").textContent).toBe("0");
});
```

- [ ] **Step 2: Run → fails (module not found).**

- [ ] **Step 3: Implement `WishlistContext.jsx`** — mirror `CartContext`'s localStorage-init + effect pattern (read `src/storefront/context/CartContext.jsx` lines around STORAGE_KEY). Keys by `productid`. `toggle` adds `{productid,name,retailprice}` if absent else removes. No auth/server sync (localStorage only, unlike cart).

- [ ] **Step 4: Mount provider** in `StorefrontLayout.jsx` inside `CartProvider` (any order relative to cart is fine; keep under StorefrontAuthProvider).

- [ ] **Step 5: `ProductCard.jsx` heart** — the card already imports `Heart` from lucide (grep to confirm; if not, add). Add a top-right heart button (absolute) that calls `useWishlist().toggle(product)` and fills when `has(product.productid)`. `e.preventDefault()`+`stopPropagation` so it doesn't trigger the card's Link navigation.

- [ ] **Step 6: `WishlistPage.jsx`** — `/wishlist` route. Grid reusing `ProductCard` for each wishlist item (map `{productid,name,retailprice}` into the shape ProductCard expects — check ProductCard's `product` prop usage; pass `{productid, name, retailprice}` and let it resolve image). Empty state ("No saved items yet" + link to `/shop`). `Seo title="Wishlist" noindex`.

- [ ] **Step 7: Header icon** — add a `Heart` icon in `StorefrontHeader.jsx` actions (between search and account) linking to `/wishlist`, with a count badge like the cart badge when `count>0`.

- [ ] **Step 8: Route** in `src/App.js` — `<Route path="wishlist" element={<WishlistPage />} />` before catch-all; import.

- [ ] **Step 9: WishlistPage render test** (mock `useWishlist` to return one item; assert it renders + empty-state when none).

- [ ] **Step 10: Full storefront suite green + commit** `feat(storefront): wishlist (localStorage) + heart + page`.

---

### Task 2: Search results page (`/search?q=`)

**Files:**
- Create: `src/storefront/pages/SearchResultsPage.jsx`
- Modify: `src/App.js` (route), `src/storefront/components/SearchOverlay.jsx` (add "See all results" link → `/search?q=<query>` when results exist)
- Test: `src/storefront/__tests__/SearchResultsPage.test.jsx`

**Interfaces (Consumes):** existing `useProductSearch(query)` from `../hooks/useProductSearch` (returns `{results, loading}`), `ProductCard`.

- [ ] **Step 1: Failing test** — render `SearchResultsPage` inside `MemoryRouter` with `initialEntries={["/search?q=saree"]}`, mock `useProductSearch` → 2 results; assert heading shows the query + result count + cards render; assert empty-query state and no-results state.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — read `q` via `useSearchParams()`. Call `useProductSearch(q)`. Render: heading `Results for "q"`, result count, a `ProductCard` grid (same grid classes as `ProductGrid`/Shop), loading skeletons (reuse the skeleton pattern from `ProductGrid.jsx`), empty state ("No products match…"), and a short-query prompt. `Seo title={`Search: ${q}`} noindex`.

- [ ] **Step 4: SearchOverlay "See all"** — in `SearchOverlay.jsx`, when `results.length` > 0, render a footer row link `See all results for "query"` → `navigate('/search?q='+encodeURIComponent(clean))` + `onClose()`.

- [ ] **Step 5: Route** `<Route path="search" element={<SearchResultsPage />} />` before catch-all; import.

- [ ] **Step 6: Suite green + commit** `feat(storefront): full search results page`.

---

### Task 3: Collections (config + pages + nav)

**Files:**
- Create: `src/storefront/lib/collections.js` (config + lookup), `src/storefront/pages/CollectionsIndexPage.jsx`, `src/storefront/pages/CollectionPage.jsx`
- Modify: `src/App.js` (routes), `src/storefront/components/StorefrontFooter.jsx` (a "Collections" link under SHOP)
- Test: `src/storefront/__tests__/collections.test.js`, `src/storefront/__tests__/CollectionPage.test.jsx`

**Interfaces (Produces):**
- `collections.js`: `export const COLLECTIONS = [{ slug, title, subtitle, categoryIds?: string[], productIds?: string[] }]` and `getCollection(slug)`. A collection resolves products by `productIds` if present, else by `categoryIds` (query `products` where `categoryid in (...)`).

- [ ] **Step 1: Seed config** — `collections.js` with 3 **placeholder** collections the owner will curate later (clearly commented):

```js
// PLACEHOLDER collections — owner to curate slugs/titles/membership.
// A collection resolves by explicit productIds when given, else by categoryIds.
// Category ids come from the `categories` table (see /shop filters).
export const COLLECTIONS = [
  { slug: "wedding", title: "Wedding", subtitle: "Lehengas & statement sarees", categoryIds: [] },
  { slug: "festive", title: "Festive", subtitle: "Bright, celebratory pieces", categoryIds: [] },
  { slug: "everyday", title: "Everyday", subtitle: "Easy, elegant daily wear", categoryIds: [] },
];
export function getCollection(slug) {
  return COLLECTIONS.find((c) => c.slug === slug) || null;
}
```
> Leave `categoryIds` empty arrays for now (owner supplies real category ids or product ids). A collection with no membership renders an honest "Curated pieces coming soon — browse the full shop" empty state rather than an error.

- [ ] **Step 2: Failing test (`collections.test.js`)** — `getCollection('wedding')` returns the object; `getCollection('nope')` returns null; every collection has slug+title.

- [ ] **Step 3: Implement `collections.js`** per Step 1.

- [ ] **Step 4: `CollectionPage.jsx`** — `/collections/:slug`. `getCollection(slug)`; 404-style "not found" (link to `/collections`) if null. Fetch products: if `productIds.length` → `products.select(...).in('productid', productIds)`; elif `categoryIds.length` → `.in('categoryid', categoryIds)`; else empty. Render hero (title+subtitle) + `ProductCard` grid + the "coming soon / browse shop" empty state when no members. `Seo title={collection.title}`.

- [ ] **Step 5: `CollectionsIndexPage.jsx`** — `/collections`. Grid of collection cards (title+subtitle) linking to each `/collections/:slug`. `Seo title="Collections"`.

- [ ] **Step 6: Routes + footer link** — `<Route path="collections" .../>` and `<Route path="collections/:slug" .../>` before catch-all; add "Collections" link to footer SHOP column (`StorefrontFooter.jsx`).

- [ ] **Step 7: `CollectionPage.test.jsx`** — mock supabase; assert title renders + empty-state path when membership empty.

- [ ] **Step 8: Suite green + commit** `feat(storefront): config-driven collections pages`.

---

### Task 4: GA4 analytics (env-gated)

**Files:**
- Create: `src/storefront/lib/analytics.js`
- Modify: `src/storefront/components/StorefrontLayout.jsx` (page-view on route change), `src/storefront/context/CartContext.jsx` (add-to-cart event), `src/storefront/pages/CartPage.jsx` (begin-checkout event on WhatsApp click), `.env.example` (document `REACT_APP_GA4_ID`)
- Test: `src/storefront/__tests__/analytics.test.js`

**Interfaces (Produces):**
- `analytics.js`: `initAnalytics()` (idempotent; injects gtag script only if `REACT_APP_GA4_ID` set and NODE_ENV==='production'), `trackPageView(path)`, `trackEvent(name, params)`. All are **no-ops when the GA4 id is absent or not production** (so dev/tests never hit GA).

- [ ] **Step 1: Failing test** — with no `REACT_APP_GA4_ID`, `trackEvent`/`trackPageView` do nothing and don't throw; `initAnalytics()` injects no script. (Assert `window.gtag` stays undefined and `document` has no gtag script.) Verifies the safe-by-default gate.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement `analytics.js`** — guard `const ID = process.env.REACT_APP_GA4_ID; const ON = !!ID && process.env.NODE_ENV === 'production';`. `initAnalytics` (inject `https://www.googletagmanager.com/gtag/js?id=ID` + dataLayer/gtag bootstrap) only when `ON`. `trackPageView`/`trackEvent` call `window.gtag` only when `ON && window.gtag`. Never throw.

- [ ] **Step 4: Wire** — call `initAnalytics()` once in `StorefrontLayout` mount; `trackPageView(location.pathname)` on route change (effect on `useLocation`); `trackEvent('add_to_cart', {...})` in `CartContext.addItem`; `trackEvent('begin_checkout', {...})` on the CartPage WhatsApp link click. Keep params minimal (no PII).

- [ ] **Step 5: `.env.example`** — add `REACT_APP_GA4_ID=` with a comment (owner pastes their `G-XXXX`).

- [ ] **Step 6: Suite green + commit** `feat(storefront): GA4 analytics (env-gated, no-op without id)`.

---

### Task 5: Placeholder checkout (`/checkout`, UI-only)

**Files:**
- Create: `src/storefront/pages/CheckoutPage.jsx`, `src/storefront/lib/checkout.js` (Zod schema + shipping calc — pure)
- Modify: `src/App.js` (route), `src/storefront/pages/CartPage.jsx` (primary CTA → `/checkout`), `src/storefront/components/cart/CartDrawer.jsx` ("View cart" stays → `/cart`; no change needed)
- Test: `src/storefront/__tests__/checkout.test.js` (pure), `src/storefront/__tests__/CheckoutPage.test.jsx`

**Interfaces (Produces):**
- `checkout.js`: `addressSchema` (Zod), `shippingFee(subtotal)` → `0` if subtotal>=5000 else `99`, `INDIAN_STATES` (array).

- [ ] **Step 1: Failing pure test (`checkout.test.js`)** — `shippingFee(4999)===99`, `shippingFee(5000)===0`, `shippingFee(6000)===0`; `addressSchema` rejects a 9-digit phone and a 5-digit pincode, accepts a valid Indian address.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement `checkout.js`** — Zod: `name` min 2, `phone` `/^[6-9]\d{9}$/`, `email` optional `.email()`, `line1` min 3, `line2` optional, `city` min 2, `state` enum(INDIAN_STATES), `pincode` `/^\d{6}$/`. `shippingFee` as above. `INDIAN_STATES` full list.

- [ ] **Step 4: `CheckoutPage.jsx`** — read cart via `useCart()`. If cart empty → redirect `/cart`. React Hook Form + `zodResolver(addressSchema)`. Sections on one page: Contact (name, phone, email), Shipping address (line1, line2, city, state select, pincode), Order summary (line items readout, subtotal, shipping via `shippingFee`, total). Terminal block: a **disabled** "Place order — online payment launching soon" button + a "Complete your order on WhatsApp" link (build `wa.me/919810873280?text=` with `encodeURIComponent` of order + the entered address). **No DB write, no order created.** `Seo title="Checkout" noindex`. On invalid form, the WhatsApp button is disabled until the form validates (so the address is captured in the message).

- [ ] **Step 5: Route + CartPage CTA** — `<Route path="checkout" .../>` before catch-all. In `CartPage.jsx`, change the disabled "checkout launching soon" button into a `<Link to="/checkout">Checkout</Link>` (enabled) — the placeholder checkout page is now the next step; keep the WhatsApp button on the cart too. Update the CartPage test's assertion accordingly (the disabled-button assertion becomes a link to `/checkout`).

- [ ] **Step 6: `CheckoutPage.test.jsx`** — mock `useCart` with one item; assert the form fields render, subtotal+shipping shown, and the WhatsApp link appears after filling valid values (or that the submit/WhatsApp control is present). Keep it focused.

- [ ] **Step 7: Suite green + commit** `feat(storefront): placeholder checkout page (UI-only, no payment)`.

---

### Task 6: `/track` order-lookup shell

**Files:**
- Create: `src/storefront/pages/TrackOrderPage.jsx`
- Modify: `src/App.js` (route), `src/storefront/components/StorefrontFooter.jsx` (a "Track order" link under HELP)
- Test: `src/storefront/__tests__/TrackOrderPage.test.jsx`

- [ ] **Step 1: Failing test** — renders heading + order-ref & phone inputs + a submit; on submit shows the honest placeholder message; asserts NO supabase import/call (there are no orders yet).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — `/track`. Two inputs (order reference, phone) + "Check status" button. On submit (no network) show: "Online order tracking will be available once online orders go live. For any order placed in-store or on WhatsApp, message us at +91 98108 73280 and we'll share the status." `Seo title="Track order" noindex`. Honest placeholder — no DB.

- [ ] **Step 4: Route + footer link** — `<Route path="track" .../>` before catch-all; "Track order" under footer HELP.

- [ ] **Step 5: Suite green + commit** `feat(storefront): /track order-lookup placeholder`.

---

### Task 7: End-to-end verification

- [ ] Build: `CI=true npm run build` → Compiled successfully.
- [ ] Browser drive (Playwright CLI, dev server): wishlist add→/wishlist shows it; `/search?q=saree` lists results; `/collections` + a `/collections/:slug` render (empty-state ok); `/checkout` with a seeded cart validates + shows WhatsApp link; `/track` submit shows placeholder. Screenshot `/checkout`.
- [ ] Refresh graph: `/opt/homebrew/opt/python@3.10/bin/python3.10 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`.

---

## Owner follow-ups (surfaced, not build-blocking)
- Collections membership: supply real collection names + product IDs (or category ids) for `collections.js`.
- GA4: create the property, paste `G-XXXX` into `REACT_APP_GA4_ID` (Vercel env). GA4 in India warrants a consent/cookie notice — a small follow-up we can add once GA is live.
- FAQ answers + real photos still outstanding from the earlier owner review.
