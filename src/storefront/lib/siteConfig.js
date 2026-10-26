// Storefront chrome content (promo line + header nav), kept here so seasonal
// copy can be swapped without touching layout code.

// Rotating promo line. Each message is plain text, or a link via `to`
// (internal route) or `href` (external URL). Add a discount message only once
// the owner confirms real terms.
export const PROMO_MESSAGES = [
  { text: "Free shipping on orders above ₹5,000" },
  { text: "Diwali Glam is live — shop festive picks", to: "/collections/diwali" },
  { text: "Made to order: send us your design", to: "/customize" },
  { text: "Plus sizes up to 6XL — hard to find, stocked here" },
];

// Desktop category row and mobile drawer. `highlight` marks the seasonal tab.
// Category links open category collections (lib/collections.js).
export const NAV_LINKS = [
  { label: "Diwali Glam", to: "/collections/diwali", highlight: true },
  { label: "Sarees", to: "/collections/sarees" },
  { label: "Lehengas", to: "/collections/lehengas" },
  { label: "Suits", to: "/collections/suits" },
  { label: "Kurtis", to: "/collections/kurtis" },
  { label: "Gowns", to: "/collections/gowns" },
  { label: "Men", to: "/collections/men" },
  { label: "Custom Tailoring", to: "/customize" },
  { label: "Shop All", to: "/shop" },
];

// Extra links shown only in the mobile drawer (desktop reaches them via footer).
export const DRAWER_LINKS = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];
