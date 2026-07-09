# Storefront Overhaul Plan

**Date:** 2026-07-07
**Scope:** Public storefront (`src/storefront/*`) — UI/UX overhaul, page/functionality completeness, and the full checkout + shipping flow.
**Out of scope:** Admin panel, billing engine, Vite migration (tracked in `docs/AUDIT-2026-07-07.md`).

---

## 1. Current State (audited 2026-07-07)

### What exists
| Area | Status |
|---|---|
| Routes | `/` (Home), `/shop`, `/product/:productid` only (`src/App.js:42-46`) |
| Home | 8 sections: Hero, TrustBar, CategoryShowcase, NewArrivals, FeaturedCollection, BestsellerGrid, Reviews, Newsletter |
| Shop | Filter bar (category, size, color, price), product grid, URL-synced filters |
| Product detail | Gallery w/ thumbnails + swipe, variant picker, markdown-lite description, add to cart |
| Cart | `CartContext` (localStorage), slide-out `CartDrawer` — **no cart page, no checkout** |
| Design tokens | `storefront-cream/charcoal/gold/warm/muted/border` palette; Fraunces (display) + Inter (body) |
| Data | Supabase anon key, RLS public-read policies (`schema/migration_storefront_public_read.sql`); images from public `mockups` bucket via folder listing (`src/storefront/lib/productImage.js`) |

### What is broken, fake, or missing (the "AI slop" inventory)
1. **Dead nav links** — Header links to `/about` and `/contact`; neither route exists (`StorefrontHeader.jsx:9-10`).
2. **No-op buttons** — Search and Wishlist icons in header do nothing (`StorefrontHeader.jsx:78-89`).
3. **Fake reviews** — `ReviewsSection.jsx` renders 3 hardcoded invented testimonials. Classic slop; erodes trust the moment a customer googles the reviewer.
4. **Fake newsletter** — `NewsletterSignup.jsx` shows a success state without storing the email anywhere.
5. **Unbacked promises** — Announcement bar + TrustBar claim "Free shipping above ₹5,000", "Worldwide delivery", "7-day returns", "Secure Checkout". No checkout, no shipping, no returns policy page exists.
6. **Cart is a dead end** — Drawer has no checkout path. localStorage cart never validates against live stock or price.
7. **No SEO surface** — CRA SPA: one `index.html`, no per-page `<title>`/meta/OG tags, no structured data, no sitemap for products. For a storefront this is a real business problem, not a nicety.
8. **No policy/legal pages** — Shipping, Returns, Privacy, Terms. Razorpay/any Indian payment gateway **requires** these pages live on the domain before approving a merchant account.
9. **No 404** — unknown paths render blank inside layout.
10. **~4/10 products have no image** — placeholder is fine, but Shop grid dominated by placeholders reads as unfinished.

### Constraint changes required
- **"No server-side code" rule must bend.** Payment cannot be done client-only (secret key + webhook signature verification). Precedent exists: `supabase/functions/send-bill-sms`. Checkout requires 2–3 new Supabase Edge Functions.
- **Blockers from the audit that gate a public checkout launch** (see `docs/AUDIT-2026-07-07.md`):
  - `mockups_view` leaks `purchaseprice` to anon — must fix before driving more public traffic.
  - `REACT_APP_SUPABASE_SERVICE_ROLE_KEY` env naming — CRA inlines it into the browser bundle. Rename first.
  - `send-bill-sms` edge fn has no auth + CORS `*` — fix pattern before cloning it for order notifications.

---

## 2. Design Direction (anti-slop principles)

The existing foundation is actually good: Fraunces + Inter, cream/charcoal/gold, editorial spacing. The problem is not the palette — it's **generic structure and fake content**. Rules for the overhaul:

1. **Content is the design.** Real product photography, real category names, real store story (family business, city, since-when), real customer photos if available. Every section that can't be filled with real content gets **cut**, not faked.
2. **Reduce, don't add.** Home currently stacks 8 sections — the template-y "hero → trust icons → grid → reviews → newsletter" rhythm is itself the slop signal. Target 4–5 sections with strong art direction:
   - Full-bleed editorial hero (one real campaign image, seasonal, not a stock gradient)
   - Category showcase (large asymmetric image tiles, not uniform cards)
   - New arrivals rail
   - Brand story strip (real text + one image — replaces fake reviews)
   - Minimal footer with newsletter folded in
