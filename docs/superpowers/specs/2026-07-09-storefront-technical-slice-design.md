# Storefront Phase 1 — Technical Slice (Design Spec)

**Date:** 2026-07-09
**Parent plan:** `docs/STOREFRONT-OVERHAUL-PLAN.md` §6 Phase 1
**Scope:** Content-independent technical + trust work in `src/storefront/*`. Buildable start-to-finish without owner content gathering (all needed real values captured below).
**Out of scope:** About/Contact/policy pages, Home restructure, size-guide page, attribute normalization (all done), checkout (Phase 2), Shiprocket/pincode (Phase 3).

---

## 0. Context — what already exists (verified live 2026-07-09)

Prior work did more than the parent plan tracked. Confirmed already shipped, **do not rebuild**:

| Feature | Location |
|---|---|
| Shop result count ("N items") | `FilterBar.jsx:145` |
| Shop loading skeletons + empty state + end-of-results | `ProductGrid.jsx` |
| PDP low-stock label + fabric display | `ProductDetailPage.jsx:189,263` |
| Newsletter section | already removed (no refs) |
| Image/CLS (BlurFillImage, locked 3:4 aspect) | `BlurFillImage.jsx`, grids |
| Attribute family filters (color/fabric) | `useShopFilters.js` |
| WhatsApp FAB (component) | `StorefrontFooter.jsx:128-137` — **wrong number** |

---

## 1. Units of work

Six independent units. Each has one purpose, its own files, and can be built/verified alone.

### U1 — SEO surface
**What:** Per-page document metadata + structured data + sitemap for a CRA SPA.
**Caveat:** Client-rendered meta (Googlebot executes JS; other crawlers may not). True SSR/prerender stays deferred to the Vite-migration decision — this is the interim, honest improvement, not the final fix.

- **No dependency.** React 19.1 has native document metadata: rendering `<title>`, `<meta>`, `<link>` anywhere in the tree hoists + dedupes them into `<head>`, and updates correctly on SPA route changes. Use it directly — no `react-helmet-async`.
- Thin reusable `src/storefront/components/Seo.jsx` that renders the native tags given `title`/`description`/`image`/`type`/`url`/`jsonLd` props (keeps per-page call sites DRY). JSON-LD is a `<script type="application/ld+json">` rendered in place (valid anywhere for crawlers).
- Per-page `<Seo>` producing `<title>`, `<meta name="description">`, Open Graph (`og:title`, `og:description`, `og:type`, `og:image`, `og:url`), `twitter:card`:
  - Home — brand title + tagline; `og:type=website`.
  - Shop — "Shop — Bindal's Creations" + collection description.
  - PDP — product name + category + price in title/description; `og:type=product`; `og:image` = first product image URL (via `getProductImagePaths` + `imageUrl`); falls back to a static brand OG image when the product has no image.
  - 404 — noindex title.
- `Product` JSON-LD (`<script type="application/ld+json">`) on PDP: `name`, `image`, `description`, `sku`=productid, `brand`, `offers` (`price`=retailprice, `priceCurrency`=INR, `availability` from live stock: InStock if any variant stock>0 else OutOfStock), `seller.name`="BINDAL'S CREATION".
- Sitemap: `scripts/generate-sitemap.js` — a standalone Node script that queries Supabase (service role from `.env`) for all `productid`s + static routes (`/`, `/shop`, `/faq`), writes `public/sitemap.xml`. Run on demand (documented in the script header), **not** wired into `npm run build` (keeps CRA build untouched). Also add `public/robots.txt` referencing the sitemap if absent.

**Edge cases:** product with no image → OG image falls back to brand default; missing description → title-only description; JSON-LD price is the single `retailprice` (no per-variant pricing in schema).

**Files:** new `src/storefront/components/Seo.jsx`, `HomePage.jsx`, `ShopPage.jsx`, `ProductDetailPage.jsx`, `NotFoundPage.jsx`, new `scripts/generate-sitemap.js`, `public/robots.txt`, `public/sitemap.xml` (generated). No `package.json` change.

### U2 — 404 page
**What:** Branded not-found within storefront chrome.
- New `src/storefront/pages/NotFoundPage.jsx` — display-type headline, short copy, primary link → `/shop`, secondary → `/`. Uses storefront tokens (cream/charcoal/gold, Fraunces + Inter). `min-h-[60vh]` so footer sits naturally.
- Route: add `<Route path="*" element={<NotFoundPage />} />` as the **last child** of the `/` `StorefrontLayout` route in `src/App.js:42-46`. Catches any unmatched storefront path; gets header/footer/WhatsApp automatically. Admin `/admin/*` is a separate top-level route, unaffected.
- Helmet: `<title>Page not found — Bindal's Creations</title>` + `<meta name="robots" content="noindex">`.

**Files:** new `NotFoundPage.jsx`, `src/App.js`.

