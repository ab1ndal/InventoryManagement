# Name-based product addresses

Status: plan, 2026-11-22, hardened against live DB reads the same day. Waiting on owner approval.
Nothing built.

## Goal

Product pages move from `/product/BC253135` to `/product/golden-silk-saree-zari-border-k7x2`:
a readable name plus a short random ID. The BC code stops being a public way to find a product.
Owner decisions (2026-11-22): old `/product/BC...` links do not redirect; Google re-indexes the new ones.

Non-goals: changing BC codes, bills, admin screens, cart, wishlist or order records (they keep the BC
code internally). Anti-goal: any new address that can be turned back into a BC code (no plain hash).

## Facts from the live database (2026-11-22)

- 3,685 products; every `productid` is `BC` + digits (shortest BC25001, 7 characters). 862 are on the
  site (RLS: `retailprice > 0` and at least one `productimages` row, for both `anon` and `authenticated`).
- `products` has **column-level** SELECT grants: `anon` gets categoryid, description, display_title,
  fabric, name, productid, producturl, retailprice, unit_type. A new column is invisible to the
  storefront until granted.
- Every product has `display_title` (trigger `trg_zz_product_display_title`; falls back to the inventory
  name when there is no `title_detail`). 43 of the 862 live products have no detail: an old backlog
  (42 BC25 + BC26131, BC26171). New products get their detail when photographed in mockup-generator,
  which is also when they go live, so a new product's first address is normally its final one.
- `display_title` changes when: `title_detail`, name, fabric or category is edited, **or a colour
  variant is added or removed** (`trg_variant_display_title` on `productsizecolors`; the colour is in
  the title only when there is exactly one). Bill-screen "add variant" and CLI `stock add --new-variant`
  therefore change a live product's title and address.
- Live titles: no characters outside letters, digits, spaces and `, & ( ) / . ' -`. Longest 86
  characters; 405 are over 60.
- Triggers already on `products`: `trg_sync_product_name` (before), `trg_zz_product_display_title`
  (before), `trg_create_mockup_row` (after insert). `pgcrypto` is installed.
- Storefront RPCs (`get_shop_available_options`, `get_shop_filter_options`, `variant_availability`,
  order lookups) return filter options, stock or order lines, not product links. Only the REST product
  selects need the new column.

## How the address works

- `products.public_id text`: 5 characters from `abcdefghjkmnpqrstuvwxyz23456789` (no 0 o 1 l i),
  drawn from `gen_random_uuid()` bytes, never derived from the BC code, never changed. 31^5 = 28.6 million
  values. Set by a column DEFAULT `gen_product_public_id()` that loops until the value is unused, so
  every insert path (admin app, mockup-generator with the service key, CLI) gets one with no code change.
  Unique index; NOT NULL after backfill. Admin cannot edit it (no form field; grant select only).
- Address = `/product/<slug>-<public_id>`. Slug (owner rule 2026-11-22): `display_title` up to the
  first ` with ` (case-insensitive), lower-cased, `&` → `and`, apostrophes dropped, every other run of
  non-letters/digits → `-`, trimmed, then cut at the last `-` at or before 50 characters. Colour,
  fabric and type stay; the descriptive detail after "with" stays on the page only, so editing that
  detail usually leaves the address unchanged. Worked out in code each time, never stored.
  Example: "Off White Metti Cotton 5 Piece Suit with Contrast Piping and Double-Breasted Waistcoat" →
  `/product/off-white-metti-cotton-5-piece-suit-k7x2`.
  Empty slug (cannot happen today) → address is `/product/<public_id>`.
- Lookup: the last `-`-separated segment, lower-cased, must match `^[a-hj-km-np-z2-9]{5}$`, then
  `products?public_id=eq.<id>`. Slug part differs from the current one, or upper-case ID → 301 to the
  current address, keeping the query string. Unknown ID → 404.
- Old addresses: the whole segment matches `^bc\d{5,}$` (case-insensitive) → **410 Gone**. A public ID
  can never match: it is 5 characters, and BC codes have at least 5 digits after `BC`.
- Rejected: slug only (breaks on every title change, needs a redirect table, titles can repeat);
  keyed hash of the BC code (secret to manage; rotating it changes every address); plain hash
  (reversible: only a few hundred thousand possible codes).

## Phase 1: addresses (this change)

Database (owner runs prod DDL, per the existing rule):
1. `schema/migration_product_public_id.sql`: `gen_product_public_id()` (SECURITY INVOKER,
   `search_path = public`), add the column with the DEFAULT, backfill the 3,685 rows in the same
   migration, unique index, NOT NULL, `grant select (public_id) on products to anon, authenticated`.
   Dry run on prod with `db query` begin/rollback, then check inside the dry run:
   - `count(*) where public_id is null` = 0; `count(distinct public_id)` = 3,685;
   - none matches `^bc\d`; all match the 5-character pattern;
   - an insert with no `public_id` gets one; `display_title` and mockup triggers still fire.
   After the real run: a REST read with the anon key returns `public_id` for a live product.

