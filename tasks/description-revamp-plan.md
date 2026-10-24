# Product description revamp + tags

Written 2026-10-19. Status: spec agreed with owner, pilot not yet run.
Related: `tasks/storefront-revamp-plan.md` (Phase 4), `tasks/future-jev-catalogue-tagging.md`,
`tasks/diwali-description-drafts.md` (needs a re-pass under these rules).

## Findings (787 live products, 2026-10-19)

- Lengths: 4 empty, 123 ≤25 chars (mostly pure repetition), 392 26–80 (best: real details, typos),
  110 81–200, 158 >200 (AI photo captions). 172 contain `**` markdown.
- Failures: repeat name/category/fabric; describe the photo ("folded saree", "strapless blouse");
  colours contradict variants (BC252378, BC252681); almost none say what is in the set,
  dupatta fabric, stitched/unstitched, weight, care.
- PDP already shows: name (= fabric + category), category, price, fabric, colours, sizes, product
  code, size guide, delivery, exchange, WhatsApp. The description must not repeat these.
- Storefront images (`productimages`, `mockups` bucket) are AI mockups. Original photos are in each
  product's Google Drive folder (`products.producturl`), readable through mockup-generator's
  `drive_client` (service account `GOOGLE_DRIVE_SA_JSON`).
- Andaaz (researched 2026-10-19): one global "Style" list mixing silhouette, length, weave, craft
  and occasion; up to 9 occasions per item; values not limited per category. Worth copying: per-piece
  fabric/work, a Package row, Festival as its own field, colour family vs shade.

## Owner decisions (2026-10-19)

1. "Includes" (pieces, stitched/unstitched) goes in the description text now as a fixed
   `Includes:` line; moved to a structured field later.
2. Unknown facts: infer from photos, Drive originals first, then mockups. If really unclear, keep
   the description light. Be descriptive about patterns and work that no other field covers.
3. Occasion/styling go in tags, not in the description.
4. Tag groups: Occasion (max 3), Work, Print/weave, Cut & fit (silhouette, length, neck, sleeve),
   Festival.
5. Storage: `tag_vocab` + `product_tags` tables (values limited per category, source + confidence).
6. Display, first release: all groups as PDP detail rows; shop filters for Occasion and Work only.
7. Vision: Codex CLI (`codex exec -i <img> --output-schema`). Smoke-tested on BC25077: works, about
   17k tokens and 30 s per product. Photo alone missed the mirror work the text mentions, so
   existing text facts are always kept.
   Second test (BC252714, 3 Drive originals + 1 mockup + current text + detailed prompt, script
   and prompt in the session scratchpad): 23 s, 22k tokens, caught the old "strapless blouse"
   error (it was the mannequin bust). It still wrote "unstitched blouse" in the description while
   listing stitching as uncertain, so the prompt must keep uncertain facts out of the text.
   Codex is logged in with ChatGPT (model gpt-5.6-sol, low effort), so usage counts against the
   ChatGPT plan, with no per-token bill. Drive download: run with mockup-generator's `.venv/bin/python`
   (the `poetry` launcher is broken: "Bad CPU type").
8. Scope: 20-product pilot for approval, then all 787 live products in approved batches.

## Description format

1. Lead line (required, 12–25 words): cut/silhouette plus work type and where it sits.
2. `Includes:` line (sets, sarees, lehengas): each piece, its fabric if it differs from the main
   fabric, stitched/unstitched when known.
3. Feel/fit (optional, only if known): weight, lining, sheerness, length.
4. `Care:` (optional).

15–60 words, plain text, one line break between parts. Empty is allowed when nothing beyond the
structured fields is known.

Never: variant colours, size, price, code, main fabric by itself, category word as the subject,
photo words (folded, mannequin, "this is a"), markdown, supplier names/codes, occasion, more than
one bit of praise, guessed facts. Accent colours of the work ("coral and gold border") are allowed.

Sources, in order: existing description facts > Drive original photos > mockups. If a photo
contradicts the text, flag it for review instead of choosing.

## Schema (draft, to be confirmed against live schema)

- `tag_vocab(tag_group, value, slug, applies_to text[] of categoryid, sort_order)`
- `product_tags(productid, tag_group, value, source 'codex'|'manual', confidence, created_at)`,
  PK `(productid, tag_group, value)`, FK to vocab. Anon read RLS matching the products policy.
- Auto-apply only when confidence is high; the rest goes to a review list.

## Pilot results (2026-10-19, 20 products, no DB writes)

