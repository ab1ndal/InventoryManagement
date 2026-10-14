# Shop filter sidebar — plan

Spec: `docs/superpowers/specs/2026-10-14-shop-filter-sidebar-design.md`.
Branch `feat/shop-filter-sidebar`. Two parallel tracks (separate files), then integrate.

## Hook contract (`src/storefront/hooks/useShopFilters.js`) shared by both tracks
Existing return fields unchanged, plus:
- `availableOptions`: `{categories, colors, sizes, fabrics}` of `Set`s (colors/fabrics
  in family vocabulary) for current filters, or `null` (no filters / loading / failed → nothing greyed).
- `baseOptions`: same shape for no filters, or `null` until loaded / on failure (→ hide nothing).
- `error`: `null` or a user-facing string when the product query fails; `retry()` re-runs it.

## Track A — data (hook)
- [x] Migration file + apply (done in main loop, verified)
- [x] runQuery: aliased `!inner` embed, no ID lists; propagate error → `error` state, `retry`
- [x] Availability via `get_shop_available_options`; base call once after options load
- [x] Pure helpers exported + unit tested (args building, code→family mapping)
- [x] Fix stale "in-stock" comment on distinct_sizes

## Track B — UI
- [x] `lib/pricePresets.js` + test (preset list, `activePreset(min,max)`)
- [x] `components/shop/FilterSidebar.jsx` (sections, View more, hide/grey rules)
- [x] Mobile drawer + toolbar (count, chips, sort) + error/Retry state in `ShopPage.jsx`
- [x] Remove `FilterBar`, `AllFiltersPanel`, `FilterDropdown` if unused

## Integrate
- [x] Merge tracks, `CI=true npx react-scripts test --watchAll=false` vs 6-test baseline, `npm run build`
- [x] Playwright screenshots desktop 1440 + mobile 390 (dev server), filter clicks, counts match spec
- [x] PR → merge → live smoke test; update todo/memory
