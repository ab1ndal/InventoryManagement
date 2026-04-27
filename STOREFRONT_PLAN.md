# Bindal's Creations — Online Storefront Plan

**URL:** www.bindalscreations.com  
**Stack:** React 19 SPA, Supabase (existing), Tailwind + Shadcn/ui  
**Goal:** Public-facing retail store at `/` with product browse, cart, and worldwide checkout.

---

## Design System

| Dimension | Decision |
|-----------|----------|
| Style | Liquid Glass + Glassmorphism (premium ethnic luxury) |
| Primary | `#1C1917` (dark charcoal) |
| Accent/Gold | `#A16207` (gold) |
| Background | `#FAFAF9` (warm cream) |
| Heading font | Cormorant (serif, 600–700 weight) |
| Body font | Montserrat (400/500 weight) |
| Icon set | Lucide React (already installed) |
| Breakpoints | 375 / 768 / 1024 / 1440 |
| Spacing scale | 4/8px multiples |

---

## Site Map

```
/                        ← Homepage (public storefront)
/shop                    ← All products, filtered grid
/shop/[category-slug]    ← Category pages
/product/[product-id]    ← Product detail
/cart                    ← Cart (drawer overlay, not page)
/checkout                ← Multi-step checkout
/order/[order-id]        ← Order confirmation
/account                 ← Customer login + orders + wishlist
/about                   ← Brand story
/contact                 ← Contact + WhatsApp
/admin/*                 ← Existing admin (UNCHANGED)
```

---

## Phase Checklist

### Phase 1 — Foundation + Homepage
**Goal:** Public `/` live without breaking admin. Brand impression.

- [ ] Change App.js: `/` → `<StorefrontLayout>` (not redirect to `/admin`)
- [ ] Create `src/storefront/` directory structure
- [ ] Create `StorefrontLayout` with sticky header + footer
- [ ] Build `StorefrontHeader`: Logo | Category nav | Search icon | Wishlist icon | Cart count badge
- [ ] Build `StorefrontFooter`: Links, social, payment logos, WhatsApp CTA
- [ ] Build Homepage (`/`) with sections:
  - [ ] Hero banner (rotating, seasonal — static content initially)
  - [ ] Category showcase grid (Sarees / Lehengas / Salwar / Kurtis / Dupattas)
  - [ ] "New Arrivals" horizontal scroll (live from Supabase `products`)
  - [ ] Featured collection editorial block (static initially)
  - [ ] Bestsellers grid 3×2 (live from Supabase `products`)
  - [ ] Trust bar: Worldwide Shipping | Authentic | Easy Returns | Secure Pay
  - [ ] Customer reviews section (static content initially)
  - [ ] Newsletter signup (email capture, no backend yet — just UI)
- [ ] Persist design system to `design-system/MASTER.md`
- [ ] Verify admin routes still work post-routing change
- [ ] Test: 375px mobile, 768px tablet, 1440px desktop

**Supabase changes:** None. Read-only queries to `products`, `categories`.  
**Status:** ⬜ Not Started

---

### Phase 2 — Product Catalog + Filtering
**Goal:** Browse and filter all products.

- [ ] Build `/shop` — product listing page
  - [ ] Filter sidebar (desktop) / bottom sheet (mobile)
  - [ ] Filters: Category | Fabric | Occasion | Color | Price Range | Size
  - [ ] Sort: New Arrivals | Price ↑↓ | Popularity | Discount
  - [ ] Active filter chips above grid
  - [ ] Product grid: 3-col desktop, 2-col mobile
  - [ ] Product card: image + hover-second-image | name | price | quick-add
  - [ ] Empty state with clear filters CTA
  - [ ] Skeleton loading (shimmer)
- [ ] Build `/shop/[category-slug]` — pre-filtered by category
- [ ] URL-persisted filter state (query params)
- [ ] Supabase public RLS read policy on `products`, `productsizecolors`, `categories`

**Status:** ⬜ Not Started

---

### Phase 3 — Product Detail Page
**Goal:** Full product info, gallery, variant picker.