Flow: Drive originals (up to 3, 1600px) + 1 mockup + current text → Codex Terra; products with
uncertain/conflict/low-confidence output (7 of 20) → Claude Sonnet second opinion via `claude -p`.
Terra: 74 s for 20 with 4 parallel, about 0.5% of the Plus 5-hour window each. Sonnet: about $0.18
usage-equivalent each. Review page: https://claude.ai/artifact/PDsnoPKgJFeqmaezwfLZga
- Mockups always show stitched garments; unstitched rule (originals only) fixed BC25077/BC25107.
- Size field already holds UNSTITCHED / FREE-SIZE: feed it to the prompt as fact.
- Terra misses: "Includes: kurti." on single pieces, omitted the blazer in BC25896's set, repeats
  "strapless blouse" (BC252714), over-tags festivals, free-text cut values.
- Sonnet catches multiple designs per product (BC252622) and shop text contradicted by photos
  (BC25008, BC25526).
- Gotcha: `codex exec` in background waits on stdin; always `< /dev/null`.

## Resume here (fresh session)

State on 2026-10-19: pilot done, waiting for owner feedback on the review page. No DB writes yet.

1. Read this file, then `scripts/describe/README.md` (how to run the pipeline).
2. Read the owner's per-product feedback from the pilot page
   https://claude.ai/artifact/PDsnoPKgJFeqmaezwfLZga: ArtifactData `list` on collection `feedback`.
   There is one doc per product ID: `{verdict: approve|change|reject, comment, proposed, updatedAt}`.
   Also check `ArtifactComments` for page-level comments. To republish an updated page, rebuild it
   with `scripts/describe/build_review.js`, then publish to that `url` (read it first), keeping
   `capabilities: {db: {}}` so the saved feedback survives.
   Working files (photos, outputs) are in `.describe-work/pilot/` (gitignored, local only). If they
   are missing, rebuild them with `prepare.sh tasks/description-pilot/list.txt .describe-work/pilot`.
   Pilot outputs are saved in `tasks/description-pilot/`: `list.txt` (20 IDs), `hard.txt` (7 IDs
   sent to Sonnet), `outputs/<id>/terra.json` and `sonnet.json`, and `summary.html` (the summary
   shown on the page).
3. Open owner questions: when shop text and photos disagree (BC25008, BC25526), flag for review
   or let the photo win? (Recommended: flag.) Does the owner want changes to any proposed copy?
4. Prompt fixes to make in `scripts/describe/prompt.md` before the next run:
   - pass the size field as fact (UNSTITCHED / FREE-SIZE);
   - no `Includes:` line for single pieces;
   - always list the main garment in a set (BC25896 left out the blazer);
   - festival only when clearly suited;
   - cut values from the fixed vocab once it is drafted.
5. Then: draft `tag_vocab` per category for owner review → re-run the pilot 20 to check the fixes
   → batches of about 150 of the 787 live products (list via the anon products query), each
   reviewed and approved before any DB write → migration for `tag_vocab` / `product_tags` →
   write approved descriptions and tags → PDP rows plus Occasion and Work filters.

## Next steps

- [ ] Draft the vocab per group and category for owner review.
- [ ] Pilot script: Drive originals + mockups + current text → Codex → review CSV/HTML (20 products
      across categories). No DB writes.
- [ ] Owner approves pilot → migration for the tag tables → batch run → PDP rows + 2 filters.

## Owner decisions (2026-10-24)

- Review page moved to https://claude.ai/artifact/PDsnoPKgJFeqmaezwfLZga (the old page was gone; rebuilt
  from `.describe-work/pilot` with `build_review.js`). Owner is now leaving per-product feedback there.
- Split by product: mockup-generator writes descriptions for NEW products at image approval (owner reviews
  each); this repo's batch reviews the existing ~787 live products. Both use `scripts/describe/prompt.md`
  and the "Description format" rules above.
- Marker columns approved: `products.description_source` (manual | ai | ai_reviewed) +
  `products.description_reviewed_at`. The batch skips ai_reviewed and manual rows; admin edits set manual.
  Migration not written yet; confirm which repo's session writes it.
- Text vs photo conflicts: flag for review, leave the fact out.
- Tags in both repos, only after the owner approves the `tag_vocab` draft.

## Round 2 (2026-10-24)

Owner round 1 feedback (3 comments, rules applied to all 20): "Package includes:" line; work tags = technique
only; no festival group ("festive" occasion instead); never mention stitching or blouse style (shop default:
blouse unstitched, skirt stitched); catalogue data wins over photos; old long/markdown descriptions are earlier
AI captions, so photos win over them. Prompt, schema and builder updated; outputs in
`tasks/description-pilot/round2/`. Review page: https://claude.ai/artifact/91aEH6y1TLRKchAFDrwCUS
(round 1 page with the original feedback stays at PDsnoPKgJFeqmaezwfLZga).
