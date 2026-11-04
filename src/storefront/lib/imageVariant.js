import { SITE_URL } from "../../seoRender/html";

// Pre-generated WebP widths stored beside every original in the `mockups`
// bucket as `{stem}_{w}.webp` (never upscaled). Serving these directly from
// Storage replaced Vercel Image Optimization, whose Hobby quota ran out.
const VARIANT_WIDTHS = [150, 600, 1200];
// The product page's main photo. The server's preload and the app must ask for this same file, or a phone
// downloads the photo twice.
export const PRODUCT_PHOTO_WIDTH = 1200;
const MOCKUP_FILE = /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/mockups\/(.+)$/;
const WEBP = /\.webp$/i;

// Storage sends `x-robots-tag: none` on every file, which keeps photos out of Google Images, so they are
// served through the site's domain (vercel.json), where the site sets its own rule. Always the full address:
// the same URL goes into structured data and sitemaps, and Google must see one URL per photo.
const IMAGE_BASE = `${SITE_URL}/images/`;

/**
 * Build a displayable URL for a product image, optionally swapped for its
 * pre-generated resized variant. The smallest variant at least as wide as the
 * requested `width` is chosen (the largest, 1200, when none is). URLs that are
 * not `.webp` files have no variants. URLs outside the public `mockups` bucket
 * are returned unchanged.
 * @param {string} url  full public image URL (as stored in productimages.imageurl)
 * @param {{width?:number}} [transform]
 * @returns {string|null}
 */
export function imageUrl(url, transform) {
  if (!url) return null;
  const file = MOCKUP_FILE.exec(url)?.[1];
  if (!file) return url;
  const served = IMAGE_BASE + file;
  if (!transform?.width || !WEBP.test(file)) return served;

  const width =
    VARIANT_WIDTHS.find((w) => w >= transform.width) ??
    VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
  return served.replace(WEBP, `_${width}.webp`);
}