Code (one PR, after the migration is live, because the code selects `public_id`):
2. `src/storefront/lib/productPath.js`: `productSlug(title)`, `productPath({ public_id, name })`,
   `parseProductParam(param)` → `{ kind: "id" | "legacy" | "invalid", publicId, slug }`. Shared by the
   storefront and `src/seoRender/`. Unit tests from real titles: the 86-character one, a title with no
   "with" over 50 characters, "With" in capitals, a word containing "with" (e.g. "Without"), `&`,
   apostrophes, brackets, a generic "Cotton Saree", an empty title, upper-case ID, `BC25001`,
   `bc253135`, junk. Also run the slug over all 862 live titles in a test script and eyeball the
   longest and shortest 20.
3. Storefront links use `productPath(...)`: `ProductCard.jsx:99`, `SearchOverlay.jsx:48`,
   `FreeShippingNudge.jsx:131`, `AllProductsPage.jsx:67`, `ProductDetailPage.jsx:312` (share URL).
   Every product select that feeds them adds `public_id` (cards, search, wishlist, more-like-this,
   free-shipping nudge, all-products).
4. `ProductDetailPage.jsx` and `useProduct`: look up by `public_id`; out-of-date slug →
   `navigate(current, { replace: true })`; legacy BC address → the not-found page.
5. Server render `src/seoRender/pages.js`: `productPage` follows the lookup rules above (200 / 301 /
   404 / 410); canonical URL, `og:url` and product links (lines 149, 160, 378, 427) use `productPath`;
   list selects (`LIST_FIELDS`) add `public_id`; JSON-LD `sku` (line 509) becomes `public_id`.
6. `src/seoRender/sitemap.js:27` and `feed.js:102` link to the new address. Feed `g:id` stays the BC
   code: it is the Merchant Center item key, never shown to shoppers; changing it would make all
   787 items new and send them back through review.
7. Audit (done 2026-11-22): no product address is built in `supabase/functions` (order emails pass the
   code as data) or in mockup-generator. Re-grep `/product/` across both repos just before the PR.
8. Tests: update `scripts/indexnow/indexnow.test.mjs` fixtures and the seoRender tests; add render tests
   for 200, 301 (stale slug, upper-case ID, query string kept), 404 and 410.

Rollout:
9. Check Merchant Center first: no feed approval mid-review (the full feed went in on 2026-11-14).
10. Migration on prod (owner) → merge the PR (Vercel deploys) → check in a real browser: card click,
    search result, wishlist, share link, `/product/BC253135` (410), a stale slug (301), page source and
    JSON-LD contain no BC code. Then add a test colour variant on a test product only if the owner
    wants the title-change path proven live; otherwise rely on the render tests.
11. Submit: IndexNow script, resubmit the sitemap in Search Console, refetch the Merchant feed.
12. Watch weekly for 4 weeks: Search Console indexed pages and impressions (baseline 2026-11-14:
    887 impressions / 26 clicks over 3 months), Merchant Center landing-page errors, 404s in Vercel logs.

Rollback: revert the PR. The `public_id` column is harmless left in place.

Known side effects, accepted:
- Merchant Center re-crawls all landing pages after the feed links change; items can sit in
  "pending" for a few days.
- GA4 and Search Console page reports split at the switch date. Compare by product, not page path.
- Ranking dips for a few weeks while Google drops the 410s and indexes the new addresses (owner
  accepted, 2026-11-22).
- Adding a colour variant to a live product changes its address once (301 from the old one).
- Product links already posted on WhatsApp/Instagram with `/product/BC...` stop working. Owner to list
  any that matter; we redirect only those.

## Phase 2: stop finding products by code (small, after Phase 1)

- Storefront search: drop the `productid.ilike` terms in the search query builder (`searchUtils`,
  tests at `src/storefront/__tests__/searchUtils.test.js:135`). Admin search is separate and unchanged.
- Check page text, image alt text and the cart/order pages for a printed BC code.

## Phase 3: image addresses (larger, separate decision)

Images are stored as `mockups/<BC code>/<colour>_<n>.webp` and served at `/images/<BC code>/...`
(e.g. `mockups/BC25054/mahroon_89462790.webp`), so the code is visible in every image address. Moving
them means: copy objects to `<public_id>/...`, update `productimages.imageurl`, change the naming
contract shared with mockup-generator and the backfill script, and accept Google Images re-indexing.
Decide after Phase 1 settles.

## Phase 4: public product data (not planned)

`productid` is in the anon column grant and is the key that cart, wishlist and orders use, so anyone
querying the API directly can still read it. Hiding it would mean re-keying those tables. Recorded so
the gap is known.
