// Pre-generated WebP widths stored beside every original in the `mockups`
// bucket as `{stem}_{w}.webp` (never upscaled). Serving these directly from
// Storage replaced Vercel Image Optimization, whose Hobby quota ran out.
const VARIANT_WIDTHS = [150, 600, 1200];
const MOCKUP_WEBP = /^(https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/mockups\/.+)\.webp$/i;

/**
 * Build a displayable URL for a product image, optionally swapped for its
 * pre-generated resized variant. The smallest variant at least as wide as the
 * requested `width` is chosen (the largest, 1200, when none is). URLs that are
 * not `.webp` files in the public `mockups` bucket have no variants and are
 * returned unchanged.
 * @param {string} url  full public image URL (as stored in productimages.imageurl)
 * @param {{width?:number}} [transform]
 * @returns {string|null}
 */
export function imageUrl(url, transform) {
  if (!url) return null;
  if (!transform?.width) return url;
  const match = MOCKUP_WEBP.exec(url);
  if (!match) return url;

  const width =
    VARIANT_WIDTHS.find((w) => w >= transform.width) ??
    VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
  return `${match[1]}_${width}.webp`;
}
