// PLACEHOLDER collections — owner to curate slugs/titles/membership.
// A collection resolves by explicit productIds when given, else by categoryIds.
// Category ids come from the `categories` table (see /shop filters).
export const COLLECTIONS = [
  { slug: "wedding", title: "Wedding", subtitle: "Lehengas & statement sarees", categoryIds: [] },
  { slug: "festive", title: "Festive", subtitle: "Bright, celebratory pieces", categoryIds: [] },
  { slug: "everyday", title: "Everyday", subtitle: "Easy, elegant daily wear", categoryIds: [] },
];

export function getCollection(slug) {
  return COLLECTIONS.find((c) => c.slug === slug) || null;
}
