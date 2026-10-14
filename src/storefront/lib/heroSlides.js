// Home page hero slides, shown in this order.
//
// Each image is either { productid } (the product's first photo, resolved at
// runtime) or { url } (a static file, e.g. "/hero/diwali.jpg" in /public).
// Several images render side by side on a gold/cream backdrop on desktop
// (the interim look, built from the best Diwali product photos); a slide with
// a single image renders it full-bleed, which is what a lifestyle photo wants.
// Mobile always shows the first image. Swapping in lifestyle photos later is
// a config-only change: replace `images` with [{ url }].
export const HERO_SLIDES = [
  {
    id: "diwali",
    eyebrow: "Diwali 2026",
    headline: "The Diwali Edit",
    subline: "Handpicked festive pieces for the season of lights.",
    cta: "Shop the edit",
    href: "/collections/diwali",
    images: [{ productid: "BC252742" }, { productid: "BC25743" }, { productid: "BC251262" }],
  },
  {
    id: "sarees",
    eyebrow: "Silk · Georgette · Net",
    headline: "Sarees for every celebration",
    subline: "Rich weaves and festive reds, curated with care.",
    cta: "Shop sarees",
    href: "/collections/sarees",
    images: [{ productid: "BC252089" }, { productid: "BC251584" }, { productid: "BC252090" }],
  },
  {
    id: "lehengas",
    eyebrow: "For the big nights",
    headline: "Lehengas & gowns",
    subline: "Statement silhouettes, handpicked with love.",
    cta: "Shop lehengas",
    href: "/collections/lehengas",
    images: [{ productid: "BC252736" }, { productid: "BC251460" }, { productid: "BC252745" }],
  },
  {
    id: "mens-festive",
    eyebrow: "Menswear",
    headline: "Men's festive",
    subline: "Sherwanis and kurta pajamas for pujas, weddings and everything between.",
    cta: "Shop menswear",
    href: "/collections/men",
    images: [{ productid: "BC251259" }, { productid: "BC25810" }, { productid: "BC251243" }],
  },
];