3. **Kill or make real:** fake reviews (kill until real ones exist — later, pull from verified orders), fake newsletter (wire to a `newsletter_subscribers` table or cut), wishlist (cut icon in v1; implement in v2 with localStorage like cart), "Worldwide delivery" claim (scope to what shipping actually supports at launch — likely India-only first).
4. **Typography discipline.** Fraunces only for display sizes (hero, section heads, product names on PDP); everything else Inter. One tracking/uppercase style for eyebrows, used consistently. No gradient text, no glassmorphism, no gratuitous animation — motion limited to: image hover zoom (1.03, 400ms), fade-up on scroll for section entries (respect `prefers-reduced-motion`), drawer/sheet transitions.
5. **Product grid = photography grid.** 3:4 aspect locked, generous whitespace, name + price only (no rating stars, no badges unless real: "New", "Low stock"). Hover swaps to second image where one exists.
6. **Ethnic-wear-specific UX** (this is a saree/lehenga/suit retailer, not generic apparel):
   - Fabric/work/occasion belong in filters and PDP specs, not just size/color.
   - PDP should surface: fabric, work/embroidery, blouse/stitching notes, care, delivery estimate.
   - Size guidance matters more than in western wear — measurement guide page/modal.
7. **Accessibility + performance floor:** 4.5:1 text contrast on cream, visible focus rings, 44px touch targets, lazy-load below fold, explicit image dimensions (CLS < 0.1), `min-h-dvh` not `100vh`.

---

## 3. Page Inventory

### Keep + refine
| Page | Route | Work |
|---|---|---|
| Home | `/` | Restructure per §2.2 — cut to 4–5 sections, real content |
| Shop | `/shop` | Add fabric-family + color-family filters (gated on `docs/ATTRIBUTE-NORMALIZATION-PLAN.md`; occasion cut — no data), sort control, result count, empty states, skeletons; keep URL sync |
| Product detail | `/product/:productid` | Add specs block, delivery estimate (pincode check), stock state ("Only 2 left"), related products, breadcrumbs, share |

### New — required for launch
| Page | Route | Purpose |
|---|---|---|
| Cart | `/cart` | Full-page cart (drawer stays for quick add). Line-item edit, stock/price revalidation against DB, order summary, checkout CTA |
| Checkout | `/checkout` | Single page, guest-first: contact → address → shipping method → pay. No forced account |
| Order confirmation | `/order/confirmed/:orderRef` | Success state, order summary, what-happens-next |
| Order lookup/tracking | `/track` (+ `/track/:orderRef`) | Guest order status by order ref + phone/email. Shows status timeline + courier tracking link |
| About | `/about` | Real brand story. Kills dead nav link |
| Contact | `/contact` | Address, phone, WhatsApp link, hours, map. Kills dead nav link |
| Shipping policy | `/policies/shipping` | Required by payment gateway |
| Returns/exchange policy | `/policies/returns` | Required by gateway; must match TrustBar claim |
| Privacy policy | `/policies/privacy` | Required by gateway |
| Terms of service | `/policies/terms` | Required by gateway |
| 404 | `*` | Branded not-found with links back to Shop |

### New — buyer experience & trust pages
These exist to answer the questions a first-time buyer asks before trusting an unknown store with ₹5,000+: *Is this a real business? Will it fit? What if it doesn't? Can I talk to a human?*

| Page | Route | Purpose |
|---|---|---|
| FAQ | `/faq` | Pre-purchase objections in one place: delivery times, COD, returns, stitching/blouse questions, care. Accordion; content sourced from real customer questions the store already gets in person/WhatsApp |
| Size guide | `/size-guide` | Measurement guidance with diagrams; also a PDP modal. Critical for ethnic wear — sizing doubt is the #1 conversion killer |
| Visit the store | `/store` (or fold into `/contact`) | Photos of the physical shop, address, map, hours. A real brick-and-mortar store is the strongest trust signal an online-unknown brand has — lead with it |
| Care guide | `/care` (or PDP accordion) | Fabric care for silk/embroidered pieces; signals expertise |
| Craftsmanship / Our story | part of `/about` | Real sourcing story, artisan/work photos — backs the "sourced directly from artisans" TrustBar claim with evidence instead of an icon |

### New — v2 (post-launch)
| Page | Route | Purpose |
|---|---|---|
| Collections | `/collections/:slug` | Curated/occasion landing pages (wedding, festive) — SEO surface |
| Search results | `/search` | Backs the header search icon |
| Lookbook | `/lookbook` | Editorial photo gallery of real pieces styled — premium positioning + shareable |

