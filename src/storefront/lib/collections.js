// PLACEHOLDER collections — owner to curate slugs/titles/membership.
// A collection resolves by explicit productIds when given, else by categoryIds.
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
    title: "Diwali Edit",
    subtitle: "Handpicked festive pieces for Diwali",
    productIds: DIWALI_PRODUCT_IDS,
  },
  { slug: "wedding", title: "Wedding", subtitle: "Lehengas & statement sarees", categoryIds: [] },
  { slug: "festive", title: "Festive", subtitle: "Bright, celebratory pieces", categoryIds: [] },
  { slug: "everyday", title: "Everyday", subtitle: "Easy, elegant daily wear", categoryIds: [] },
];

export function getCollection(slug) {
  return COLLECTIONS.find((c) => c.slug === slug) || null;
}
