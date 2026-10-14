# Future phase: catalogue tagging with TypeSafe Jev

Written 2026-10-13. Status: ideas for a future phase, not scheduled.
Goal: Andaaz-style browsing (shop by occasion, work, style, seasonal collections)
using structured product data generated from existing descriptions.
Related: `tasks/storefront-revamp-plan.md` (Phase 4 structured details, Phase 5 seasonal collections).

Jev (`jev-latest`, `POST https://api.typesafe.ai/v1/systemone`, key `TYPESAFE_KEY` in `.env`)
answers typed questions about text: `choice` (pick one, with confidence), `noul` (yes/no
probability), `score` (rubric). **Text only: no images.** About 1,250 descriptions are
detailed captions written from the photos, so there is enough text to tag most products.
Only public fields are sent; never `purchaseprice`.

**Done: description review of all 3,676 products** (script: `scripts/jev/flag_descriptions.py`; the output CSV is
kept out of the repo because it contains supplier names). Three checks in order: safe, then meaningful, then adds new info.
- `fix-unsafe` 10 (none visible): **supplier names and design codes** in descriptions
  (Navkar Fashion, Hiya Fabrics, Orion-Fab Gwalior, "SKU D: 32019"). Clean before these products get images.
- `rewrite` 451 (121 visible): useful info, poorly written (typos, shorthand).
- `clear-nothing-new` 222 (36 visible): only repeats name/category/colour.
- `empty` 90 (4 visible). `keep` 2,903 (626 visible).
- Gap: Jev rated about 1,250 AI-caption-style descriptions ("This is a **blue ombré saree**...")
  as meaningful. They need markdown stripped and tone rewritten, but they are not flagged.

**Next uses, in order of value** (pilot on the curated 50, check by hand, then expand):
1. **Occasion tags** (one `noul` per tag): festive, wedding/bridal, party, daily/casual,
   office, loungewear. These drive Andaaz-style "Shop by Occasion" and the seasonal tab.
2. **Work/embellishment** (`noul` per type): embroidery, zari, sequin, mirror, chikankari,
   bandhej, print, plain. Shown as a detail row and a filter. Andaaz showed work types that
   weren't on the garment, so only auto-apply high-probability tags.
3. **Package contents** (`choice`): top only / top + bottom / 3-piece with dupatta / saree
   with blouse piece / unstitched fabric. Plus a "blouse unstitched" `noul`.
4. **Style** (`choice`): traditional / Indo-Western / contemporary / Western. This fixes
   "Indo-Western" currently being used as a category.
5. **Fabric backfill** (`choice` over the `fabrics` table) where `fabric` is empty but the
   description names one.
6. **Curation ranking** (`score`): how complete and attractive the listing is, combined
   with image count, to shortlist candidates for the curated 50.

**Not Jev:** mapping the 23 raw categories to customer-facing groups is a fixed lookup
table (`categories.display_group`). A model adds nothing there.

**Rules:** apply a tag automatically only when the model is confident (e.g. noul ≥ 0.85 or
choice confidence ≥ 0.8); send the rest to a review list. Store tags with
source = 'jev' and the confidence, so they can be told apart from hand-entered ones and
re-run. Exact schema (columns vs a `product_tags` table) to be decided at spec time.

## Open items before starting
- [ ] Clean the 10 `fix-unsafe` descriptions (supplier names/codes) before those products get images.
- [ ] Decide schema: nullable columns on `products` vs a `product_tags(productid, tag_type, tag, confidence, source)` table.
- [ ] Pick the curated 50 (pinned decision in the revamp plan) to pilot on.
