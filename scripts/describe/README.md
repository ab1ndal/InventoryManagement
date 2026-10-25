# Product description + tag pipeline

Rewrites storefront product descriptions and proposes tags from the real product photos.
Spec, owner decisions and pilot results: `tasks/description-revamp-plan.md`.
Nothing here writes to the database. Output is a review page for the owner to approve.

## Tag vocabulary

`tag_vocab.json` (owner-approved 2026-10-25) is the only source of allowed tag values, per category
family. `build_prompt.js` fills the prompt's `{TAGS}` block with the values for the product's
family, `schema.json` enums hold every value of each group, and `flag_hard.js` sends any value
outside the family to the second opinion. After changing the vocabulary, update the schema enums to
match (`node --test scripts/describe/tag_vocab.test.js` fails until they do) and tell the
mockup-generator session, which keeps copies of `prompt.md` and `schema.json`. No `maxItems` in the
schema: Claude structured outputs reject it.

## How it works

1. `prepare.sh <ids.txt> [work_dir]` builds the working set in `.describe-work/` (gitignored).
   For each product it saves:
   - public catalogue data, fetched with the anon key so purchase price never leaves the DB;
   - up to 3 original photos from the product's Google Drive folder (`products.producturl`),
     resized to 1600px;
   - one AI mockup from `productimages`;
   - 420px thumbnails for the review page.
2. `run_codex.sh <id> [model] [work_dir]` runs the first pass with the Codex CLI on
   `gpt-5.6-terra`. It sends the photos, `prompt.md` filled with the product's data
   (`build_prompt.js`), and `schema.json` as the required output shape. Result: `out_codex.json`.
3. `node flag_hard.js <ids.txt> <work_dir>` lists the products that need a second opinion: any
   uncertain or conflict entry, a work tag with confidence below 0.7, or a tag value the product's
   category family may not use. In the pilot this was
   about 1 in 3.
4. `run_claude.sh <id> [work_dir]` runs the second opinion with Claude Sonnet (`claude -p`). It
   gets the same prompt plus the first pass's flags. Result: `out_claude.json`.
5. `node build_review.js <work_dir> <ids.txt> <hard.txt> <out.html> [heading] [summary.html]`
   builds the before/after review page. For flagged products the page uses the Sonnet result.
   Publish it as a private claude.ai artifact for the owner.

Example batch (4 parallel Codex runs, 3 parallel Claude runs):

```bash
W=.describe-work; ids=$W/batch1.txt
scripts/describe/prepare.sh $ids $W
cat $ids | xargs -P 4 -I{} sh -c 'scripts/describe/run_codex.sh {} gpt-5.6-terra || echo FAIL {}'
node scripts/describe/flag_hard.js $ids $W > $W/batch1.hard.txt
cat $W/batch1.hard.txt | xargs -P 3 -I{} sh -c 'scripts/describe/run_claude.sh {} || echo FAIL {}'
node scripts/describe/build_review.js $W $ids $W/batch1.hard.txt $W/batch1-review.html "Descriptions: batch 1"
```

## Requirements and gotchas

- **Codex** must be logged in with ChatGPT (`codex login status`). It runs on the owner's Plus plan
  with no credits bought, so it stops at the usage limit rather than charging. Each product uses
  about 0.5% of the 5-hour window. `codex login status` and the `usage_codex.txt` file in each
  product folder show how much is left. The scripts unset `OPENAI_API_KEY` so a run never falls
  back to API billing.
- `codex exec` waits for stdin when run in the background. The scripts pass `< /dev/null`.
- **Claude** runs through Claude Code's claude.ai login, about $0.18 of usage per product. Only
  flagged products go to Claude.
- **Drive** downloads use mockup-generator's service account (`GOOGLE_DRIVE_SA_JSON` in its `.env`).
  The mockup-generator checkout is expected at `../mockup-generator`; set
  `MOCKUP_GENERATOR_DIR` if it is elsewhere. Its `poetry` launcher is broken on this machine
  ("Bad CPU type"), so `prepare.sh` calls `.venv/bin/python` directly.
- AI mockups always show a stitched, worn garment. `prompt.md` takes cut, neck, sleeve and stitched
  status from the originals only. Keep that rule.