### U3 — Shop sort control
**What:** User-selectable ordering of the product grid, server-side (respects existing pagination).
- Add `sortBy` state to `useShopFilters` (default `"newest"`). Options → order clauses in `runQuery`:
  - `newest` → `.order("productid", { ascending: false })` (current behavior; keep as default).
  - `price_asc` → `.order("retailprice", { ascending: true })`.
  - `price_desc` → `.order("retailprice", { ascending: false })`.
- Thread `sortBy` into the `runQuery` dependency + the effect that resets offset (changing sort resets to page 0, refetches). Expose `sortBy` + `setSortBy` from the hook.
- UI: a small select in the filter row (near the "N items" count). Match existing shadcn/dropdown styling used in `FilterBar`/`FilterDropdown`. Accessible `<label>`/aria.
- The `range()` pagination and infinite-scroll sentinel keep working unchanged — only the `.order()` clause and reset trigger change.

**Edge cases:** sort change mid-scroll → offset resets, grid refetches from page 0 (acceptable; no partial-page merge weirdness). Ties in `retailprice` fall back to insertion order — acceptable.

**Files:** `useShopFilters.js`, `FilterBar.jsx` (or a small new `SortControl.jsx`), `ShopPage.jsx` (thread props).

### U4 — PDP delivery estimate + low-stock reframe
**What:** Truthful delivery expectation + honest stock framing for a low-depth catalog.

- **Delivery estimate:** static line near the add-to-cart CTA (desktop block + reasonable placement on mobile): "Dispatches in 2 days · Delivered in 5–7 days." Small muted text, not a claim beyond what the store honors. Single source constant so checkout (Phase 2) reuses it.
- **Low-stock reframe:** current `stockLabel` (`ProductDetailPage.jsx:189-194`) shows "Only N left" at stock ≤3. Because most codes carry 1–2 pieces (owner: high variety, low depth), that fires near-universally and reads as false scarcity. Replace with uniqueness framing:
  - selected variant `stock` in 1–3 → "Limited piece — only N in stock" (calm, muted/gold, no alarm-red urgency styling).
  - selected variant `stock ≥ 4` (rare here) → show nothing (no "In stock" string) to avoid noise.
  - `stock === 0` → handled by existing disabled CTA / variant picker (out-of-stock variants already unselectable). No separate "sold out" scare.
  - Net effect: an honest, non-urgent scarcity note shown only when genuinely low, not a universal countdown. Remove the old "In stock" fallback (`ProductDetailPage.jsx:189-194`).

**Files:** `ProductDetailPage.jsx`, small shared constant (e.g. `src/storefront/lib/deliveryEstimate.js` or inline const).

### U5 — Footer / contact truth fix + honest claims + business-legitimacy block
**What:** Remove every placeholder; correct false storefront claims; add gateway-required business identity.

**False-claim fix (`TrustBar.jsx:7`):** current "Easy Returns · Hassle-free 7-day returns" is false — real policy is **no returns; exchange only, within 7 days, unworn, in-store only**. Correct the signal to title **"7-Day Exchange"**, desc **"In-store exchange within 7 days"** (icon `RefreshCw` unchanged). The other three TrustBar claims (free shipping above ₹5,000, secure checkout) are premature-until-checkout and become true in Phase 2 — left to the Home-restructure slice, **not** touched here.

**Contact real values:**
- Phone / WhatsApp: **+91 98108 73280** → `wa.me/919810873280`.
- Email: **bindalscreations@gmail.com**.
- Instagram (primary): **@bindals_creation_shop** → `https://instagram.com/bindals_creation_shop`. Other official IG accounts exist but stay off the footer (avoid clutter; surface on a Contact page later).
- Facebook: **keep** → `https://www.facebook.com/profile.php?id=61579168104897`.

Changes in `StorefrontFooter.jsx`:
- Contact section: real phone (`+91 98108 73280`), real email, WhatsApp link → `919810873280`.
- Social row: Instagram (primary handle, real URL) + Facebook (real URL).
- WhatsApp FAB (`:129-137`): number → `919810873280`. Add a prefilled message param (`?text=Hi, I have a question about a product`).
- New **business-legitimacy block** (footer bottom bar or a dedicated line): registered name **BINDAL'S CREATION**, address **58 Sihani Gate Market, Ghaziabad 201001**, **GSTIN 09ABVPB4203A1Z4**. Small muted text. This is a payment-gateway requirement and a trust signal.
- Display brand elsewhere (logo alt, copyright) stays "Bindal's Creations"; only the legitimacy line + JSON-LD `seller` use the registered "BINDAL'S CREATION".

**Files:** `StorefrontFooter.jsx`, `src/storefront/components/home/TrustBar.jsx`.

### U6 — FAQ page
**What:** `/faq` accordion answering top pre-purchase objections. All answers real (owner decisions now resolved); a few "draft" wordings owner may polish.