### Trust elements (site-wide, not pages)
| Element | Where | Notes |
|---|---|---|
| WhatsApp chat button | Floating, all storefront pages | Single highest-leverage trust feature for Indian D2C — buyers verify the store is real by messaging it. `wa.me` link, zero backend |
| Business legitimacy footer | Footer | Registered business name, physical address, GSTIN, phone, email. Also a gateway requirement |
| Payment method logos | Footer + checkout | UPI/Visa/MC/RuPay/Razorpay marks — official assets only |
| Real product photos on PDP | PDP | "Studio" + "on-person" shots where available; buyers distrust catalogs with renders only |
| Verified reviews | PDP + Home (v2) | Only from actual orders (post-delivery WhatsApp ask). Until then, show nothing — no fakes |
| Delivery estimate | PDP + checkout | "Dispatches in 2 days · Delivered in 5–7" — concrete beats "fast shipping" |
| Low-stock honesty | PDP | "Only 2 left" only when true (stock ≤ threshold from live data) |
| Order confirmation on WhatsApp | Post-purchase | Immediate confirmation with order ref — reassures the money went somewhere real |

---

## 4. Functionality Gaps (non-checkout)

| # | Item | Notes |
|---|---|---|
| F1 | **Search** | v1: client-side name/category match over cached catalog, opened from header icon (command-palette style). v2: Postgres `ilike`/FTS |
| F2 | **Wishlist** | Cut header icon now; v2 localStorage implementation mirroring CartContext |
| F3 | **Newsletter** | `newsletter_subscribers` table + anon INSERT policy (rate-limited via unique email), or delete section |
| F4 | **Cart revalidation** | On drawer open + cart page load: refetch variant price/stock; flag removed/repriced/out-of-stock items |
| F5 | **SEO** | `react-helmet-async` per-page title/meta/OG; `Product` JSON-LD on PDP; generated `sitemap.xml` (script over products table); real fix is prerender/SSR — defer to Vite migration decision |
| F6 | **Image pipeline** | Use Supabase render/transform URLs for grid thumbs (already precedent from premium-images branch); `srcset`; prioritize hero, lazy rest |
| F7 | **Analytics** | Minimal event tracking (page views, add-to-cart, checkout steps) — cannot improve conversion blind. Plausible/GA4 |
| F8 | **Announcement bar content** | Drive from a small `site_settings` table or config, so promises stay in sync with real policy |

---

## 5. Checkout + Shipping Flow (the main build)

### 5.1 Decisions (recommended)
| Decision | Recommendation | Why |
|---|---|---|
| Payments | **Razorpay** (Cards/UPI/netbanking) + **COD** option | Standard for Indian D2C; UPI is majority of transactions; COD still ~40% of Indian e-comm |
| Customer accounts | **Guest checkout only at launch** | Accounts add auth surface + friction; order lookup via ref+phone covers tracking |
| Shipping ops | **Shiprocket** (aggregator) | One API → many couriers, pincode serviceability, rate cards, tracking webhooks, COD remittance. Manual booking via their dashboard is fine at low volume — API integration can be phase 2 of shipping |
| Shipping pricing v1 | Flat rate (e.g. ₹99–149) + free above ₹5,000 (matches banner); India-only | Simple, honest; "worldwide" claim comes down until actually supported |
| Stock model | **Decrement at payment capture** via transactional RPC (`stock = stock - qty WHERE stock >= qty`), not at add-to-cart | No reservation complexity; low-volume store; oversell handled by refund path. Reuses the atomic-RPC pattern the audit already prescribes for billing |
| Server code | Supabase Edge Functions | Only place secrets + webhook verification can live |

### 5.2 New database schema (`schema/migration_storefront_orders.sql`)
> Note: orphan `cart_items` table exists in live DB with zero repo refs — ignore/drop; cart stays client-side until checkout.

```
orders
  orderid        bigint identity PK
  orderref       text UNIQUE          -- human ref e.g. BCO-2026-00042 (sequence-backed, like bill_sequences)
  status         text CHECK IN ('pending_payment','paid','cod_confirmed','packed','shipped','delivered','cancelled','refunded')
  customer_name, phone, email
  shipping_address jsonb              -- line1, line2, city, state, pincode
  subtotal, shipping_fee, discount, total   numeric
  payment_method text CHECK IN ('razorpay','cod')
  razorpay_order_id, razorpay_payment_id  text
  courier, awb_number, tracking_url   text
  notes, created_at, updated_at

order_items
  orderitemid    PK
  orderid        FK → orders
  variantid      FK → productsizecolors
  productid, name, size, color        -- denormalized snapshot
  unit_price     numeric              -- price at purchase time
  quantity       int

newsletter_subscribers (email UNIQUE, created_at)   -- if F3 kept
```

