import { supabase } from "lib/supabaseClient";

// Product images live in the public `mockups` storage bucket, one folder per
// productid: `mockups/{productid}/{arbitrary-filename}.{png|jpg|webp}`.
// Filenames are not derivable from the productid, so we list the folder once
// and cache the resolved object paths. The `producturl` column holds Google
// Drive folder links and is NOT a usable image source.

const BUCKET = "mockups";
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif)$/i;

// productid -> Promise<string[]> of object paths ("BC25013/lavender.png").
// Cached so a product rendered in multiple places lists the folder only once.
const cache = new Map();

async function resolve(productid) {
  const { data, error } = await supabase.storage.from(BUCKET).list(productid, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  });

  if (error || !data || data.length === 0) return [];

  // Real image files only (skip folder placeholders / non-image objects).
  return data
    .filter((o) => o.id && IMAGE_RE.test(o.name))
    .map((o) => `${productid}/${o.name}`);
}

/**
 * Build a public URL for a storage object path, optionally resized + re-encoded
 * (WebP/AVIF) via Vercel Image Optimization (`/_vercel/image`). Any requested
 * `width`/`quality` must be whitelisted in `vercel.json` `images.sizes`/
 * `qualities`. In dev (`npm start`) the `/_vercel/image` endpoint does not
 * exist, so the raw original is served instead.
 * @param {string} path  object path, e.g. "BC25013/lavender.png"
 * @param {{width?:number,quality?:number}} [transform]
 * @returns {string|null}
 */
export function imageUrl(path, transform) {
  if (!path) return null;
  const raw = supabase.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl ?? null;
  if (!raw || !transform) return raw;
  // No /_vercel/image endpoint under CRA's dev server — serve the original.
  if (process.env.NODE_ENV !== "production") return raw;

  const params = new URLSearchParams({ url: raw });
  if (transform.width) params.set("w", String(transform.width));
  params.set("q", String(transform.quality ?? 75));
  return `/_vercel/image?${params.toString()}`;
}

/**
 * Resolve ALL image object paths for a product, in folder order.
 * @param {string} productid
 * @returns {Promise<string[]>}
 */
export function getProductImagePaths(productid) {
  if (!productid) return Promise.resolve([]);
  if (!cache.has(productid)) {
    cache.set(
      productid,
      resolve(productid).catch(() => [])
    );
  }
  return cache.get(productid);
}

/**
 * Resolve ALL image URLs for a product (optionally transformed).
 * @param {string} productid
 * @param {object} [transform]  see imageUrl()
 * @returns {Promise<string[]>}
 */
export function getProductImages(productid, transform) {
  return getProductImagePaths(productid).then((paths) =>
    paths.map((p) => imageUrl(p, transform)).filter(Boolean)
  );
}

/**
 * Resolve a product's primary (first) image URL. Null when none exist.
 * @param {string} productid
 * @param {object} [transform]  see imageUrl()
 * @returns {Promise<string|null>}
 */
export function getProductImageUrl(productid, transform) {
  return getProductImages(productid, transform).then((urls) => urls[0] ?? null);
}
