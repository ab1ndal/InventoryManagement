# Shop filter sidebar + filter correctness — design

Date: 2026-10-14. Owner approved design in session ("auto approve and implement").

## Goal
Andaaz-style left filter sidebar on `/shop` that keeps the product grid visible
while refining, and fix the two filter bugs the sidebar would expose.

## Root cause of the bugs (verified against live data as anon)
- `useShopFilters.js` fetched product IDs from `productsizecolors` with no paging.
  PostgREST caps responses at 1000 rows; anon sees 10,637 variant rows (all
  3,676 products, only 1,817 rows belong to the 787 image-backed products the
  shop shows). The ID list was truncated → product list short (Blue 158 vs 210,
  FREE-SIZE 141 vs 172) and availability computed from the same list → valid
  options greyed. "Fabric wrong" = fabric combined with size/colour (fabric
  mapping itself verified correct for all 14 families).
- Paging the rows instead fails: ~3.7k IDs in `.in()` → 39k-char URL → HTTP 400.

## Fix
- Product list: no ID lists. Filter variants inside PostgREST with an aliased
  inner embed: `match:productsizecolors!inner(productid)` + `.in("match.color")`
  / `.in("match.size")` (same-row semantics as before). Keep the plain
  `productsizecolors(stock)` embed for the Sold-out badge. Verified counts:
  Blue 210, Green 163, Blue+Silk 51, FREE-SIZE+Cotton 68, XL|42 219.
- Availability: new SECURITY INVOKER RPC `get_shop_available_options`
  (`schema/migration_shop_available_options_rpc.sql`, applied to prod
  2026-10-14). Returns distinct categories / fabric_codes / color_codes / sizes,
  each computed with all filters except its own dimension. Client expands
  families → codes for args and maps codes → families on return.
- Called once with no filters (base availability: hides options with no
  products, e.g. 37 empty kids/waist sizes) and debounced on filter change.
- Errors no longer swallowed: product load failure → inline message + Retry;
  availability failure → logged, nothing greyed (fails open).

## UI
- `lg`+: sticky left sidebar (~220px, own scroll) + grid (3 cols `lg`, 4 `xl`).
  Toolbar above grid: product count, active chips, Clear all, Sort.
- `< lg`: "Filters (n)" button → left drawer with the same sections, instant
  apply, footer "Show N products".
- Sections, all expanded, in order: Category, Price, Size, Colour, Fabric.
  Header shows "Clear" when the section is active. Lists > 8 → "View more".
- Price: presets Under ₹2,000 / ₹2,000–5,000 / ₹5,000–10,000 / Above ₹10,000
  (one active; highlighted when min/max equal the preset) + min/max inputs.
- Option hidden if absent from base availability; greyed + disabled if absent
  from current availability; selected options always clickable.
- Instant apply. Old dropdown bar / overlay panel removed.

## Out of scope
Category groups, size groups (`sizes.size_type` already has letter/waist/kids/
special for later), URL filters, size search, option counts. Pre-existing:
authenticated (logged-in customer) role has no read policy on products.

## Rejected
- One RPC for products+availability: cleaner but larger rewrite before Diwali.
- Client paging of variant rows: hits the URL limit.
