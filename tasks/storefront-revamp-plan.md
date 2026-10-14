# Storefront revamp plan — conversion-first, modelled on andaazfashion.com

Written 2026-10-13, revised the same day with decisions from the website design
meeting. Status: plan only. Phase 0 partly shipped (image filter, PR #8).

## Meeting decisions (2026-10-13), which override earlier drafts of this plan

- **Products first, conversion first.** The homepage currently makes visitors scroll
  past an introduction and empty space before they see any product. Lead with
  product rows; brand story goes lower down.
- **Messaging:** "handpicked with love" / "curated with care" / "hand selected",
  not "crafted with love" (the store also sells Western wear and does not make
  its own products).
- **Colour:** keep gold, white and brown shades to match the logo. (This
  replaces the earlier maroon-accent proposal.)
- **Hero (owner, 2026-10-13, supersedes the meeting's "no hero images"):** match
  the Andaaz layout. Directly under the header: a small, subtle band of category
  icons, then a full-width lifestyle image slider, front and centre.
- **Curated launch:** start with about 50 hand-picked products that have
  complete details and several angles each, then expand. Lead with core
  categories that already have images (sarees, kurtas, kurta pajama).
- **Few, clean filters:** customer-facing category labels. Fine-grained
  types (3-piece, 2-piece, Jodhpuri) stay as data, not as separate visible
  filters.
- **Structured product details over long descriptions:** garment type, fabric,
  style tags, occasion, work, package contents, unstitched blouse. Never show
  confidential pricing.

## Diagnosis: why the site reads as bland

1. **Grid full of placeholders.** 2,889 of 3,676 products had no image. Fixed
   2026-10-13: the anon RLS policy now only returns products with images (787).
   This also fixes "newest first shows blank cards".
2. **Introduction before products.** 88dvh text-only hero, then trust bar, then
   products. BrandStory still shows a "[Brand / store photo]" placeholder.
3. **Low density.** 3-column grid and large whitespace. The reference uses
   4 columns, tight gutters, and products everywhere.
4. **Navigation hides the catalogue.** The header only has Home/Shop/About/Contact.
5. **Static feel.** No promo line, no seasonal hook. Kalki and Andaaz use an
   action line (offers, free shipping, festive collection) and a seasonal nav tab
   to feel current.

## What to take from the references (and what not)

Copy **structure and patterns**, not brand (no logo, copy, photos).

**Take:**
- Top action line with real offers/differentiators (e.g. festive collection, free
  shipping threshold, WhatsApp help), and a seasonal nav tab (e.g. Diwali) that
  can be swapped when the season changes.
- Header: search box, category row (Women / Men), seasonal tab.
- Product cards in a consistent frame, 4 columns on desktop / 2 on mobile, swipe slider, real-stock badges.
- Listing: left filter sidebar on desktop that keeps the grid visible while
  refining (no overlay that blurs products), category pills, count + sort.
- PDP: multi-angle gallery with limited zoom, size boxes, size guide in a
  **modal**, full-width CTA, "Ask us on WhatsApp", structured detail table,
  "complete the look" / more-like-this rail.
- Instagram reels embedded or linked as a collection showcase.

**Skip:**
- Fake strikethrough "% off": there is no MRP column (see the data issue below). A
  real promo (e.g. "15% off first order") is fine if the business actually offers it.
- Star ratings / reviews: no review data.
- Countdown timers, exit popups, chat widgets, SEO keyword dumps.
- Celebrity/occasion themed banners: these need photography the store doesn't have.

## Data issues found

- **Cost price in public descriptions (CLEANED 2026-10-13, 9 products).** 6 products have purchase price and MRP
  typed into `products.description` (BC26301, BC26302, BC26303, BC26304,
  BC26308, BC26309, e.g. "Pink,pur 2278,mrp 4795"). None is visible today
  (no images), but each one would leak its cost price as soon as an image is
  added. Fix: clean those descriptions now. Prevent recurrence: add a CHECK
  constraint or an admin-form warning for `pur`/`purchase`/`mrp` in descriptions.
- **Mixed size taxonomy.** Size options mix ages (1–16), letter sizes
  (2XL–7XL) and waist sizes. Needs separate groups (Kids by age, Adult by letter,
  Waist by number), and the size filter should only show groups relevant to the
  selected category (partly works today).
- **Attribute confusion.** Garment type, fabric and style are sometimes mixed
  together (e.g. "cotton Indo-Western"). Garment type should go in `categoryid`,
  fabric in `fabric`, and Indo-Western as a style tag. Several newer products also lack
  descriptions.

## Phases

Each phase ships on its own branch via PR (Vercel deploys from main). Each
phase is verified with Playwright screenshots at 1440px and 390px plus `npm test`.

### Phase 0: prerequisites and fixes
- [x] Image filter: anon sees only products with images (PR #8, 2026-10-13). Out-of-stock stays visible.
- [x] Cleared 9 cost-price descriptions on 2026-10-13 (BC26293–95, BC26301–04, BC26308–09; detected by matching each product's own `purchaseprice` in its description, plus a keyword scan). What remained was only colour and size, which the variants already record, so they were set to NULL. Originals were backed up outside the repo.
- [ ] **Rule (owner, 2026-10-13): a description must be meaningful or empty.** It must not repeat colour, size or price that is already a structured field. Review the 123 visible products with descriptions of 25 characters or fewer during curation; most are short but fine (e.g. "Plain cotton shirt").
- [ ] Guard against new ones: admin-form warning (or CHECK) when a description contains `pur`/`purchase`/`mrp` or the item's purchase price.
- [ ] **Curation:** a `storefront_featured` boolean (or a small curation table) that admin can set, so the storefront shows about 50 curated products. Extend the anon policy to `featured AND has images`. Needs an admin toggle in the inventory UI.
- [ ] Filter bugs: the fabric filter returns wrong results; selecting one option greys out others that still have matches (review the availability logic in `useShopFilters.fetchAvailableOptionsFromDB`).
- [ ] Fix `scrollbar-hide` (used in `NewArrivals.jsx`, defined nowhere).
- [ ] Copy: "crafted with love" becomes "handpicked with love" everywhere.
- [ ] Remove the gap between the homepage action line and the scroll cue.

### Phase 1: tokens and shell
- [ ] Storefront colours as tokens (gold / white / brown), remove hardcoded hexes in `HeroBanner`/`CategoryShowcase`.
- [ ] Action line: a config constant with 2–3 rotating real messages.
- [ ] Header: logo, search box, icons; category row (Women / Men groups using clean labels) plus an optional seasonal tab from config.
- [ ] Mobile: drawer with categories; search under the header.

### Phase 2: product card, image framing and listing
- [ ] **Image framing (open question):** pick one approach after testing on about 30 real products. Option A: a fixed 3:4 frame, `object-cover` aligned to the top (consistent card heights, may crop). Option B: a fixed frame with `object-contain` over a blurred fill (current `BlurFillImage`, no crop, looks letterboxed). Recommend A, plus re-cropping source photos where needed. Free-height cards are rejected because they break side-by-side comparison.
- [ ] `ProductCard.jsx`: chosen frame, flat style, 2-line name, price, heart, real badges ("New", "Only X left", "Sold out").
- [ ] `ProductGrid.jsx`: `grid-cols-2 lg:grid-cols-4`, tighter gaps.
- [ ] Customer-facing category groups: map raw categories (Suit (2 Pc), Suit (3 Pc), Suit (Jodhpuri) - 2Pc, Readymade Suits, Suits...) to a few visible labels; keep raw categories as data. Probably a `display_group` column on `categories`.
- [ ] `ShopPage.jsx`: desktop left sidebar (grid stays visible), mobile drawer, category pills, count + sort, fewer visible filters.
- [ ] Tests for `ProductCard`, `ProductGrid`, and the category-group mapping.

### Phase 3: home page (products first)
1. Action line + header
2. **Category band:** a subtle, compact horizontal strip of small rounded-square
   category icons (~72px) with labels, using clean customer-facing groups.
   Horizontal scroll on mobile. Icons are crops of a strong product photo per group
   (manual pick per group via config, falling back to the newest image).
3. **Lifestyle hero slider:** full-width, front and centre, ~2.6:1 on desktop
   (1920×740) with separate mobile crops (~4:5). 3–5 slides, each a lifestyle
   photo plus a short headline and CTA linking to a category or collection, with
   autoplay, arrows and dots. Text sits on the image (HTML overlay, not baked
   into the image) so copy can change without re-exporting. Replaces the
   current text-only `HeroBanner`. Slides live in a typed config file
   (image, mobile image, headline, CTA, link).
   Interim until lifestyle photos exist: the best existing product photos on a
   gold/cream backdrop.
4. Product rails: New Arrivals, then one per core category (Saree, Kurti, Lehenga, Gown, Suits)
5. Trust row ("handpicked with love", easy returns, WhatsApp help, real shipping terms)
6. Instagram reels strip (link or embed)
7. About: when the business started, store photo
8. Contact: Google Maps, store photos, WhatsApp, email, hours
9. FAQ accordion, footer

### Phase 4: product detail page
- [ ] Multi-angle gallery with limited zoom.
- [ ] Structured details table replaces the long description where details exist:
      garment type, fabric, colour, work, style tags, occasion, package contents
      (e.g. kurta only vs kurta + pajama), "blouse unstitched" flag.
      Schema: new nullable columns or a `product_attributes` table, decided at
      spec time. Fill in for the curated 50 first.
- [ ] Size guide in a modal on the PDP (reuse `sizeGuideContent.js`), not a separate page.
- [ ] Full-width Add to Cart, sticky bar on scroll, WhatsApp "Ask us", delivery estimate.
- [ ] "More like this" rail.

### Phase 5: content (owner)
- [ ] **3–5 lifestyle hero photos** (blocks the real hero): landscape for desktop with a mobile-safe centre, or separate mobile shots. Ideal: models in the outfits, festive setting, room on one side for text.
- [ ] Multi-angle photos for the curated 50 (ChatGPT storyboards were suggested as a shot-list aid).
- [ ] Store and storefront photos for About/Contact.
- [ ] One-gram jewellery once photographed.
- [ ] Seasonal collections (e.g. Diwali tab) driven by a tag on products.

## Using TypeSafe Jev for catalogue data

Moved to its own future-phase file: `tasks/future-jev-catalogue-tagging.md`
(description review results, tagging ideas, rules).

## Risks / notes
- Source images are 4.7 MB PNGs. The Vercel optimizer handles delivery, but more images means more transformations. Watch usage (Hobby is non-commercial).
- New image widths must be added to `vercel.json` `images.sizes`.
- Curation (about 50) and the image filter (787) stack. Decide whether non-curated products with images remain reachable by search or a direct URL.
- Untested today: ProductCard, ProductGrid, ShopPage, ProductDetailPage, HeroBanner, CategoryShowcase, NewArrivals.

## Owner decisions needed
1. **[PINNED 2026-10-13] Curation mechanism:** a flag on `products` toggled from the admin inventory page (recommended), or a hard-coded list of product IDs to start.
2. **[PINNED 2026-10-13] Do non-curated products with images stay reachable** via search / direct URL, or does the storefront show only the curated set?
3. **Image framing: DECIDED 2026-10-13.** Test Option A (3:4 cover, top-aligned) on 30 products; if it works, roll it out to all.
4. **[PINNED 2026-10-13] Hero photos:** do lifestyle photos exist (shoots, Instagram reels/posts you own), or should the slider launch with product photos and swap later?
5. **Real offer for the action line:** which offers actually exist (e.g. 15% off, free shipping threshold)?