**RLS:** no anon SELECT/UPDATE on orders. Anon interacts only through Edge Functions (service role). Order lookup goes through an RPC/function that requires `orderref + phone` match. Admin (`is_admin()`) full read/write.

**Status is a state machine:** `pending_payment → paid → packed → shipped → delivered`, with `cod_confirmed` replacing `paid` for COD, and `cancelled`/`refunded` exits. Enforce transitions in the admin UI + a CHECK/trigger if cheap.

### 5.3 Edge Functions
| Function | Does | Security |
|---|---|---|
| `create-order` | Validates cart server-side (re-price from DB, check stock), computes shipping, inserts `orders` row (`pending_payment`), creates Razorpay order, returns razorpay_order_id + amount | Anon-callable; strict input validation; rate-limit; never trusts client prices |
| `verify-payment` (webhook) | Razorpay webhook: verify HMAC signature, mark order `paid`, **decrement stock atomically via RPC**, trigger confirmation message | Signature-verified only; idempotent (safe on redelivery) |
| `confirm-cod` | Creates COD order (`cod_confirmed`) with same validation + stock decrement; optional OTP-on-phone later if COD abuse appears | Anon-callable, validated |
| `order-status` | Returns order status timeline for `orderref + phone` | No enumeration: exact-match both fields, rate-limit |

Confirmation notification: reuse WhatsApp/SMS path from `send-bill-sms` **after** fixing its missing auth + CORS `*` (audit item). Email optional (Resend) later.

### 5.4 Frontend checkout flow
```
CartDrawer ──"View cart"──> /cart (revalidated) ──> /checkout
  Step blocks on one page (contact → address → shipping → payment)
  ├─ Razorpay: create-order → Razorpay JS checkout modal → poll/confirm → /order/confirmed/:ref
  └─ COD:      confirm-cod ────────────────────────────────────────────> /order/confirmed/:ref
```
- React Hook Form + Zod (already in stack); Indian address schema (6-digit pincode, state select, 10-digit phone).
- Pincode → serviceability + delivery-estimate check (Shiprocket API in phase 2; static estimate in phase 1).
- Failure paths designed up front: payment abandoned (order stays `pending_payment`, auto-expire), webhook lost (reconcile job / "verify payment" retry on confirmation page), stock ran out between cart and pay (`create-order` rejects with clear per-item message).

### 5.5 Mechanism decisions (added 2026-07-07 — gaps found in sufficiency review)
| Concern | Decision |
|---|---|
| Rate limiting | Edge functions have **no built-in rate limit**. v1: per-IP+endpoint counter table in Postgres (`rate_limits`, sliding window, checked inside each fn). Revisit (Upstash) only if volume demands. Matters most for `order-status` enumeration |
| `pending_payment` expiry | `pg_cron` job: orders in `pending_payment` older than 24h → `cancelled`. No stock was decremented pre-payment, so expiry touches no stock |
| Confirmation-page race | Client can land on `/order/confirmed/:ref` before the Razorpay webhook arrives. Page polls `order-status` (orderref+phone already in checkout session state) every 3s up to 60s showing "confirming payment…"; on timeout show "payment received, confirmation pending — check /track or WhatsApp us" (order stays `pending_payment` until webhook/reconcile) |
| Webhook amount check | HMAC proves Razorpay sent it, not that the amount is right. `verify-payment` must compare captured amount against `orders.total`; mismatch → do NOT mark paid, flag for admin review |
| Stock restore | State-machine side effects: stock decrements on `paid`/`cod_confirmed` only; `cancelled`/`refunded` from those states restores stock via the same atomic RPC (increment). `pending_payment → cancelled` touches no stock |
| Tests | Money paths get tests like billing math has: `create-order` re-price/stock validation (unit), stock-decrement RPC under concurrency, `verify-payment` idempotency (replay same webhook event twice) |

### 5.6 Admin side (minimal but required)
- **Orders page** (`/admin/orders`): list, filter by status, detail view, status transitions (packed → shipped w/ AWB + courier + tracking URL fields), print packing slip (QZ Tray precedent exists).
- Storefront orders must **not** collide with in-store billing stock: both paths decrement the same `productsizecolors.stock` through the same atomic RPC.

### 5.7 Shipping operations phases
1. **Phase A (launch):** Orders land in admin; book shipments manually in Shiprocket dashboard; paste AWB/tracking into order → customer sees it on `/track`.
2. **Phase B:** Shiprocket API — create shipment from admin order page, auto-pull AWB + label PDF, tracking webhook updates `orders.status`.
3. **Phase C (only if demand):** international rates + customs fields → restore "worldwide" claim.

