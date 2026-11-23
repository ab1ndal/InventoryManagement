# Name-based Product Addresses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve product pages at `/product/<slug>-<public_id>` instead of `/product/<BC code>`.

**Architecture:** A random 5-character `products.public_id` (DB default) identifies the product in
the address; the slug is computed from `display_title` by one shared helper used by the storefront
(React) and the server renderer (`src/seoRender`, run by `api/render.js`). Old BC addresses answer
410; stale slugs answer 301.

**Tech Stack:** Postgres (Supabase), React 19 CRA storefront, Vercel function `api/render.js`, Jest.

**Spec:** `tasks/product-address-plan.md` (Phase 1 only). Read it first.

## Global Constraints

- Public ID alphabet `abcdefghjkmnpqrstuvwxyz23456789`, length 5, random (`gen_random_bytes`), never derived from `productid`, never updated.
- Slug: `display_title` up to the first ` with ` (case-insensitive, whole word), lower-case, `&` → `and`, apostrophes removed, other runs of non `[a-z0-9]` → `-`, trimmed of `-`, cut at the last `-` at or before 50 chars (a single word longer than 50 is cut at 50).
- Address `/product/<slug>-<id>`; empty slug → `/product/<id>`.
- Param parse: last `-` segment lower-cased matching `^[a-hj-km-np-z2-9]{5}$` → id. Whole param matching `/^bc\d{5,}$/i` → legacy (410). Anything else → invalid (404).
- Feed `g:id` stays `productid`. Bills, admin, cart, wishlist, orders unchanged.
- New column needs `grant select (public_id) on public.products to anon, authenticated` (column-level grants).
- Repo is public: no business reasons, customer data or tax wording in code comments or commits.
- Migration first, code second: code selects `public_id`.

## Review Focus

1. Client-side stale slug: `ProductDetailPage` replaces the URL once; it must not loop when the title changes during the visit or when the slug is empty. Test owned by Task 4.
2. A product hidden by RLS (no photos or price 0) opened by a valid ID → 404 / not-found page, never a crash. Tests in Tasks 3 and 4.
3. A title starting with "With" or with "with" inside a word ("Without", "Withered") → only the standalone word ` with ` splits. Test in Task 2.
4. Query string kept on 301 (`?utm_source=x&gclid=y`). Test in Task 3.
5. Any product select feeding `ProductCard` or a link that forgets `public_id` gives `/product/undefined`. `productPath` throws on a missing id, and Task 4 adds a grep check.

---

### Task 1: Database column, default, backfill, grant

**Files:**
- Create: `schema/migration_product_public_id.sql`
- Create: `schema/test_product_public_id.sql` (style of `schema/test_product_titles.sql`: `begin; do $$ ... assert ...; $$; rollback;` blocks)

**Interfaces:**
- Produces: column `public.products.public_id text not null unique default public.gen_product_public_id()`; function `public.gen_product_public_id() returns text` (SECURITY INVOKER, `set search_path = public`, loops until unused).

- [ ] **Step 1: Write tests** in `schema/test_product_public_id.sql`:
  - insert with no `public_id` → value matches `^[a-hj-km-np-z2-9]{5}$`;
  - 500 inserts → 500 distinct ids;
  - `public_id` never matches `^bc[0-9]`;
  - all pre-existing rows non-null after migration (`count(*) filter (where public_id is null) = 0`);
  - `has_column_privilege('anon', 'public.products', 'public_id', 'select')` is true; same for `authenticated`;
  - `display_title` still set on insert (trigger order unaffected).
- [ ] **Step 2: Run against the local test DB, expect failure** (`scripts/test-db.sh up`, `scripts/test-db.sh sql schema/test_product_public_id.sql`): fails, column missing.
- [ ] **Step 3: Write the migration**: function; `alter table add column public_id text`; backfill `update products set public_id = gen_product_public_id() where public_id is null` (row by row is fine for 3,685); `set default`; `set not null`; `create unique index products_public_id_key`; grant. Wrap in one transaction. Header comment: what and why (address ID, not derived from the code).
- [ ] **Step 4: Run migration then tests locally**, expect all asserts pass. Note: the local bootstrap may lack the other migrations; load what `schema/test_product_titles.sql`'s header says it needs.
- [ ] **Step 5: Commit** both files: `Add products.public_id for name-based product addresses`.

