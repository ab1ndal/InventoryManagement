/**
 * One-time backfill: convert every PNG referenced by the `productimages`
 * table into a WebP sitting alongside it in the same `mockups` bucket path,
 * then repoint that row's `imageurl` at the new `.webp`.
 *
 * The original PNG is NOT deleted — this is fully reversible (revert = point
 * `imageurl` back to `.png`, which still exists).
 *
 * Modes:
 *   node scripts/backfill-images-webp.mjs                 # dry run: list scope, no writes
 *   node scripts/backfill-images-webp.mjs --sample 1      # process N rows end-to-end (real writes)
 *   node scripts/backfill-images-webp.mjs --execute       # process ALL rows
 *
 * Idempotent: rows whose imageurl is already `.webp` are skipped, so it is
 * safe to re-run after a partial failure.
 *
 * Requires `sharp`. Set SHARP_PATH to the sharp install if not resolvable from
 * the repo (this is a throwaway script; sharp is intentionally not a project dep).
 */
import { createRequire } from "module";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const SHARP_PATH =
  process.env.SHARP_PATH ||
  "/private/tmp/claude-501/-Users-abindal-dev-BindalsCreation-retail-inventory/0c953bc6-2f32-4511-a18e-8af156d71ac5/scratchpad/node_modules/sharp";
const sharp = require(SHARP_PATH);

// --- config ---------------------------------------------------------------
const BUCKET = "mockups";
const MARKER = `/storage/v1/object/public/${BUCKET}/`;
const MAX_EDGE = 1600; // px, longest side; display max is 1000/1200
const QUALITY = 80;
const CONCURRENCY = 5;
const CACHE_CONTROL = "31536000"; // 1 year

// --- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const sampleIdx = args.indexOf("--sample");
const SAMPLE = sampleIdx >= 0 ? parseInt(args[sampleIdx + 1], 10) : null;
const DRY = !EXECUTE && SAMPLE === null;

// --- env -------------------------------------------------------------------
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SUPABASE_URL = env.REACT_APP_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- helpers ---------------------------------------------------------------
const mb = (n) => (n / 1e6).toFixed(2) + "MB";

// storage key (unencoded) for the bucket API, from a public imageurl
function keyFromUrl(url) {
  const raw = url.split(MARKER)[1];
  return raw ? decodeURIComponent(raw) : null;
}

async function processRow(row) {
  const key = keyFromUrl(row.imageurl);
  if (!key) throw new Error("cannot derive storage key");
  const webpKey = key.replace(/\.png$/i, ".webp");
  const webpUrl = row.imageurl.replace(/\.png$/i, ".webp");

  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(key);
  if (dlErr) throw new Error("download: " + dlErr.message);
  const srcBuf = Buffer.from(await blob.arrayBuffer());

  const webpBuf = await sharp(srcBuf)
    .rotate() // honor EXIF orientation before any resize
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  if (SAMPLE !== null || EXECUTE) {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(webpKey, webpBuf, {
        contentType: "image/webp",
        cacheControl: CACHE_CONTROL,
        upsert: true,
      });
    if (upErr) throw new Error("upload: " + upErr.message);

    const { error: dbErr } = await supabase
      .from("productimages")
      .update({ imageurl: webpUrl })
      .eq("imageid", row.imageid);
    if (dbErr) throw new Error("db update: " + dbErr.message);
  }

  return { srcBytes: srcBuf.length, webpBytes: webpBuf.length, webpUrl };
}

// bounded-concurrency map
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- main ------------------------------------------------------------------
(async () => {
  const { data: rows, error } = await supabase
    .from("productimages")
    .select("imageid,imageurl")
    .order("imageid", { ascending: true });
  if (error) {
    console.error("failed to read productimages:", error.message);
    process.exit(1);
  }

  const pending = rows.filter(
    (r) => r.imageurl.includes(MARKER) && /\.png$/i.test(r.imageurl)
  );
  const alreadyWebp = rows.filter((r) => /\.webp$/i.test(r.imageurl)).length;

  console.log(`productimages rows: ${rows.length}`);
  console.log(`  already .webp (skip): ${alreadyWebp}`);
  console.log(`  .png to convert:      ${pending.length}`);
  console.log(
    `mode: ${DRY ? "DRY RUN (no writes)" : SAMPLE !== null ? `SAMPLE ${SAMPLE} (real writes)` : "EXECUTE ALL (real writes)"}`
  );

  if (DRY) {
    console.log("\nsample mappings (first 5):");
    pending.slice(0, 5).forEach((r) =>
      console.log(
        "  " + keyFromUrl(r.imageurl) + "  ->  " + keyFromUrl(r.imageurl).replace(/\.png$/i, ".webp")
      )
    );
    console.log("\nno changes made. re-run with --sample 1 to test one, or --execute for all.");
    return;
  }

  const work = SAMPLE !== null ? pending.slice(0, SAMPLE) : pending;
  let done = 0,
    failed = 0,
    srcTotal = 0,
    webpTotal = 0;
  const failures = [];

  await mapLimit(work, CONCURRENCY, async (row) => {
    try {
      const r = await processRow(row);
      srcTotal += r.srcBytes;
      webpTotal += r.webpBytes;
      done++;
      if (done % 25 === 0 || SAMPLE !== null)
        console.log(
          `  [${done}/${work.length}] ${row.productid} ${mb(r.srcBytes)} -> ${mb(r.webpBytes)}  ${r.webpUrl.split(MARKER)[1]}`
        );
    } catch (e) {
      failed++;
      failures.push({ imageid: row.imageid, productid: row.productid, err: e.message });
    }
  });

  console.log(`\ndone: ${done}  failed: ${failed}`);
  if (srcTotal)
    console.log(
      `bytes: ${mb(srcTotal)} -> ${mb(webpTotal)}  (${((1 - webpTotal / srcTotal) * 100).toFixed(1)}% smaller)`
    );
  if (failures.length) {
    console.log("\nfailures:");
    failures.slice(0, 20).forEach((f) => console.log(`  ${f.productid} #${f.imageid}: ${f.err}`));
  }
})();
