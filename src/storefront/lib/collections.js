// PLACEHOLDER collections — owner to curate slugs/titles/membership.
// A collection resolves by explicit productIds when given, else by categoryIds,
// and/or by variant sizes.
// Category ids come from the `categories` table (see /shop filters).

// Diwali 2026 (8 Nov): provisional 50 picked by TypeSafe Jev for festive wear
// from in-stock products with photos, balanced across categories
// (scripts/jev/diwali_shortlist.py, 2026-10-13). Owner swaps the list using
// tasks/diwali-pick-sheet.html. Order here is the display order.
const DIWALI_PRODUCT_IDS = [
  "BC252742", "BC252736", "BC25743", "BC252745", "BC252692", "BC253019",
  "BC252723", "BC252746", "BC252691", "BC252699", "BC252703", "BC252089",
  "BC252083", "BC251262", "BC251259", "BC252092", "BC253160", "BC251799",
  "BC252088", "BC251243", "BC251245", "BC252090", "BC252426", "BC251981",
  "BC25742", "BC251584", "BC252434", "BC251372", "BC251241", "BC252432",
  "BC251460", "BC252402", "BC251391", "BC25884", "BC252394", "BC25074",
  "BC251381", "BC25073", "BC25082", "BC251159", "BC251166", "BC25810",
  "BC25014", "BC251182", "BC25811", "BC251149", "BC251054", "BC251109",
  "BC25018", "BC25779",
];

export const COLLECTIONS = [
  {
    slug: "diwali",
    title: "Diwali Glam",
    subtitle: "Handpicked festive pieces for Diwali",
    productIds: DIWALI_PRODUCT_IDS,
  },
  // Header category pages. Raw categories are grouped into the few labels
  // shoppers look for (2026-10-13 meeting: fewer, cleaner categories).
  // "Suit (3 Pc)" is left out of Men: it mixes men's coat-pant suits with
  // women's kurta suits.
  { slug: "sarees", title: "Sarees", subtitle: "Handpicked sarees for every celebration", categoryIds: ["SA"] },
  { slug: "lehengas", title: "Lehengas", subtitle: "Festive and bridal lehengas", categoryIds: ["LE"] },
  { slug: "suits", title: "Suits", subtitle: "Suits and readymade suits", categoryIds: ["ST", "RMS"] },
  // "Short Kurta" (SK) is men's wear despite the name, so it sits under Men.
  { slug: "kurtis", title: "Kurtis", subtitle: "Everyday to festive kurtis", categoryIds: ["KUR"] },
  { slug: "gowns", title: "Gowns & Dresses", subtitle: "Gowns and dresses for every occasion", categoryIds: ["GWN", "DRS"] },
  {
    slug: "men",
    title: "Men",
    subtitle: "Sherwanis, kurtas, jackets, suits and shirts",
    categoryIds: ["SW", "KP", "SK", "NHJ", "IW", "SJ-2P", "S2P", "S5P", "BLZ", "SHT", "T-SHT", "FRMP", "PNT"],
  },
  { slug: "wedding", title: "Wedding", subtitle: "Lehengas & statement sarees", categoryIds: [] },
  { slug: "festive", title: "Festive", subtitle: "Bright, celebratory pieces", categoryIds: [] },
  // Owner ask (2026-10-20): everyday cord sets, shirts and kids' wear. Kurtis
  // are included because they are the main everyday women's piece; without
  // them the page is almost all men's shirts. Kids is pending: no kids'
  // products have photos yet. Kept after Kurtis and Men so those stay the
  // "More like this" group for kurtis and shirts (first match wins).
  {
    slug: "everyday",
    title: "Everyday",
    subtitle: "Cord sets, kurtis, shirts and tops for daily wear",
    categoryIds: ["CRD", "KUR", "SHT", "T-SHT", "TOP"],
  },
  // Men's home rails. Both are also in Men, which stays first above.
  { slug: "sherwani", title: "Sherwani", subtitle: "Sherwanis for weddings and celebrations", categoryIds: ["SW"] },
  { slug: "kurta-pajama", title: "Kurta Pajama", subtitle: "Kurta pajama sets for festive days", categoryIds: ["KP"] },
  // Owner ask (2026-10-22): every product stocked in 3XL and up, across all
  // categories. Codes from the `sizes` table, which stops at 7XL|54 today;
  // 8XL-10XL follow its +2in bust pattern so they match once created with
  // those exact codes.
  {
    slug: "plus-size",
    title: "Plus Size",
    subtitle: "Ethnic wear in 3XL and up",
    sizes: ["3XL|46", "4XL|48", "5XL|50", "6XL|52", "7XL|54", "8XL|56", "9XL|58", "10XL|60"],
  },
];

export function getCollection(slug) {
  return COLLECTIONS.find((c) => c.slug === slug) || null;
}
