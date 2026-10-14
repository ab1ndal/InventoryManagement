// Storefront chrome content (promo line + header nav), kept here so seasonal
// copy can be swapped without touching layout code.

// Rotating promo line. Each message is plain text, or a link via `to`
// (internal route) or `href` (external URL). Add a discount message only once
// the owner confirms real terms.
export const PROMO_MESSAGES = [
  { text: "Free shipping on orders above ₹5,000" },
  { text: "Diwali Edit is live — shop festive picks", to: "/collections/diwali" },
  { text: "WhatsApp us for help & custom fitting", href: "https://wa.me/919810873280" },
];

// Desktop category row and mobile drawer. `highlight` marks the seasonal tab.
// Category links point at /shop until the shop page accepts URL filters.
export const NAV_LINKS = [
  { label: "Diwali Edit", to: "/collections/diwali", highlight: true },
  { label: "Sarees", to: "/shop" },
  { label: "Lehengas", to: "/shop" },
  { label: "Suits", to: "/shop" },
  { label: "Kurtis", to: "/shop" },
  { label: "Gowns", to: "/shop" },
  { label: "Men", to: "/shop" },
  { label: "Shop All", to: "/shop" },
];

// Extra links shown only in the mobile drawer (desktop reaches them via footer).
export const DRAWER_LINKS = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];