Main loop only (not a subagent): prod dry run with `supabase db query --linked` inside `begin; … rollback;`, running the migration plus the checks from the spec (null count 0, distinct = row count, none `^bc\d`, fresh insert gets one). Show the owner; owner runs the real migration.

### Task 2: `productPath` helper

**Files:**
- Create: `src/storefront/lib/productPath.js`
- Test: `src/storefront/__tests__/productPath.test.js`

**Interfaces:**
- Produces:
  - `productSlug(title: string | null) → string`
  - `productPath({ public_id: string, name: string | null }) → string` (throws `Error("productPath: missing public_id")` when `public_id` is falsy; `name` is the `display_title` alias the storefront already uses)
  - `parseProductParam(param: string) → { kind: "id", publicId: string, slug: string } | { kind: "legacy" } | { kind: "invalid" }`
  - `PUBLIC_ID_RE`, `LEGACY_CODE_RE` exported.

- [ ] **Step 1: Write tests** with real titles:
  - `productSlug("Off White Metti Cotton 5 Piece Suit with Contrast Piping and Double-Breasted Waistcoat")` → `"off-white-metti-cotton-5-piece-suit"`
  - `productSlug("Navy Blue Cotton Readymade Suit with Embroidered Neckline, Palazzo and Tie-Dye Dupatta")` → `"navy-blue-cotton-readymade-suit"`
  - `productSlug("Cotton Saree")` → `"cotton-saree"`
  - `productSlug("Black & Gold Silk Saree")` → `"black-and-gold-silk-saree"`
  - `productSlug("Men's Kurta WITH Jacket")` → `"mens-kurta"`
  - `productSlug("Withered Rose Georgette Saree")` → `"withered-rose-georgette-saree"`
  - `productSlug("With Love Printed Kurta")` → `""` (title starts with the word "with")
  - a 70-char title with no "with" → ≤ 50 chars, ends on a whole word, no trailing `-`
  - `productSlug(null)` and `productSlug("")` → `""`
  - `productPath({ public_id: "k7x2m", name: "Cotton Saree" })` → `"/product/cotton-saree-k7x2m"`; empty name → `"/product/k7x2m"`; missing id → throws
  - `parseProductParam("cotton-saree-k7x2m")` → `{ kind: "id", publicId: "k7x2m", slug: "cotton-saree" }`; `"K7X2M"` → id `k7x2m`, slug `""`; `"BC253135"` / `"bc25001"` → legacy; `"bc2501"` → invalid (4 digits); `"cotton-saree-k7x0m"` (has 0) → invalid; `""` → invalid.
- [ ] **Step 2: Run, expect fail**: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/productPath.test.js`
- [ ] **Step 3: Implement** in `src/storefront/lib/productPath.js` (plain ES module, no React imports, so `src/seoRender` can import it).
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit**: `Add product address helper`.

### Task 3: Server renderer, sitemap, feed

**Files:**
- Modify: `src/seoRender/pages.js` (`PRODUCT_ID_RE` line 42, `LIST_FIELDS` line 44, links at 149, 160, 378, product page at ~425, JSON-LD `sku` 509, `NOT_FOUND` ~294 add `GONE` status 410)
- Modify: `src/seoRender/handler.js` (pass `page.location` through; 301/410 use `CACHE_RENDERED`)
- Modify: `api/render.js` (set `Location` header when present)
- Modify: `src/seoRender/sitemap.js:27`, `src/seoRender/feed.js:102` (link only; `g:id` line 99 unchanged)
- Test: `src/seoRender/__tests__/render.test.js`, `feed.test.js`

**Interfaces:**
- Consumes: `productPath`, `parseProductParam` from Task 2.
- Produces: `describePage(path, rest)` may return `{ status: 301, location: string }` and `{ status: 410, ... }`; `renderResponse` returns `{ status, cacheControl, html, location? }`.

- [ ] **Step 1: Write tests** (fake `rest` as the existing tests do):
  - `/product/cotton-saree-k7x2m` with the product's current slug → 200, canonical `https://…/product/cotton-saree-k7x2m`, HTML contains no `BC` product code, JSON-LD `sku` = `k7x2m`;
  - `/product/old-name-k7x2m?utm_source=wa&gclid=1` → 301, `location` = `/product/cotton-saree-k7x2m?utm_source=wa&gclid=1`;
  - `/product/K7X2M` → 301 to the lower-case canonical;
  - `/product/BC253135` → 410; `/product/nope-zzzzz` with REST returning `[]` → 404 (covers RLS-hidden products);
  - list page links and sitemap `<loc>` use the new address; feed `<link>` new, `<g:id>` still the BC code.