- [ ] Build `/product/[id]`
  - [ ] Image gallery: main + thumbnails, pinch-zoom on mobile
  - [ ] Product title + SKU (`BC{YY}{###}` format)
  - [ ] Price with discount strikethrough
  - [ ] Size + Color selector (from `productsizecolors`)
  - [ ] Stock availability indicator
  - [ ] Quantity picker + Add to Cart (sticky bar on mobile)
  - [ ] Size guide modal
  - [ ] Fabric + care instructions + shipping info tabs
  - [ ] "You may also like" carousel (same category)
  - [ ] Breadcrumb: Home → Category → Product
- [ ] Share product URL (deep link)

**Status:** ⬜ Not Started

---

### Phase 4 — Cart + Checkout (Worldwide Orders)
**Goal:** Guest cart → address → payment → order confirmation.

**Billing utility reuse:**
- `billUtils.js` → `priceItem`, `computeBillTotals`, `round2` reusable for cart totals
- GST logic (5%/18% slabs) applies for Indian orders; international orders: GST = 0, show pre-tax price
- `generateInvoicePdf.js` reusable for order invoice download
- `bills` table: add `source = 'online'` flag OR create separate `online_orders` table referencing same item schema

**New Supabase tables needed:**
```sql
online_orders (id, customer_id, items_json, subtotal, gst_amount, grand_total, 
               shipping_address, payment_id, payment_status, status, created_at)
-- items_json mirrors bill line items schema for billUtils compatibility
```

- [ ] Cart state: localStorage for guest, Supabase for logged-in
- [ ] Cart drawer (slide-in from right)
  - [ ] Line items with qty +/- and remove
  - [ ] Subtotal + GST (India) or pre-tax (international)
  - [ ] "Proceed to Checkout" CTA
- [ ] Multi-step checkout `/checkout`
  - [ ] Step 1: Contact info (email, phone)
  - [ ] Step 2: Shipping address (international address form with country selector)
  - [ ] Step 3: Order review + payment
  - [ ] Step indicator (progress bar)
- [ ] Payment integration: Razorpay (India) + Stripe (international)
- [ ] `/order/[id]` — confirmation page + invoice download
- [ ] Order confirmation email (Supabase Edge Function or Resend)

**Status:** ⬜ Not Started

---

### Phase 5 — Customer Accounts + Order History
**Goal:** Login, wishlist, order tracking.

- [ ] Customer auth (separate from admin — same Supabase Auth, different `profiles.role`)
- [ ] `/account` dashboard: profile, past orders, wishlist
- [ ] Wishlist (heart icon on product cards → saved to account)
- [ ] Order status tracking
- [ ] Reorder from past orders

**Supabase changes:** `wishlists` table, `customer` role in `profiles`.  
**Status:** ⬜ Not Started

---

### Phase 6 — Reviews, SEO, Performance
**Goal:** Trust signals + discoverability + Core Web Vitals.

- [ ] Product reviews (submit + display)
- [ ] Meta tags + Open Graph per product page
- [ ] Sitemap generation
- [ ] Image optimization: WebP conversion, srcset, lazy loading
- [ ] Google Analytics / Meta Pixel
- [ ] Structured data (JSON-LD for products)

**Status:** ⬜ Not Started

---

## Key Architecture Notes

**Routing split (Phase 1 critical):**
```
/        → <StorefrontLayout> (NEW — currently redirects to /admin/inventory)
/admin/* → existing admin (UNCHANGED)
```

**Supabase RLS for public storefront:**  
Products/categories need public read policy (anon role). Currently admin-only.

**No new build tooling** — stays in Create React App.  
**Currency:** Display INR (₹) for India, USD ($) for international (detect by country selection at checkout).

---

## Progress Tracker

| Phase | Status | Started | Completed |
|-------|--------|---------|-----------|
| 1 — Foundation + Homepage | ⬜ Not Started | — | — |
| 2 — Product Catalog | ⬜ Not Started | — | — |
| 3 — Product Detail | ⬜ Not Started | — | — |
| 4 — Cart + Checkout | ⬜ Not Started | — | — |
| 5 — Accounts | ⬜ Not Started | — | — |
| 6 — SEO + Performance | ⬜ Not Started | — | — |
