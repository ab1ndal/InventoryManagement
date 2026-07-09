# Attribute Normalization Plan — Colors, Sizes, Fabric

**Date:** 2026-07-07
**Status:** Designed, not built. Gates the fabric/color-family filters in `docs/STOREFRONT-OVERHAUL-PLAN.md` Phase 1.
**Deliverable:** one `schema/migration_attribute_normalization.sql` + admin product-form combobox change.

All numbers in this doc were verified against the live DB on 2026-07-07 via `supabase db query --linked`.

> **Size decision update 2026-07-08 (v2) — supersedes the size-display design below.**
> Owner rule: the **stored size code IS the display value** — no render-time composition.
> Canonical codes: infant `S|0`/`M|0`/`L|0` (0–3/3–6/6–12 months); child `1`–`16` plain;
> Kurta-Pajama (Child) `n|n+20` for every size (`1|21` … `16|36`); adult `2XS|32`, `XS|34`,
> `S|36` … `7XL|54`; pants (Formal Pant/Jeans/Pant/Trousers) `28`–`44` plain waist;
> `FREE-SIZE`/`UNSTITCHED`/`SEMI-STITCHED` unchanged. Plain adult letters merge INTO the
> composite codes (reverse of §2.2's "merge into the letter code" direction), and the
> `sizes` lookup is reseeded wholesale. `sizes.csv` letter-code rows are superseded.
> Source of truth: `schema/migration_size_normalization.sql`. Dry-run against live data
> 2026-07-08: 5,848 renames, 0 merge collisions, 0 unmapped values.

---

## 1. Why Normalize At All

Three distinct problems, one root cause (free-text entry in admin forms):

1. **Duplicate spellings fragment inventory.** `Sky blue`, `Sky Blue`, `Sky_blue` are three different filter values and three different variant rows for what is one color. A storefront color filter built on raw values shows a 566-entry dropdown with visible duplicates — unusable and unprofessional.
2. **Filters need small vocabularies; PDPs need rich ones.** A customer filters by "Blue" (one of ~15 families) but buys "Firozi" (the trade name). Raw data conflates these two jobs in one column.
3. **Drift never stops on its own.** Every new product entry can mint a new spelling. Cleanup without an entry-side fix is a treadmill.

Why now: the storefront overhaul (Phase 1 shop refinements) needs fabric and color filters. Building them on raw values bakes the mess into the public UI.

---

## 2. Current State — Verified Data

### 2.1 Colors — 566 distinct values in `productsizecolors.color`

The mess is real but mechanical. Three corruption modes, all verified live:

| Mode | Real examples (spellings actually in DB) |
|---|---|
| Trailing whitespace | `Red` / `Red ` · `Brown` / `Brown ` · `Peach` / `Peach ` · `Fawn` / `Fawn ` · `Rust` / `Rust ` · `Cream` / `Cream ` |
| Case | `wine` / `Wine` · `purple` / `Purple` / `purple ` / `Purple ` · `lavender` / `Lavender` · `lemon` / `Lemon` · `pista` / `Pista` |
| Underscore vs space | `Sky blue` / `Sky Blue` / `Sky_blue` · `Off White` / `Off white ` / `Off_white` · `Sea green` / `Sea Green` / `sea green` / `Sea_green` · `Peacock green` / `Peacock Green` / `Peacock_green` / `Peacock_Green` · `Pista Green` / `Pista_green` |

Beyond spelling dupes, two semantic classes:

- **Indian trade names** — `Firozi` (226 rows), `Gazari` (180), `Fawn` (183), `Mehndi` (54), `Rama Green` (43), `Pista` (68). These are *correct data*, not mess. Customers know and search these names; they must survive normalization as display values.
- **Non-colors** — `Printed` (51 rows) describes a pattern, not a color. Needs an honest family (`Multi/Printed`), not a forced color assignment.

### 2.2 Sizes — 55 distinct values in `productsizecolors.size`

Much less mess; the real issue is **three sizing scales coexisting**, which is legitimate for an ethnic-wear store:

| Scale | Values (with live row counts) | What it sizes |
|---|---|---|
| Letter | XS (104) … XL (1398) … 6XL (15) | Stitched garments (kurtis, suits) |
| Numeric inches | 28 (16) … 36 (104) … 44 (34) | **Waist sizes** — jeans, pants, trousers (owner-confirmed 2026-07-08) |
| Kids | 2–16 (25–47 each) | Kids wear |
| Universal | FREE-SIZE (2967), UNSTITCHED (881) | Sarees, dress material |

Actual mess (fully enumerated 2026-07-07, worse than first pass suggested):

- Case dupes: `FREE-SIZE` (2967 rows) vs `Free-Size` (76) vs `free size` (1); `XXL`/`xxl`/`2xl` (8 rows) vs canonical `2XL`
- **Pipe values, two distinct kinds — both deliberate, neither an import bug** (8 distinct values, 76 rows, owner-explained 2026-07-08): `2XL|44`/`XL|42`/`L|40`/`M|38`/`S|36` = **dual labels** — the physical garment tag carries sometimes a letter, sometimes a number, so both were recorded → merge into the letter code; the number is preserved structurally in the lookup's `numeric_in` and every UI renders both ("XL (42)"), so either tag style still matches. `L|0`/`M|0`/`S|0` = **infant sizes (under 1 year)** → own codes (proposed `Infant S/M/L`, `size_type 'infant'`), never merged into adult letters
- Junk: `saree1`, `saree2`, `saree 3` (3 rows — presumably FREE-SIZE)
- Scale ambiguity: `36` and `12` mean different things on different scales (blouse-inch vs kids) — scale must be *recorded*, not inferred

The repo **already has a `sizes` lookup table** (`code, label, size_type, numeric_in, sort_order`) covering letter sizes with exactly the right shape — e.g. `M / Medium / letter / 38 / 30`. This plan extends it rather than inventing a new pattern.

### 2.3 Fabric — 95 distinct values in `products.fabric` (100% populated, 3598/3598)

Almost no spelling mess (one case dupe: `cotton` n=1 vs `Cotton` n=969). The 95 values are mostly **legitimate trade names** — `Director` (29) and `Jimmy Choo` (16) look like junk but are real Indian suiting/shimmer fabric names. The problem is the long tail: **29 fabrics have exactly 1 product** (`Dola Silk`, `Kora Zari`, `South Cotton`, `Butter Silk`, `Chanderi Georgette`, …). A filter listing 95 fabrics where a third match one product each is noise.

So fabric needs **grouping, not fixing**: every trade name maps to a family, filter shows ~12 families, PDP shows the trade name.

Blends (`Cotton Silk`, `Chanderi Georgette`, `Net Velvet`) get the family of their *dominant/customer-salient* material — a judgment call resolved in the owner-review step (§6), not by code.

### 2.4 Coverage check (2026-07-08) — where else these values live

Schema-wide sweep for color/size/fabric columns, reconciled against the CSVs:

- `productsizecolors`: 10,406 rows, **zero NULL/blank** color or size. CSV row counts reconcile exactly (colors 10,406; sizes 10,406; fabrics 3,598) — extraction is complete for the target tables.
- `stocktransactions.color/size` and `mockup_variations.color`: hold **no values outside** the `productsizecolors` set — covered automatically.
- `mockups_view`: view over products — no independent data.
- `manual_items.color/size` (billing manual line items): 16 distinct values not in the catalog set — multi-color snapshots ("Black, Blue", "Unk"), word sizes ("Large", "MEDIUM", "Free Size"), and **meter lengths for cut fabric** ("2.5 Meter", "5 m"). **Deliberately out of scope**: manual items are ad-hoc-by-design bill snapshots (fabric sold by the meter can't come from a size lookup), not catalog data. No FK, no cleanup. Documented so nobody "fixes" it later by mistake.

**No `work`/`occasion` columns exist anywhere.** Those attributes require schema addition + manual data entry across 3,598 products — out of scope here; deferred to overhaul plan Phase 4.

---

## 3. What a Migration Actually Touches — Risk Analysis

This is why the design is shaped the way it is. Verified FK map:

```
productsizecolors.variantid (uuid PK)
   ← bill_items.variantid          (billing history)
   ← stocktransactions.variantid   (stock ledger)
   ← cart_items.variant_id         (orphan table, zero repo refs — audit item)
```

**Critical fact: no FK references the text columns.** `color` and `size` are plain text on `productsizecolors`; `fabric` is plain text on `products`. All referential integrity hangs on `variantid`/`productid`, which normalization never changes.

Consequence — two very different risk classes:

| Operation | Rows | Touches FKs? | Risk |
|---|---|---|---|
| **Rename** (fix spelling in place): `UPDATE productsizecolors SET color='Sky Blue' WHERE color IN ('Sky blue','Sky_blue')` | ~thousands | No | Low — text-only update, `variantid` untouched, billing history unaffected |
| **Merge** (two variant rows become one after rename) | 2 groups under *mechanical* rules; **grows once owner approves semantic merges** (see below) | Yes | Contained — repoint 3 referencing tables, then delete loser row |

**Correction (2026-07-07, post-CSV):** the "2 groups" figure holds only for mechanical normalization (trim/case/underscore). The classification CSVs propose **semantic merges** too — misspellings (`Levender`→`Lavender`, `Mahroon`→`Maroon`, `Firogi`→`Firozi`), size aliases (`XXL`→`2XL`, `S|36`→`S`, `saree1`→`FREE-SIZE`). Each approved merge can create new `(productid, size, color)` collisions. Therefore the migration's merge step must be **data-driven** — loop over the approved mapping, detect collisions at run time, merge stock + repoint refs generically — not hardcoded to 2 known groups. Collision count gets re-verified after the owner-approved CSV is final.

The 2 colliding groups, in full (this is the entire merge workload):

| productid | size | spellings | stock | action |
|---|---|---|---|---|
| BC253028 | FREE-SIZE | `Red` (2.0) + `Red ` (1.0) | → `Red`, stock 3.0 | repoint loser's `bill_items`/`stocktransactions`/`cart_items` rows to survivor `variantid`, delete loser |
| BC25678 | M | `Yellow` (1.0) + `Yellow ` (0.0) | → `Yellow`, stock 1.0 | same |

Everything else in the color/size cleanup is a rename. That's the justification for doing cleanup **in place** rather than a parallel-table rebuild: the dangerous operation (merging variant identities) applies to 4 rows, not 12,000.

Additional verifications (2026-07-07):

- **`UNIQUE (productid, size, color)` confirmed** on `productsizecolors` (`unique_productid_size_color`) — merges must precede renames, as designed.
- **No triggers on `productsizecolors`** — the merge's stock `UPDATE` won't cascade ledger writes.
- **`bill_items` snapshots `product_name`/`product_code` only — no size/color text columns.** Size/color in bill history resolve through `variantid` join, so renames can't corrupt billing records; historical bills just display the cleaned spelling.
- **App-code string matching is tiny.** Grep across `src/` for hardcoded color/size values found only two sites: `src/utility/sortVariants.js` (already alias-tolerant: treats `FREE-SIZE`/`FREE SIZE`/`FREESIZE` as equal) and the drift source below.
- **Root cause of the `Free-Size` dupe found:** `src/admin/components/ProductEditDialog.js:529` — "Add Variant" for saree-category products presets `size: "Free-Size"`, minting the wrong casing on every new saree variant (76 rows and counting). Fix the literal to `FREE-SIZE` in Layer 3 (or it recreates the dupe the day after cleanup).

One more dependency class to check before running: **views**. `mockups_view` and any other view selecting these columns re-evaluate automatically (views store queries, not data), but a `pg_depend` check for anything filtering on specific literal values belongs in the migration checklist.

---

## 4. Design — Three Layers, Each Justified

### Layer 1 — One-time mechanical cleanup (in-place, single transaction)

Canonical spelling rule: trim → collapse internal whitespace → `_`→space → Title Case per word (sizes keep their existing uppercase convention: `FREE-SIZE`, `UNSTITCHED`, `XL`).

Worked examples:

| Before (live values) | After |
|---|---|
| `Sky blue`, `Sky Blue`, `Sky_blue` | `Sky Blue` |
| `Off White`, `Off white `, `Off_white` | `Off White` |
| `Peacock green`, `Peacock Green`, `Peacock_green`, `Peacock_Green` | `Peacock Green` |
| `purple`, `Purple`, `purple `, `Purple ` | `Purple` |
| `Free-Size` (76 rows) | `FREE-SIZE` |
| `cotton` (1 product) | `Cotton` |

Merge step (the 2 groups above) runs **before** renames inside the same transaction, so renames can't trip the `(productid, size, color)` uniqueness.

*Why in place, not a new column or parallel table:* renames don't touch FKs (§3), the merge surface is 4 rows, and every read path (admin, billing, storefront) keeps working mid-migration because values only get cleaner, never disappear.

### Layer 2 — Lookup tables (extend the existing `sizes` pattern)

```
colors   (code text PK, family text NOT NULL, hex text, sort_order int)
fabrics  (code text PK, family text NOT NULL, sort_order int)
sizes    (exists — backfill numeric/kids/infant/universal rows)
```

**Core idea: canonical name ≠ filter value.** `code` is the display/storage value (keeps trade names); `family` is the filter vocabulary.

Color mapping examples:

| code (display, stays on PDP) | family (filter) | hex (swatch) |
|---|---|---|
| Firozi | Blue | `#3FA8B8` (turquoise) |
| Gazari | Pink | `#F28C6B` (carrot pink) |
| Fawn | Brown/Beige | `#D9C2A6` |
| Mehndi | Green | `#7A8450` |
| Rama Green | Green | `#0F7F6E` |
| Wine | Maroon/Wine | `#722F37` |
| Printed | Multi/Printed | *(null — render multi-dot swatch)* |

Fabric mapping examples:

| code (display) | family (filter) |
|---|---|
| Banarasi Silk, Dola Silk, Paper Silk, Tussar Silk, Khadi Silk, Satin Silk | Silk |
| Metti Cotton, South Cotton, Jaam Cotton, Khadi Cotton, Rayon Cotton | Cotton |
| Sweety Chiffon, Foil Chiffon | Chiffon |
| Director, Tweed | Suiting/Wool |
| Jimmy Choo, Shimmer | Shimmer/Party |
| Cotton Silk, Chanderi Georgette *(blends)* | dominant material — owner call in review |

Target family counts: ~15 colors (Red, Pink, Orange, Yellow, Green, Blue, Purple, Brown/Beige, Black, White/Cream, Grey, Gold/Metallic, Maroon/Wine, Peach, Multi/Printed), ~12 fabrics.

**Size display rules** (why the `XL|42` merge loses nothing — the physical garment tag may say either "XL" or "42"):

| size_type | Stored code | Admin table / variant editor | Storefront size picker |
|---|---|---|---|
| letter | `XL` | `XL\|42` — composed from `code\|numeric_in` (owner-preferred pipe format, 2026-07-08) | Chip `XL\|42` |
| numeric | `36` | `36` (waist) | Chip `36` — **pants categories only** (Formal Pant/Jeans/Pant/Trousers), where the number is a waist size |
| kids_letter (infant) | `M\|0` | `M\|0` (code already pipe-style, matches lookup) | Chip `M\|0` |
| kids | `6` | `6 yrs` | Chip `6Y` |
| special | `FREE-SIZE` | `Free Size` (from `label`) | `Free Size` / `Unstitched` badge instead of picker chips |

Display is *composed at render time* from the lookup (`code` + `numeric_in`) — the pipe never returns to stored variant values, so the lookup CHECK (`code !~ '\|'`) and the dedup both hold while the UI shows the familiar `L\|40` everywhere, uniformly (including the 1,203 variants stored as plain `L` today).

Both conventions render together wherever a letter size appears — staff matching a physical "42" tag and a customer who knows "XL" both find it.

**Category-conditional rule for numeric sizes (owner decision 2026-07-08):** the same stored number means different things by garment:

- **Pants categories** (Formal Pant, Jeans, Pant, Trousers): number = waist → keeps numeric code, displays plain `36`.
- **Everywhere else** (Suit 3Pc, Shirt, Nehru Jacket, Cord Sets, Blazer, Jodhpuri…): number = chest → variant converts to the letter code (34→XS … 46→3XL) and displays composite `M|38`. 67 affected variants enumerated in `docs/normalization/sizes_category_splits.csv`. One unresolved: a single Blazer `32` — no letter maps to 32 (XS=34); owner picks XXS-addition or leave numeric.

This makes the migration's numeric renames **category-conditional** (UPDATE joins `products` on category), unlike letter/universal renames which are value-only.

Also owner-confirmed: **stitched sarees legitimately carry letter sizes** — the Saree-category `M`/`L` variants are real data, not errors; no fix.

Justified choices:

- **Text-code PKs, no surrogate keys.** `productsizecolors.color/size` and `products.fabric` keep their text values. A `color_id int` redesign would touch billing, admin inventory, and every storefront query for zero additional integrity — FKs on text codes enforce exactly the same thing.
- **`family` as a column, not a separate table.** ~15 values, no attributes of their own. A `families` table is premature abstraction (YAGNI); promote later if families ever need metadata.
- **`hex` on colors** enables swatch dots in the filter UI — concrete storefront payoff, one column.
- **Anon SELECT policy** on both tables (they feed public filters), same as other catalog tables in `migration_storefront_public_read.sql`.

### Layer 3 — Stop drift at entry (this is what makes cleanup stick)

> Expanded into its own detailed plan: `docs/ATTRIBUTE-ENTRY-CONTROLS-PLAN.md` (root causes, DB CHECKs, combobox UX, failure modes, deploy coupling). Summary below.

1. **Admin product form: free-text → combobox** backed by lookup tables. Adding a genuinely new color/fabric is an explicit "add new" action that inserts a lookup row (with family assignment) — a deliberate act, not a silent typo. Includes fixing the `"Free-Size"` preset literal at `ProductEditDialog.js:529` (verified live drift source).
2. **FKs, added safely:** `products.fabric → fabrics(code)`, `productsizecolors.color → colors(code)`, `productsizecolors.size → sizes(code)`. Added `NOT VALID` first (new writes checked, existing rows not scanned), then `VALIDATE CONSTRAINT` after verifying cleanup — so the migration can never fail halfway on a stray legacy row, and live admin writes never break.

*Ordering constraint:* combobox change and `VALIDATE` land together. FK without combobox = admin free-text entry starts throwing FK violations; combobox without FK = drift resumes through any other write path.

---

## 5. Populating the Maps

**Status: CSVs generated 2026-07-07, awaiting owner review — `docs/normalization/{colors,fabrics,sizes}.csv`.**

| File | Canonical entries | high | medium | REVIEW |
|---|---|---|---|---|
| `colors.csv` | 391 (from 566 raw / 442 post-mechanical) | 91 | 270 | 30 |
| `fabrics.csv` | 94 | 36 | 47 | 11 |
| `sizes.csv` | 39 (from 55 raw) | 18 | 15 | 6 |

How to review:

- **`canonical_name` / `canonical_code`** — proposed final value. Edit freely; rows sharing a canonical merge into one.
- **`family`** — proposed filter family (closed list). `medium` rows are mostly two-color combos filed under their first color — flip to `Multi/Printed` where the garment is genuinely two-tone.
- **Rows marked `REVIEW`** need a human call: unknown terms (`Melody`, `Oricletic`, `Lachka`, `Fendi`), non-colors in the color field (`Kurta Pajama`, `Cotton`, `Gwalior Boss/Combo`), guesses flagged as such (`Mus`→Mustard?, `Mahendra`→Mehndi?, `Peacock`→Green or Blue?), kids-size assumption (values 1–16), and every proposed semantic merge (`MERGE X -> Y (needs approval)` in notes).
- **`hex`** — approximate swatch colors, correct at will; only used for filter UI dots.

Reviewed CSVs become seed `INSERT`s in the migration file, and the final mapping drives the data-driven merge step (§3).

---

## 6. Rejected Alternatives

| Alternative | Why rejected |
|---|---|
| **Surrogate-key renormalization** (`color_id int` FK in variants) | Touches billing, admin, every read path. Text-code FKs give identical integrity with near-zero blast radius. |
| **View-only normalization** (leave raw data; clean in a storefront view) | Admin keeps seeing 566 colors; drift continues; every future feature pays the mess tax again. Symptom patch. |
| **Postgres `ENUM` types** | Adding a value needs DDL (`ALTER TYPE`), can't be done from the admin UI, and stores no family/hex metadata. Lookup tables strictly better here. |
| **Normalize-on-write trigger only, skip cleanup** | Stops new drift but leaves 566 legacy values; filters still broken. Both halves needed. |
| **Fuzzy/semantic dedup of trade names** (e.g. merge `Pista` into `Pista Green`) | Risky without store knowledge — some near-names are genuinely different stock. Only mechanical (whitespace/case/underscore) merges are automated; semantic merges happen in owner review, explicitly. |

---

## 7. Safety & Rollback

- **Single transaction** for merge + rename + lookup seed. Any failure = full rollback, DB untouched.
- **Backup tables first**, inside the migration: `create table _backup_psc_20260707 as select * from productsizecolors;` (likewise the 4 merge-affected rows from `bill_items`/`stocktransactions`). Cheap (~13k rows), makes value-level rollback a scripted `UPDATE … FROM backup`, dropped after a verification window.
- **Verification queries** run pre/post inside the migration: `sum(stock)` unchanged, `count(*) bill_items` unchanged, zero rows where `color <> btrim(color)` etc. — abort on mismatch (`RAISE EXCEPTION`).
- FKs go in `NOT VALID` → `VALIDATE` (§4 Layer 3) so the constraint step is separately revertible (`DROP CONSTRAINT`) without touching data.
- `cart_items` is a known orphan (audit item, slated for drop) — repoint its 0–few rows during merge anyway so the migration doesn't depend on the drop happening first.

---

## 8. Sequencing

1. Classification CSV → **owner review** (human gate)
2. `schema/migration_attribute_normalization.sql`: backups → merges (2 groups) → renames → lookup tables + seeds → `NOT VALID` FKs → verification checks
3. Admin form combobox change → `VALIDATE CONSTRAINT` (same deploy)
4. Storefront filters read families from `colors`/`fabrics` (overhaul plan Phase 1 shop refinements)
