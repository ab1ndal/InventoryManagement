# Color Filter — Research & Design Decisions

**Date:** 2026-07-08
**Status:** Research complete; feeds the color section of `ATTRIBUTE-NORMALIZATION-PLAN.md`. No code yet.
**Why:** Colors is the last attribute to normalize (after sizes + fabric). Before writing the migration, we checked how established e-commerce stores and UX research handle color filtering, so the design isn't invented from scratch.

Colors is a harder problem than fabric: **566 raw values** with real spelling mess (trailing space / case / underscore dupes), plus Indian trade names (`Firozi`, `Gazari`, `Rama Green`) that are correct data, not errors, and must survive as display values.

---

## 1. What established stores and UX research do

**Map-many-to-few is the industry standard — as a lookup table, not free text.**
BigCommerce ships a first-class "color mapping" feature; Algolia calls the pattern "visual facets." The catalog stores a rich shade name; the filter shows a small vocabulary. This is exactly the `colors` lookup we already designed — the approach is validated, not novel.

**Storage: hex separate from the code beats embedding it.**
Algolia documents two options: embed `#000000||black` in a single pipe-delimited field, or keep hex separate and map on the frontend. The separate-column approach ("Approach 2") is explicitly the cleaner one — swatch colors can change without touching product data or reindexing. Our `colors.hex` column already follows this.

**Filter vocabulary = ~9–13 basic families.**
The standard set across stores: black, white, grey, brown/beige, red, orange, yellow, green, blue, purple, pink, plus metallic and a multi/printed catch-all. Teal folds into blue or green. More than ~13 filter options starts pushing content out of the viewport and hurts scannability (Baymard).

**Two-level filtering wins for rich catalogs — family, then shade.**
Baymard and Algolia both find users like to filter by a family ("Blue") and then optionally narrow to a specific shade, with multiselect. This maps directly onto our trade-name situation: the *family* is the filter, the *code* (Firozi, Gazari) is the drill-down shade. Our data supports both from day one because `code` is the shade; the drill-down UI can come later.

**Swatch UI specifics (Baymard):**
- Hit area ≥ 7mm (~16px+ on screen); ≥ 2mm spacing.
- Show ~4–10 swatches, then "show more" / horizontal scroll (mobile).
- A swatch is a hex dot **plus a text label** — never a dot alone.

**Accessibility is a hard requirement (WCAG), not a nice-to-have:**
- **1.1.1** — every swatch needs a text alternative: `aria-label="Color: Rama Green"`.
- **1.4.1** — the selected state cannot be conveyed by color alone; add a checkmark, thick border, or text so color-blind users see the selection.
- Color is never the sole signal — a visible text label accompanies every swatch.

**Multi / printed has no single hex** → render a multi-dot or gradient swatch; store `hex = null` and derive the dots from the color's families.

**Dynamic per-color thumbnails** (Baymard: 54% of sites fail this) — when a shopper filters by color, the product image ideally shows that color variant. **Out of scope for us**: products carry one mockup image, no per-color-variant photos. Noted for a future milestone.

---

## 2. Design decisions for our store

### 2.1 Composite colors map to MULTIPLE families (owner decision 2026-07-08)

A genuinely two-tone color like `Blue-Green` (or `Peacock`, `Rama Green`) should appear under **both** Blue and Green, so a shopper filtering either family sees the variant. This is many-to-many, so the filter dimension cannot be a single column.

**Data model:** `colors.families text[]` (array), not `family text`.

```
colors (
  code       text primary key,     -- display value / shade (Firozi, Blue-Green)
  families   text[] not null,      -- filter families, 1..n (['Blue'] or ['Blue','Green'])
  hex        text,                 -- swatch dot; null for multi/printed
  sort_order int  not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
)
```

- Single-family shade: `Firozi → {Blue}`.
- Two-tone: `Blue-Green → {Blue, Green}`, `Peacock Green → {Blue, Green}` (owner call per color).
- Printed/multi: `Printed → {Multi}` (or the specific families if known).

**Filtering (same client-side expand pattern fabric uses, array membership instead of equality):**
1. Load `colors` once; build `familyToCodes` — for each color, push its `code` under *every* family in `families`. A two-tone code lands in multiple family buckets.
2. User selects families → expand to the union of their codes → `.in("color", codes)`.
3. Availability: map each product color's `code` → its `families` (flatMap) → union into the available set.

A `Blue-Green` code is in both the Blue bucket and the Green bucket, so filtering either surfaces it — exactly the requested behavior, with no join and no server-side change.

**Swatch for a multi-family color:** if `hex` is null, render one dot per family using each family's representative hex (a 12-entry family→hex map we need anyway for the family swatches). So two-tones show a split/multi-dot swatch without storing multiple hexes per color.

**Why an array, not a junction table:** families have no attributes of their own and the set is tiny (~12). `text[]` with Postgres `= ANY(families)` gives the same query power with zero extra joins. A `color_families` junction table is premature normalization (YAGNI); promote later only if families gain metadata.

### 2.2 Family vocabulary — target ~12

Trim the earlier 15-family list toward the ~12 standard, keeping the splits that matter for Indian ethnicwear:

Red, Pink, Orange, Yellow, Green, Blue, Purple, Brown/Beige, Black, White/Cream, Grey, Maroon/Wine, Gold/Metallic, Multi/Printed.

Peach folds into Pink or Orange (owner call). Maroon/Wine and Gold/Metallic stay — both are high-volume, customer-salient families here.

### 2.3 Filter depth — family now, shade drill-down later

Ship family-only filtering first (matches fabric). The `code`-level shade drill-down (Baymard's second level) is a later enhancement; the data already supports it, so it's additive, not a rework.

### 2.4 Accessibility — specced in from day one

- `aria-label="Color: <code>"` on every swatch.
- Selected state uses a non-color indicator (checkmark / thick border) in addition to any color cue.
- Text label always visible next to the dot.

---

## 3. What carries over unchanged from the existing plan

- Lookup-table approach (`colors`), text-code PK, in-place mechanical cleanup, `NOT VALID → VALIDATE` FK, admin combobox + AddColorDialog entry control — all identical to the sizes/fabric pattern already shipped.
- The mechanical cleanup (trim / case / underscore → canonical spelling) and the data-driven semantic-merge step are unchanged; only the filter dimension changes from `family` (single) to `families` (array).

---

## Sources

- [Baymard — color & variation searches](https://baymard.com/blog/color-and-variation-searches)
- [Baymard — mobile interactive color swatches](https://baymard.com/blog/mobile-interactive-color-swatches)
- [Algolia — visual facets tutorial](https://www.algolia.com/doc/guides/solutions/ecommerce/filtering-and-navigation/tutorials/visual-facets)
- [BigCommerce — product filtering color mapping](https://support.bigcommerce.com/s/question/0D51300003eR3qUCAS/product-filtering-color-mapping)
- [Craftshift — accessibility for Shopify swatches (EAA 2025)](https://craftshift.com/shopify-european-accessibility-act-swatches/)
- [A11Y Collective — colour-blindness accessibility guidelines](https://www.a11y-collective.com/blog/color-blind-accessibility-guidelines/)
