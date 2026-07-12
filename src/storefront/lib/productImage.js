import { supabase } from "lib/supabaseClient";

// Product images are indexed in the public-readable `productimages` table:
// one row per image with `imageurl` (a full public URL into the `mockups`
// storage bucket), `displayorder` (sequence) and `productcolor`. Requests are
// batched per microtask into a single `in(...)` query and the resolved URLs
// are cached per product, ordered by `displayorder`. The `producturl` column
// on `products` holds dead Google Drive links and is NOT a usable image source.

// productid -> Promise<string[]> of full image URLs, in displayorder.
// Cached so a product rendered in multiple places is queried only once.
const cache = new Map();

// A grid renders one <ProductCard> per product, each asking for its images in
// its own effect. Querying per product is an N+1 flood: ~140 requests contend
// for the browser's 6-connections-per-host budget and stall the whole page on
// higher-latency links. Instead we batch: every productid requested within the
// same microtask is folded into a single `in(...)` query. Max ~1 query per tick
// regardless of grid size.
let pendingIds = [];
let pendingResolvers = new Map(); // productid -> resolve(string[])
let flushScheduled = false;

// Cap ids per request so the query URL can't grow unbounded on huge grids.
const BATCH_SIZE = 100;

async function fetchChunk(ids) {
  const grouped = new Map(ids.map((id) => [id, []]));
  const { data, error } = await supabase
    .from("productimages")
    .select("productid,imageurl,displayorder")
    .in("productid", ids)
    .order("productid", { ascending: true })
    .order("displayorder", { ascending: true });

  if (!error && data) {
    for (const row of data) {
      const bucket = grouped.get(row.productid);
      if (bucket && row.imageurl) bucket.push(row.imageurl);
    }
  }
  return grouped;
}

async function flush() {
  const ids = pendingIds;
  const resolvers = pendingResolvers;
  pendingIds = [];
  pendingResolvers = new Map();
  flushScheduled = false;

  try {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const grouped = await fetchChunk(chunk);
      for (const id of chunk) resolvers.get(id)(grouped.get(id) || []);
    }
  } catch {
    // Never leave a caller hanging: resolve everything still pending to [].
    for (const resolve of resolvers.values()) resolve([]);
  }
}

function resolve(productid) {
  return new Promise((res) => {
    pendingResolvers.set(productid, res);
    pendingIds.push(productid);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  });
}

/**
 * Build a displayable URL for a product image, optionally resized + re-encoded
 * (WebP/AVIF) via Vercel Image Optimization (`/_vercel/image`). Any requested
 * `width`/`quality` must be whitelisted in `vercel.json` `images.sizes`/
 * `qualities`. In dev (`npm start`) the `/_vercel/image` endpoint does not
 * exist, so the raw original URL is served instead.
 * @param {string} url  full public image URL (as stored in productimages.imageurl)
 * @param {{width?:number,quality?:number}} [transform]
 * @returns {string|null}
 */
export function imageUrl(url, transform) {
  if (!url) return null;
  if (!transform) return url;
  // No /_vercel/image endpoint under CRA's dev server — serve the original.
  if (process.env.NODE_ENV !== "production") return url;

  const params = new URLSearchParams({ url });
  if (transform.width) params.set("w", String(transform.width));
  params.set("q", String(transform.quality ?? 75));
  return `/_vercel/image?${params.toString()}`;
}

/**
 * Resolve ALL image URLs for a product, in displayorder.
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