- New `src/storefront/pages/FaqPage.jsx` — accordion (reuse shadcn `Accordion` from `src/components/ui/` if present, else a simple details/summary or local disclosure component). Storefront tokens, `<Helmet>` title/description.
- Route: `<Route path="faq" element={<FaqPage />} />` child of `StorefrontLayout`.
- Header link: FAQ appears in footer "Help" list (and header if trivial — footer is enough for v1).
- Content — 11 questions (all real; a few drafts owner may refine):
  1. Delivery time + all-India — **real** (2 days dispatch, 5–7 days delivery, ships across India).
  2. Payment methods — **real** (UPI, cards, netbanking). No COD; no COD mention at all (owner: not offered now, may add later, no claim either way).
  3. Returns/exchange policy + window — **real**: no returns; exchange only, within 7 days of purchase, garment unworn, **in-store only**. Must match the corrected TrustBar signal (U5).
  4. Why only 1 piece / reorder sold-out — **draft** (each design is limited/near-unique; reorder subject to availability, ask on WhatsApp).
  5. Blouse included / stitched-unstitched / alteration — **draft** (owner refines).
  6. How to choose size — **real** (measurement guidance; link size guide when it exists).
  7. Care for silk/embroidered — **real** (dry-clean / gentle-care generic domain guidance).
  8. Track my order — **draft** (order tracking arrives with checkout; for now WhatsApp the store).
  9. Store visit / buy in person — **real** (address + hours; strongest trust signal).
  10. Colour accuracy — **draft** (screens vary; ask for a WhatsApp video/photo).
  11. Fastest contact — **real** (WhatsApp 919810873280).
- No placeholders remain. The four "draft" answers state only true facts; owner may polish wording. Nothing speculative is asserted (no COD, no promises the store can't keep).

**Files:** new `FaqPage.jsx`, `src/App.js` (route), `StorefrontFooter.jsx` (Help link), possibly a small FAQ content data file.

---

## 2. Cross-cutting decisions

| Decision | Choice | Why |
|---|---|---|
| SEO metadata | React 19 native document metadata (no library) | React 19.1 hoists `<title>`/`<meta>`/`<link>` to `<head>` natively, incl. SPA route changes — zero deps, future-proof. Real fix (SSR) deferred per parent plan. |
| Sitemap generation | Standalone `scripts/generate-sitemap.js`, run on demand | Keeps CRA `npm run build` untouched; regenerate when catalog changes. |
| 404 placement | `*` child of `StorefrontLayout` | Inherits header/footer/WhatsApp; admin routes unaffected. |
| Low-stock threshold | Keep ≤3 trigger, reframe copy to uniqueness | Data reality (1–2/code) makes urgency dishonest; uniqueness is on-brand + true. |
| Social links | Instagram (primary bindals_creation_shop) + Facebook, real URLs | Both are real official channels; other IG accounts kept off footer to avoid clutter. |
| Registered vs display name | Legal name only in legitimacy line + JSON-LD seller | Gateway needs legal name; brand stays "Bindal's Creations". |

## 3. Testing

Match existing storefront test style (`src/storefront/__tests__/*`, jest + RTL). Scope tests to logic, not static copy:
- `useShopFilters` sort: changing `sortBy` issues the expected `.order()` and resets offset (mock supabase, assert call). Extend existing filter tests.
- 404 route: unknown storefront path renders `NotFoundPage` (router render test).
- Low-stock/delivery: PDP renders "Limited piece — only N in stock" for low stock and the delivery line (component test with a mocked product/variant).
- FAQ: page renders all question headings (smoke test).
- No test for sitemap script (side-effecting node util) beyond a manual run. `Seo` component: a light render test asserting `document.title` updates (React 19 hoists metadata synchronously in the test renderer) is worthwhile; deep OG/meta assertions are covered by manual verification.

**Note:** `CartDrawer.test.jsx` currently fails pre-existing (react-router-dom module resolution, unrelated) — do not let it block this slice; do not "fix" it here.

## 4. Verification (manual, before done)

1. `npm run build` clean (no new warnings introduced).
2. Unknown path (e.g. `/nonsense`) → branded 404 with working Shop link.
3. Shop: sort control changes grid order (price asc/desc/newest); infinite scroll still loads more; count still correct.
4. PDP: delivery line present; low-stock shows "Limited piece — only N in stock" for a 1–2 stock variant; page source contains `Product` JSON-LD + `<title>`/OG meta.
5. Footer: real phone/email/Instagram, no Facebook, business-legitimacy block with GSTIN; WhatsApp FAB opens chat to 919810873280 with prefilled text.
6. `/faq` renders accordion; placeholder answers flagged; footer Help links to it.
7. `node scripts/generate-sitemap.js` writes `public/sitemap.xml` with product URLs; `robots.txt` references it.

## 5. Out of scope (explicit)

- SSR/prerender (Vite-migration decision).
- About/Contact/policy pages, Home restructure, size-guide page, care page (content-dependent brochure slice — next).
- Checkout, orders schema, edge functions, Razorpay/COD, pincode/Shiprocket (Phases 2–3).
- Header search/wishlist (Phase 4).
- Analytics (F7).
- COD (not offered at launch — owner may add later; no claim made anywhere). Returns/exchange confirmed (no returns; 7-day in-store exchange, unworn). No open content questions remain for this slice.
