# Attribute Entry Controls — Preventing Future Drift

**Date:** 2026-07-07
**Status:** SIZE implemented 2026-07-08 (combobox in `ProductEditDialog.js` sourced from `sizes` lookup; preset literal fixed; `authenticated read sizes` RLS policy added). Owner update 2026-07-08: sizes are NOT closed after all — deliberate add-new flow built per §2.2.2 (`AddSizeDialog.js`, any admin, requires size-type choice; `migration_sizes_admin_insert.sql` adds INSERT policy + `created_at`/`created_by` governance columns, §2.4 review query works). Color/fabric parts still PLAN ONLY — blocked on their normalization migrations (no `colors`/`fabrics` lookups yet).
**Companion to:** `docs/ATTRIBUTE-NORMALIZATION-PLAN.md` (one-time cleanup). This doc covers what stops the mess from coming back.

---

## 1. Verified Root Causes of Current Drift

Every one confirmed against live data/code on 2026-07-07 — these are the paths that minted 566 color values, 55 size values, 95 fabrics:

| # | Cause | Evidence |
|---|---|---|
| 1 | **Free-text inputs** for size/color in variant editor, fabric in product form | `src/admin/components/ProductEditDialog.js` variant rows; every case/underscore/trailing-space dupe |
| 2 | **Hardcoded wrong-case preset**: saree-category "Add Variant" injects `size: "Free-Size"` | `ProductEditDialog.js:529`; 76 live `Free-Size` rows vs canonical `FREE-SIZE` |
| 3 | **Free-text workarounds for missing structure**: no field existed for "the garment tag says 42, we file it as XL", so staff invented `XL\|42`; likewise `S\|0` for infant sizes | 8 pipe values, 76 rows — all deliberate (owner-explained 2026-07-08), not import bugs. Fix is structural: `numeric_in` on the lookup carries the tag number, `size_type 'infant'` carries infants — the workaround becomes unnecessary |
| 4 | **Zero DB-level constraints** on the text values — anything inserts | schema: `size`/`color`/`fabric` plain text, no CHECK, no FK |

Conclusion: UI-only fixes can't cover cause 3/4 (imports, scripts, future edge functions bypass the form). DB constraint is the backstop; UI is the ergonomics.

## 2. Design

### 2.1 DB layer — the enforcement backstop

1. **FKs to lookup tables** (from normalization plan Layer 3): `productsizecolors.color → colors(code)`, `productsizecolors.size → sizes(code)`, `products.fabric → fabrics(code)`. Added `NOT VALID`, then `VALIDATE CONSTRAINT` after cleanup verifies. Once valid, **every write path is covered** — admin UI, bulk imports, scripts, future edge functions. Cause 3 and 4 die here.
2. **Hygiene CHECKs on the lookup tables themselves** so lookups can't get dirty:
   ```sql
   CHECK (code = btrim(code) AND code <> '')          -- no padding, no empties
   CHECK (family IN (...))                             -- closed family list (colors/fabrics)
   ```
   (An earlier draft banned pipes in codes — dropped 2026-07-08: infant sizes are legitimately coded `S|0`/`M|0`/`L|0` in the `sizes` lookup. The FK already prevents free-text pipe concat; a lookup-controlled code containing a pipe is not drift.)
3. **No normalize-on-write trigger.** FK rejects unknown values outright; silently "fixing" input hides data-entry problems instead of surfacing them. Rejected as symptom-patching.

### 2.2 Admin UI layer — ergonomics

1. **Combobox replaces free text** for color + size (variant rows in `ProductEditDialog.js` and the add-product form) and fabric (product form). Shadcn `Command`/`Popover` primitives already in `src/components/ui/`. Sourced from `colors`/`sizes`/`fabrics` lookups (one fetch, cached per dialog open). Typeahead filters; exact-match highlighted. **Size typeahead must also match `numeric_in`**: garment tags on Cord Sets/Blazers/coats carry chest numbers (owner 2026-07-08) — staff typing "46" must be offered `3XL|46`, typing "42" must see both `XL|42` (letter) and `42` (waist), disambiguated by the displayed type. Otherwise staff fall back to guessing letters.
2. **"Add new" is deliberate, not accidental.** If typed value matches nothing, show "Add ‘X' as new color…" action → small inline form requiring **family** (select from closed list) and optional hex → inserts lookup row, then selects it. A typo now requires two intentional steps to become data, instead of zero.
3. **Fix the preset literal** `ProductEditDialog.js:529`: `"Free-Size"` → `"FREE-SIZE"`. One-line change, but mandatory in the same deploy as cleanup — otherwise every new saree variant recreates the dupe immediately.
4. **Trim on input** (`.trim()` before save) as belt-and-braces; FK would reject `'Red '` anyway since lookup holds `'Red'`.
5. **FK-violation UX**: Supabase error code `23503` on variant/product save maps to a readable toast ("‘Redd' is not a known color — add it from the color field"), not a raw Postgres message.

### 2.3 Import path

Any future bulk import (CSV upload, script) inherits FK enforcement automatically — invalid rows fail loudly. Import tooling should pre-validate against lookups and report unmatched values *before* inserting, but that's per-tool; the FK is the guarantee.

### 2.4 Governance

- `created_at` + `created_by` columns on `colors`/`fabrics` lookup rows (sizes closed — new size codes rare, superadmin-only if ever).
- Periodic review (monthly or per new-stock season): `SELECT * FROM colors WHERE created_at > now() - interval '30 days'` — catch junk additions early, reassign families. Cheap because additions are now rare and deliberate.
- **Who can add:** v1 = any admin (matches current trust model — admins already edit everything). Tighten to superadmin only if junk shows up in review. Not building role plumbing speculatively (YAGNI).

## 3. Failure Modes Considered

| Scenario | Handling |
|---|---|
| Two admins add same new color concurrently | PK on `code` — second insert fails, combobox refetches and selects existing row |
| Add-new succeeds but product save fails | Lookup row persists unused — harmless; visible in governance review |
| Lookup fetch fails in dialog | Combobox falls back to disabled state with retry — never silently degrades to free text |
| Value needed that offends CHECK (e.g. legit pipe?) | None known in domain; if ever real, migration edits the CHECK — deliberate, reviewed |

## 4. Ordering / Deploy Coupling

Same sequence as normalization plan §8 — the critical coupling:

1. Cleanup migration + lookup tables + `NOT VALID` FKs (DB)
2. **Same deploy:** combobox change + preset-literal fix (UI)
3. Then `VALIDATE CONSTRAINT`

FK live without combobox = admins hit save errors on every typo. Combobox live without FK = imports/scripts still leak. Both together or neither.

## 5. Files Touched (planned)

- `schema/migration_attribute_normalization.sql` — FKs + CHECKs land with the cleanup migration (one file, one review)
- `src/admin/components/ProductEditDialog.js` — variant size/color comboboxes, preset fix
- Product add form (same component or sibling — confirm exact file during build)
- Possibly one shared `AttributeCombobox` component in `src/admin/components/` if the three uses don't stay trivial

## 6. Out of Scope

- Storefront changes (reads only, unaffected)
- `work`/`occasion` attributes (no columns exist — separate future effort)
- Retroactive import tooling
