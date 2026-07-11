import { supabase } from "lib/supabaseClient";

// Product images are indexed in the public-readable `productimages` table:
// one row per image with `imageurl` (a full public URL into the `mockups`
// storage bucket), `displayorder` (sequence) and `productcolor`. We query the
// table per product and cache the resolved URLs, ordered by `displayorder`.
// The `producturl` column on `products` holds dead Google Drive links and is
// NOT a usable image source.

// productid -> Promise<string[]> of full image URLs, in displayorder.
// Cached so a product rendered in multiple places is queried only once.
const cache = new Map();

async function resolve(productid) {
  const { data, error } = await supabase
    .from("productimages")
    .select("imageurl,displayorder")
    .eq("productid", productid)
    .order("displayorder", { ascending: true });

  if (error || !data) return [];
  return data.map((r) => r.imageurl).filter(Boolean);
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
