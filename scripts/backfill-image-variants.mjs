/**
 * Backfill fixed-width web variants for every WebP referenced by the
 * `productimages` table, so the storefront can serve images straight from
 * Supabase Storage instead of Vercel Image Optimization (whose Hobby quota of
 * 5,000 transformations/month the catalogue exhausts on its own).
 *
 * For `{stem}.webp` it writes `{stem}_150.webp`, `{stem}_600.webp` and
 * `{stem}_1200.webp` next to it: resized to that width, never enlarged, WebP
 * q80. The same naming is produced at publish time by mockup-generator and
 * consumed by `imageUrl()` in src/storefront/lib/productImage.js.
 *
 * Nothing existing is modified or deleted, and no DB rows change.
 *
 * Modes:
 *   node scripts/backfill-image-variants.mjs              # dry run: report rows missing variants, no writes
 *   node scripts/backfill-image-variants.mjs --sample 1   # process N rows end-to-end (real writes)
 *   node scripts/backfill-image-variants.mjs --execute    # process ALL rows missing variants
 *
 * Idempotent: a row is skipped when all three variants already exist, so the
 * dry run doubles as the post-backfill check (expect "missing: 0").
 *
 * Requires `sharp`. Set SHARP_PATH to the sharp install if not resolvable from
 * the repo (this is a throwaway script; sharp is intentionally not a project dep).
 */
import { createRequire } from "module";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || "sharp");

// --- config ---------------------------------------------------------------
const BUCKET = "mockups";
const MARKER = `/storage/v1/object/public/${BUCKET}/`;
const WIDTHS = [150, 600, 1200];
const QUALITY = 80;
const CONCURRENCY = 5;
const CACHE_CONTROL = "31536000"; // 1 year: variant keys are never rewritten

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
const kb = (n) => (n / 1024).toFixed(0) + "KB";

// storage key (unencoded) for the bucket API, from a public imageurl
function keyFromUrl(url) {
  const raw = url.split(MARKER)[1];
  return raw ? decodeURIComponent(raw) : null;
}

const variantKey = (key, w) => key.replace(/\.webp$/i, `_${w}.webp`);

// Object names per folder, listed once per folder (one folder per product).
const folderCache = new Map();
async function folderNames(folder) {
  if (!folderCache.has(folder)) {
    folderCache.set(
      folder,
      (async () => {
        const names = new Set();
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase.storage
            .from(BUCKET)
            .list(folder, { limit: 1000, offset });
          if (error) throw new Error(`list ${folder}: ${error.message}`);
          data.forEach((o) => names.add(`${folder}/${o.name}`));
          if (data.length < 1000) break;
        }
        return names;
      })()
    );
  }
  return folderCache.get(folder);
}

async function missingWidths(key) {
  const names = await folderNames(key.split("/").slice(0, -1).join("/"));
  return WIDTHS.filter((w) => !names.has(variantKey(key, w)));
}

async function processRow({ row, key, missing }) {
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(key);
  if (dlErr) throw new Error("download: " + dlErr.message);
  const srcBuf = Buffer.from(await blob.arrayBuffer());

  const out = {};
  for (const w of missing) {
    const buf = await sharp(srcBuf)
      .rotate() // honor EXIF orientation before any resize
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(variantKey(key, w), buf, {
        contentType: "image/webp",
        cacheControl: CACHE_CONTROL,
        upsert: true,
      });
    if (upErr) throw new Error(`upload ${w}: ${upErr.message}`);
    out[w] = buf.length;
  }
  return { srcBytes: srcBuf.length, out };
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
  // PostgREST silently caps each response at 1000 rows, so page explicitly.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("productimages")
      .select("imageid,imageurl")
      .order("imageid", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.error("failed to read productimages:", error.message);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const skipped = rows.filter(
    (r) => !(r.imageurl.includes(MARKER) && /\.webp$/i.test(r.imageurl))
  );
  const candidates = rows
    .filter((r) => !skipped.includes(r))
    .map((row) => ({ row, key: keyFromUrl(row.imageurl) }));

  const checked = await mapLimit(candidates, 10, async (c) => ({
    ...c,
    missing: await missingWidths(c.key),
  }));
  const pending = checked.filter((c) => c.missing.length > 0);

  console.log(
    `productimages rows: ${rows.length} | not a mockups .webp (served as-is): ${skipped.length} | missing variants: ${pending.length}`
  );
  skipped.forEach((r) => console.log(`  as-is: imageid=${r.imageid} ${r.imageurl}`));
  if (DRY) {
    pending.slice(0, 20).forEach((c) =>
      console.log(`  missing ${c.missing.join(",")}: imageid=${c.row.imageid} ${c.key}`)
    );
    if (pending.length > 20) console.log(`  … and ${pending.length - 20} more`);
    console.log("Dry run, no writes. Use --sample N or --execute.");
    return;
  }

  const work = SAMPLE !== null ? pending.slice(0, SAMPLE) : pending;
  const failures = [];
  let done = 0;
  let srcTotal = 0;
  const outTotal = Object.fromEntries(WIDTHS.map((w) => [w, 0]));
  await mapLimit(work, CONCURRENCY, async (c) => {
    try {
      const { srcBytes, out } = await processRow(c);
      srcTotal += srcBytes;
      Object.entries(out).forEach(([w, n]) => (outTotal[w] += n));
      done++;
      if (SAMPLE !== null || done % 50 === 0) {
        console.log(`  ${done}/${work.length} ${c.key} src ${kb(srcBytes)} -> ${Object.entries(out).map(([w, n]) => `${w}:${kb(n)}`).join(" ")}`);
      }
    } catch (e) {
      failures.push({ imageid: c.row.imageid, key: c.key, error: e.message });
    }
  });

  console.log(`done: ${done}/${work.length}, failed: ${failures.length}`);
  if (done) {
    console.log(
      `avg source ${kb(srcTotal / done)}; avg variants ${WIDTHS.map((w) => `${w}:${kb(outTotal[w] / done)}`).join(" ")}`
    );
  }
  failures.forEach((f) => console.log(`  FAILED imageid=${f.imageid} ${f.key}: ${f.error}`));
  if (failures.length) process.exit(1);
})();