---

## 6. Phased Roadmap

### Phase 0 — Security + trust prerequisites (blocks everything public)
- [ ] Fix `mockups_view` cost-price leak (`security_invoker` or revoke anon)
- [ ] Rename `REACT_APP_SUPABASE_SERVICE_ROLE_KEY` (out of browser bundle)
- [ ] Fix `send-bill-sms` auth + CORS
- [ ] Remove fake reviews, fake newsletter success, dead About/Contact links, no-op wishlist icon, "worldwide" claim

### Phase 1 — Honest, complete brochure site + trust foundation
- [ ] About (w/ craftsmanship story), Contact (w/ store photos + map), 4 policy pages, 404 (needed for gateway application — file Razorpay/Shiprocket applications at the END of this phase; approval takes days)
- [ ] FAQ + Size guide pages
- [ ] WhatsApp chat button + business-legitimacy footer (name, address, GSTIN, phone)
- [ ] Home restructure per §2 (cut to 4–5 sections, real content, brand story replaces reviews)
- [ ] Newsletter → real table or cut
- [ ] SEO pass (helmet, JSON-LD, sitemap) + image/CLS pass
- [ ] Attribute normalization migration + admin combobox (`docs/ATTRIBUTE-NORMALIZATION-PLAN.md`) — gates filters below
- [ ] Shop refinements: sort, result count, skeletons, fabric-family + color-family filters (occasion cut — no data)
- [ ] PDP trust additions: delivery estimate, specs block (fabric/care), honest low-stock indicator

**Phase 1 content checklist (owner-supplied — likely the long pole, ahead of code):**
- [ ] One campaign/hero photo (real, seasonal)
- [ ] Brand story text: family, city, since-when
- [ ] Physical store photos (exterior + interior) for Contact/Visit page
- [ ] Registered business name, address, GSTIN, phone, email (footer + gateway application)
- [ ] Real policy terms: returns window (is 7-day real?), shipping charges, COD stance
- [ ] FAQ answers from actual customer questions (WhatsApp/in-person)
- [ ] Measurement/size guidance content
- [ ] Attribute classification CSV review (colors/fabrics → families, see normalization plan)

### Phase 2 — Checkout core
- [ ] `migration_storefront_orders.sql` (tables, RLS, orderref sequence, stock-decrement RPC)
- [ ] `/cart` page + cart revalidation (F4)
- [ ] `create-order`, `verify-payment`, `confirm-cod` edge functions
- [ ] `/checkout` UI + Razorpay integration + COD
- [ ] `/order/confirmed/:ref` (with webhook-race polling per §5.5), order confirmation WhatsApp/SMS
- [ ] `pg_cron` expiry job + rate-limit counter table (§5.5)
- [ ] Money-path tests: create-order validation, RPC concurrency, webhook idempotency (§5.5)
- [ ] Admin orders page with status transitions (stock-restore side effects per §5.5)

### Phase 3 — Shipping + post-purchase
- [ ] `/track` order lookup + status timeline
- [ ] Shiprocket manual ops → API integration (shipment create, AWB, tracking webhook)
- [ ] Pincode serviceability + delivery estimate on PDP/checkout
- [ ] Returns/exchange request flow (ties into existing `exchanges` machinery — design later)

### Phase 4 — Growth (post-launch, demand-driven)
- [ ] Search page (F1 full), wishlist (F2), collections pages, real reviews from verified orders, accounts (optional), analytics-driven iteration

**Sequencing note:** Phase 1 and Phase 2 backend (schema + edge functions) can proceed in parallel. Phase 2 cannot ship without Phase 0.

---

## 7. Open Questions (answer before Phase 2 build)
1. Razorpay account status — exists already, or fresh application? (Gateway approval is the long pole.)
2. COD at launch: yes/no? (Recommend yes with order-value cap, e.g. ≤₹10,000.)
3. Shipping charge policy: confirm flat rate + free-above-₹5,000 numbers, or per-weight?
4. ~~Do products carry fabric/work/occasion attributes in DB today?~~ **Answered 2026-07-07:** `products.fabric` is 100% populated (3598/3598) but holds 95 free-text values → fabric filter gated on normalization, designed in `docs/ATTRIBUTE-NORMALIZATION-PLAN.md`. No work/occasion columns exist anywhere → those filters need schema + data entry across 3,598 products; **cut from Phase 1**, revisit in Phase 4.
5. Returns window: 7-day claim in TrustBar — is that the real store policy?
6. Serviceable regions at launch: all-India, or exclude some pincodes?
