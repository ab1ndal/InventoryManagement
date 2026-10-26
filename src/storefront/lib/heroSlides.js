// Home page hero slides, shown in this order.
//
// Each image is either { productid } (the product's first photo, resolved at
// runtime) or { url } (a static file, e.g. "/hero/diwali-desktop.webp" in
// /public), optionally with a portrait { mobileUrl } served below md. Several
// images render side by side on a gold/cream backdrop on desktop; a slide
// with a single image renders it full-bleed, which is what a banner wants.
// Mobile shows the first image (its mobileUrl when given).
//
// The /hero banners are AI-generated with our real products as garment
// references (scripts/generate-hero-banners.mjs, 2026-10-22): desktop
// 2560x976 with the left 40% kept clear for the copy, mobile 1088x1360 with
// the bottom quarter clear.
export const HERO_SLIDES = [
  {
    id: "diwali",
    headline: "Diwali Glam",
    subline: "Handpicked festive pieces for the season of lights.",
    cta: "Discover the glam",
    href: "/collections/diwali",
    images: [{ url: "/hero/diwali-desktop.webp", mobileUrl: "/hero/diwali-mobile.webp" }],
  },
  // Second on purpose (owner 2026-10-25): made-to-order tailoring is a key
  // differentiator.
  {
    id: "customize",
    headline: "Seen a look you love?",
    subline: "Send us the photo. Our tailors will make it for you, in your size.",
    cta: "Get a quote",
    href: "/customize",
    images: [{ url: "/hero/customize-desktop.webp", mobileUrl: "/hero/customize-mobile.webp" }],
  },
  {
    id: "sarees",
    headline: "Sarees for every celebration",
    subline: "Silk, chiffon, georgette and cotton sarees for weddings, pujas and every day.",
    cta: "Shop sarees",
    href: "/collections/sarees",
    images: [{ url: "/hero/sarees-desktop.webp", mobileUrl: "/hero/sarees-mobile.webp" }],
  },
  {
    id: "lehengas",
    headline: "Lehengas & gowns",
    subline: "Bridal, festive and lighter lehengas for smaller functions.",
    cta: "Shop lehengas",
    href: "/collections/lehengas",
    images: [{ url: "/hero/lehengas-desktop.webp", mobileUrl: "/hero/lehengas-mobile.webp" }],
  },
  {
    id: "mens-festive",
    headline: "Men's festive",
    subline: "Sherwanis and kurta pajamas for pujas, weddings and everything between.",
    cta: "Shop menswear",
    href: "/collections/men",
    images: [{ url: "/hero/mens-festive-desktop.webp", mobileUrl: "/hero/mens-festive-mobile.webp" }],
  },
  {
    id: "plus-size",
    headline: "Plus size, 3XL and up",
    subline: "Festive suits, kurtis and jackets in sizes that fit beautifully.",
    cta: "Shop plus size",
    href: "/collections/plus-size",
    images: [{ url: "/hero/plus-size-desktop.webp", mobileUrl: "/hero/plus-size-mobile.webp" }],
  },
];
