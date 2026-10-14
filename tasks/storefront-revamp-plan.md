# Storefront revamp plan — modelled on andaazfashion.com

Written 2026-10-13. Status: plan only, awaiting owner decisions (bottom). No code yet.

## Diagnosis: why the site reads as bland

1. **Grid full of placeholders.** 2,889 of 3,676 products have no image, so the card
   falls back to initials. Most of the "blandness" is this. Fixed by the
   image-filter todo (`tasks/todo.md`), which is therefore Phase 0.
2. **No photography above the fold.** Hero is a charcoal pattern with text
   (`components/home/HeroBanner.jsx`); BrandStory image slot is literally
   "[Brand / store photo]".
3. **Low density.** 3-column grid, large whitespace, 88dvh text-only hero. The
   reference is dense: 4 columns, tight 20px gutters, product images everywhere.
4. **Navigation hides the catalogue.** Header nav is Home/Shop/About/Contact. The
   reference puts ~14 category links and a big search box in the header.

## What to take from the reference (and what not)

Copy the **structure and patterns**, not their brand: no logo, copy, photos,
or their exact burgundy-on-Lato identity. Andaaz's look is ~70% styled
photography and designed banners; we have only product photos. So the plan
splits into work we can ship now with product photos vs. work blocked on
owner-supplied photos.

**Take (works with plain product photos):**
- Header: wide search box, category nav row under the logo, Women / Men split.
- Round/rounded-square category icon strip (cropped from product photos).
- 2:3 product cards, 4 cols desktop / 2 mobile, swipe slider, real-stock badges.
- Listing: sub-category pills, toolbar (count + sort), expanded left filter sidebar on desktop.
- PDP: vertical thumbs + large 2:3 image with zoom, size boxes, full-width CTA,
  trust icon row, spec table + accordions, sticky add-to-cart bar, "More like this" rail.
- Home: trust row, multiple product rails (per category), CSS-only "Shop by Price" cards,
  contact cards, FAQ accordion (reuse `faqContent.js`).
- Flat style: near-square corners, no shadows, one strong accent colour.

**Skip:**
- Strikethrough "% off" prices: `products` has no MRP/compare-at column, and
  inventing an original price is a misleading-pricing problem. Revisit only if a real
  `mrp` column is added.
- Star ratings / reviews: no review data.
- Countdown timers, exit popups, chat widgets, SEO keyword dumps: clutter.
- Video carousel, celebrity/occasion themed tiles: need content we don't have.

## Phases

Each phase ships on its own branch via PR (Vercel deploys from main). Each
phase is verified with Playwright screenshots at 1440px and 390px, compared
against the reference screenshots in the session scratchpad, plus `npm test`.

### Phase 0: prerequisites
- [ ] Image-filter migration (todo item in `tasks/todo.md`). Without it every later phase still looks empty.
- [ ] Fix `scrollbar-hide` (used in `NewArrivals.jsx`, defined nowhere).

### Phase 1: design tokens and shell
- [ ] Move storefront colours to tokens in `tailwind.config.js`, add the chosen accent (decision 1). Remove hardcoded hexes in `HeroBanner`/`CategoryShowcase`.
- [ ] Typography: keep Fraunces for display only; body Inter at denser sizes. No new fonts unless decision 1 says otherwise.
- [ ] Header (`StorefrontHeader.jsx`): announcement bar text in a config constant; logo left, full-width search input (opens existing `SearchOverlay`), icons right; second row = top categories from DB grouped Women / Men, plus Shop All.
- [ ] Mobile: hamburger drawer listing categories; search bar under the header.
- [ ] Footer: keep columns, flatten style, add newsletter only if there's somewhere to send it (otherwise skip).

### Phase 2: product card and listing (highest impact after Phase 0)
- [ ] `ProductCard.jsx`: 2:3 image, flat, name 2 lines, price, heart; badges from real data only ("New" for latest N products, "Only X left", "Sold out").
- [ ] `ProductGrid.jsx`: `grid-cols-2 lg:grid-cols-4`, tighter gaps.
- [ ] `ShopPage.jsx`: sub-category pill row, toolbar (count + `SortControl`), desktop left sidebar rendering existing filter state from `useShopFilters` (logic unchanged); mobile keeps a filter drawer.
- [ ] Add tests for `ProductCard` and `ProductGrid` (none exist today).

### Phase 3: home page
New order:
1. Announcement bar + header
2. Category icon strip (square crops of the newest product image per category, reusing the `CategoryShowcase` loader)
3. Hero: product-collage slider built from real product images and a CTA (interim); swap to photo banners once decision 2 delivers images
4. Trust row (restyled `TrustBar`)
5. New Arrivals rail
6. Per-category rails for the top categories (Gown, Kurti, Lehenga, Saree, Suits)
7. Shop by Price cards (CSS only, link to `/shop?price=`)
8. Brand story with a real store photo (needs decision 2), else drop the section
9. Contact cards + FAQ accordion
10. Footer

### Phase 4: product detail page
- [ ] Gallery: vertical thumbs, large 2:3 main image, click-to-zoom / lightbox.
- [ ] Info column: title, price, tax/shipping line, size boxes (restyle `VariantPicker`), full-width Add to Cart, WhatsApp "Ask us" secondary button, delivery estimate (existing `deliveryEstimate`), trust icon row.
- [ ] Spec table + accordions: Description, Size guide (from `sizeGuideContent.js`), Returns (from policy content).
- [ ] Sticky add-to-cart bar on scroll (desktop and mobile).
- [ ] "More from this category" rail.

### Phase 5: photography-dependent (blocked on owner)
- [ ] 3–5 hero banners (desktop 1920×740 + mobile crops), store/brand photo, optional lifestyle shots for category tiles.
- [ ] Hold banners as a typed config file in the repo first; add a `banners` table + admin page only if they change often (YAGNI until then).

## Risks / notes
- Source images are 4.7 MB PNGs. The Vercel optimizer handles delivery, but more images per page means more optimizer transformations. Watch usage (Hobby plan is non-commercial; see memory on Vercel Pro).
- New image widths (e.g. 2:3 at 520/800) must be added to `vercel.json` `images.sizes`.
- Untested today: ProductCard, ProductGrid, ShopPage, ProductDetailPage, HeroBanner, CategoryShowcase, NewArrivals. Add tests as each is touched.

## Owner decisions needed
1. **Accent colour:** deep maroon accent with gold kept for the logo/details (recommended: reads as ethnic wear, closest to the reference), or keep the current charcoal + gold.
2. **Photos:** can you supply 3–5 banner/lifestyle photos and one store photo? This decides whether the hero is a product collage (now) or photo banners (later).
3. **Scope of the image filter** (see `tasks/todo.md`): images only (787 products), or also hide out-of-stock (745)?