- [ ] **Step 2: Run, expect fail**: `CI=true npx react-scripts test --watchAll=false src/seoRender`
- [ ] **Step 3: Implement.** Product lookup: `products?public_id=eq.<id>&select=public_id,productid,name:display_title,...`. Every select whose rows become links adds `public_id`. Check how `ssr_path` carries the query string (`api/render.js` reads `req.query`); keep the original query (minus `ssr_path`) on the 301.
- [ ] **Step 4: Run, expect pass**, plus the whole `src/seoRender` suite.
- [ ] **Step 5: Commit**: `Serve product pages by public ID in the server renderer`.

### Task 4: Storefront pages and links

**Files:**
- Modify: `src/storefront/hooks/useProduct.js` (look up by `public_id`, select `public_id`)
- Modify: `src/storefront/pages/ProductDetailPage.jsx` (route param → `parseProductParam`; legacy/invalid → existing not-found UI; stale slug → `navigate(productPath(p) + location.search, { replace: true })` once; share URL line 312 uses `productPath`)
- Modify links: `ProductCard.jsx:99`, `SearchOverlay.jsx:48`, `FreeShippingNudge.jsx:131`, `AllProductsPage.jsx:67`
- Modify selects whose rows reach those: `home/ProductRail.jsx` (`RAIL_PRODUCT_COLUMNS`), `FreeShippingNudge.jsx:16`, `AllProductsPage.jsx:16`, `hooks/useShopFilters.js` (both selects), `hooks/useProductSearch.js`, `product/MoreLikeThis.jsx`, `home/CategoryBand.jsx`, `WishlistPage.jsx`, `SearchResultsPage.jsx`, anything else `grep -rn 'from("products")' src/storefront` shows feeding a card
- Test: `src/storefront/__tests__/ProductDetailPage.test.jsx`, `useProduct.test.js`, existing card/rail tests

**Interfaces:**
- Consumes: Task 2 helpers. Route stays `product/:productid` in `src/App.js` (param name only; rename to `:slug` optional, not required).

- [ ] **Step 1: Write tests**: detail page with param `cotton-saree-k7x2m` queries `public_id = k7x2m`; stale slug calls `navigate` once with `replace: true` and keeps `?x=1`; same title on re-render does not navigate again; param `BC253135` shows not-found without querying; `ProductCard` link equals `productPath(product)`.
- [ ] **Step 2: Run, expect fail**: `CI=true npx react-scripts test --watchAll=false src/storefront`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.** Then the guard: `grep -rnE '/product/\$\{' src/storefront src/seoRender` returns nothing outside `productPath.js`.
- [ ] **Step 5: Commit**: `Link storefront product pages by name and public ID`.

### Task 5: IndexNow fixtures and full verification

**Files:**
- Modify: `scripts/indexnow/indexnow.test.mjs` fixtures (`/product/BC1` → a slug-id address)

- [ ] **Step 1: Update fixtures; run** `node --test scripts/indexnow/` → pass.
- [ ] **Step 2: Full suite** `CI=true npm test -- --watchAll=false` → all pass; `npm run build` → succeeds.
- [ ] **Step 3: Commit**: `Update IndexNow fixtures for product addresses`.

Main loop after Task 5: PR, owner runs the migration on prod, merge, browser checks and submissions per the spec's Rollout steps 9-12.
