// The home page's product rails. The app (HomePage) and the server HTML (seoRender) both read
// these, so the products a crawler is shown are the ones a shopper sees.
export const RAIL_SIZE = 12;

// Category shortcuts and the hero come first, then these rails of the newest products.
// `maxPrice` (inclusive) limits a rail to a price range; its "View all" opens the
// collection with the same filter (?max=).
// Kurta pajamas and sarees under ₹2,000 lead: together they are ~44% of shop sales,
// and most of those sales are under ₹2,000 (bills Apr-Nov 2026, owner OK 2026-11-09).
export const CATEGORY_RAILS = [
  { slug: "kurta-pajama", title: "Kurta Pajama under ₹2,000", maxPrice: 1999 },
  { slug: "sarees", title: "Sarees under ₹2,000", maxPrice: 1999 },
  { slug: "lehengas", title: "Lehengas" },
  { slug: "kurtis", title: "Kurtis" },
  { slug: "everyday", title: "Everyday" },
  { slug: "sherwani", title: "Sherwani" },
];

export function railHref({ slug, maxPrice }) {
  return maxPrice ? `/collections/${slug}?max=${maxPrice}` : `/collections/${slug}`;
}
