// What each public URL means to a crawler: title, text, links and structured data.
// Content comes from the same modules the React pages use, so the two cannot drift apart.

import { COLLECTIONS, getCollection } from "../storefront/lib/collections";
import { NAV_LINKS, SHOP_ADDRESS } from "../storefront/lib/siteConfig";
import { imageUrl } from "../storefront/lib/imageVariant";
import { stripMarkdown } from "../storefront/lib/productText";
import { ABOUT } from "../storefront/pages/aboutContent";
import { CUSTOMIZE } from "../storefront/pages/customizeContent";
import { FAQ_ITEMS } from "../storefront/pages/faqContent";
import { MEASURE_INTRO, SIZE_CHART } from "../storefront/pages/sizeGuideContent";
import { PRIVACY, RETURNS, SHIPPING, TERMS } from "../storefront/pages/policies/policyContent";
import {
  ALL_PRODUCTS_DESCRIPTION,
  ALL_PRODUCTS_PAGE,
  ALL_PRODUCTS_TITLE,
} from "../storefront/pages/allProductsContent";
import { SITE_NAME, SITE_URL, esc } from "./html";

const LISTED_PRODUCTS = 48;
const PRODUCT_ID_RE = /^[A-Za-z0-9-]{1,40}$/;
const LIST_FIELDS = "productid,name:display_title,retailprice,productimages(imageurl,displayorder)";

// States only what /policies/returns says: 7 days from delivery, sent back at the customer's cost or
// brought to the shop.
const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "IN",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 7,
  returnMethod: ["https://schema.org/ReturnByMail", "https://schema.org/ReturnInStore"],
  returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
  merchantReturnLink: `${SITE_URL}/policies/returns`,
};

const STORE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "ClothingStore",
  "@id": `${SITE_URL}/#store`,
  name: SITE_NAME,
  legalName: "Bindals Creation",
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/logo512.png`,
  image: `${SITE_URL}/logo512.png`,
  telephone: "+919810873280",
  email: "bindalscreations@gmail.com",
  foundingDate: "2018",
  address: {
    "@type": "PostalAddress",
    streetAddress: "58 Sihani Gate Market, Near Durga Bhabhi Chowk",
    addressLocality: "Ghaziabad",
    addressRegion: "Uttar Pradesh",
    postalCode: "201001",
    addressCountry: "IN",
  },
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    opens: "10:00",
    closes: "20:30",
  },
  sameAs: ["https://instagram.com/bindals_creation_shop"],
  hasMerchantReturnPolicy: RETURN_POLICY,
};

const breadcrumbs = (...crumbs) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map(([name, path], i) => ({
    "@type": "ListItem",
    position: i + 1,
    name,
    item: `${SITE_URL}${path}`,
  })),
});

const paragraphs = (items) => items.map((text) => `<p>${esc(text)}</p>`).join("");
const link = (to, label) => `<a href="${esc(to)}">${esc(label)}</a>`;

function firstImage(product, width) {
  const images = [...(product.productimages || [])].sort(
    (a, b) => (a.displayorder ?? 0) - (b.displayorder ?? 0)
  );
  return images[0] ? imageUrl(images[0].imageurl, { width }) : null;
}

const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

function productList(products) {
  if (!products.length) return "";
  const cards = products.map((p) => {
    const src = firstImage(p, 150);
    const img = src ? `<img src="${esc(src)}" alt="${esc(p.name)}" width="150" loading="lazy"/>` : "";
    return `<li><a href="/product/${esc(p.productid)}">${img}${esc(p.name)}</a> ${esc(rupees(p.retailprice))}</li>`;
  });
  return `<ul>${cards.join("")}</ul>`;
}

const itemList = (products) => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: products.map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE_URL}/product/${p.productid}`,
    name: p.name,
  })),
});

// Plain links and facts on every page: crawlers that skip JS find the rest of the site from here.
function frame(main) {
  const nav = NAV_LINKS.map((l) => link(l.to, l.label)).join(" · ");
  const more = [
    ["/about", "About"],
    ["/contact", "Contact"],
    ["/faq", "FAQ"],
    ["/size-guide", "Size guide"],
    ["/all-products", ALL_PRODUCTS_TITLE],
    ["/policies/shipping", "Shipping"],
    ["/policies/returns", "Returns"],
  ]
    .map(([to, label]) => link(to, label))
    .join(" · ");
  return (
    `<div data-ssr-body style="max-width:72rem;margin:0 auto;padding:1rem;font-family:sans-serif">` +
    `<header>${link("/", SITE_NAME)}<nav>${nav}</nav></header>` +
    `<main>${main}</main>` +
    `<footer><p>${more}</p><p>${esc(SHOP_ADDRESS)} · +91 98108 73280 · 10 AM–8:30 PM, closed Tuesdays</p></footer>` +
    `</div>`
  );
}

// seoTitle: some pages name themselves differently in the tab than in the heading. Matches the app.
const staticPage = (path, title, description, main, jsonLd = [], seoTitle = title) => ({
  status: 200,
  title: seoTitle,
  description,
  canonical: path,
  bodyHtml: frame(`<h1>${esc(title)}</h1>${main}`),
  jsonLd,
});

const policyPage = (path, title, description, sections) =>
  staticPage(
    path,
    title,
    description,
    sections.map((s) => `<h2>${esc(s.heading)}</h2>${paragraphs(s.body)}`).join("")
  );

const STATIC_PAGES = {
  "/faq": () =>
    staticPage(
      "/faq",
      "Frequently Asked Questions",
      "Answers to common questions about delivery, exchanges, payments, sizing, and visiting Bindal's Creation.",
      FAQ_ITEMS.map((f) => `<h2>${esc(f.q)}</h2><p>${esc(f.a)}</p>`).join(""),
      [
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_ITEMS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        },
      ],
      "FAQ"
    ),
  "/about": () =>
    staticPage(
      "/about",
      ABOUT.title,
      "The story behind Bindal's Creation, a family-run ethnic wear shop in Ghaziabad.",
      `<p>${esc(ABOUT.lede)}</p>${paragraphs(ABOUT.story)}<h2>${esc(ABOUT.craftsmanship.title)}</h2>${paragraphs(ABOUT.craftsmanship.body)}`,
      [STORE_JSON_LD],
      "About"
    ),
  "/customize": () =>
    staticPage(
      "/customize",
      CUSTOMIZE.title,
      "Seen a lehenga, saree or sherwani you love? Send us the photo and our in-house tailors in Ghaziabad will make it in your size. Get a quote on WhatsApp.",
      `<p>${esc(CUSTOMIZE.lede)}</p><p>${esc(CUSTOMIZE.pitch)}</p>` +
        CUSTOMIZE.makes.map((m) => `<h2>${esc(m.group)}</h2><p>${esc(m.items.join(", "))}</p>`).join("") +
        `<h2>How it works</h2><ol>${CUSTOMIZE.steps.map((s) => `<li>${esc(s.title)}: ${esc(s.desc)}</li>`).join("")}</ol>` +
        `<ul>${CUSTOMIZE.facts.map((f) => `<li>${esc(f.value)}: ${esc(f.label)}</li>`).join("")}</ul>`,
      [],
      "Custom Tailoring"
    ),
  "/contact": () =>
    staticPage(
      "/contact",
      "Visit Us",
      "Visit Bindal's Creation at 58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad. Call or WhatsApp us 10 AM–8:30 PM (closed Tuesdays).",
      `<p>${esc(SHOP_ADDRESS)}</p><p><a href="tel:+919810873280">+91 98108 73280</a></p><p><a href="mailto:bindalscreations@gmail.com">bindalscreations@gmail.com</a></p>`,
      [STORE_JSON_LD],
      "Contact & Store"
    ),
  "/size-guide": () =>
    staticPage(
      "/size-guide",
      "Size Guide",
      "How to measure and choose the right size at Bindal's Creation. Unsure? Message us on WhatsApp.",
      paragraphs(MEASURE_INTRO) +
        `<table><thead><tr><th>Size</th><th>Bust (inches)</th></tr></thead><tbody>${SIZE_CHART.map(
          (s) => `<tr><td>${esc(s.size)}</td><td>${esc(s.bust)}</td></tr>`
        ).join("")}</tbody></table>`
    ),
  "/policies/shipping": () =>
    policyPage("/policies/shipping", "Shipping Policy", "How and when Bindal's Creation dispatches and delivers orders.", SHIPPING),
  "/policies/returns": () =>
    policyPage(
      "/policies/returns",
      "Returns & Exchange",
      "Returns within 7 days of delivery, damaged or wrong items within 48 hours, and 7-day in-store exchange.",
      RETURNS
    ),
  "/policies/privacy": () =>
    policyPage("/policies/privacy", "Privacy Policy", "How Bindal's Creation handles your personal information.", PRIVACY),
  "/policies/terms": () =>
    policyPage("/policies/terms", "Terms of Service", "The terms governing use of the Bindal's Creation website and orders.", TERMS),
  "/collections": () =>
    staticPage(
      "/collections",
      "Collections",
      "Browse Bindal's Creation collections: sarees, lehengas, suits, kurtis, gowns and men's ethnic wear.",
      `<ul>${COLLECTIONS.map((c) => `<li>${link(`/collections/${c.slug}`, c.title)}${c.subtitle ? `: ${esc(c.subtitle)}` : ""}</li>`).join("")}</ul>`
    ),
};

export const STATIC_PATHS = Object.keys(STATIC_PAGES);

const NOT_FOUND = {
  status: 404,
  title: "Page not found",
  noindex: true,
  bodyHtml: frame(`<h1>Page not found</h1><p>${link("/shop", "Shop all products")}</p>`),
};

async function homePage(rest) {
  const products = await rest(
    `products?select=${LIST_FIELDS}&order=productid.desc&limit=${LISTED_PRODUCTS}`
  );
  const collections = COLLECTIONS.map((c) => `<li>${link(`/collections/${c.slug}`, c.title)}</li>`).join("");
  return {
    status: 200,
    description:
      "Handpicked sarees, lehengas, suits and sherwanis from Bindal's Creation in Ghaziabad. Seen a look you love? Our in-house tailors can make it for you.",
    canonical: "/",
    bodyHtml: frame(
      `<h1>Bindal's Creation: handpicked Indian ethnic wear and custom tailoring</h1>` +
        `<p>${esc(ABOUT.lede)}</p><ul>${collections}</ul>${productList(products)}`
    ),
    jsonLd: [
      STORE_JSON_LD,
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE_URL}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

async function shopPage(rest) {
  const products = await rest(
    `products?select=${LIST_FIELDS}&order=productid.desc&limit=${LISTED_PRODUCTS}`
  );
  return {
    status: 200,
    title: "Shop",
    description: "Browse our handpicked sarees, lehengas, suits, and ethnic wear.",
    canonical: "/shop",
    bodyHtml: frame(`<h1>Shop</h1>${productList(products)}`),
    jsonLd: [itemList(products)],
  };
}

async function allProductsPage(rest) {
  const products = [];
  for (let offset = 0; ; offset += ALL_PRODUCTS_PAGE) {
    const rows = await rest(
      `products?select=productid,name:display_title&order=productid.desc&limit=${ALL_PRODUCTS_PAGE}&offset=${offset}`
    );
    products.push(...rows);
    if (rows.length < ALL_PRODUCTS_PAGE) break;
  }
  const links = products
    .map((p) => `<li><a href="/product/${esc(encodeURIComponent(p.productid))}">${esc(p.name)}</a></li>`)
    .join("");
  return {
    status: 200,
    title: ALL_PRODUCTS_TITLE,
    description: ALL_PRODUCTS_DESCRIPTION,
    canonical: "/all-products",
    bodyHtml: frame(
      `<h1>${esc(ALL_PRODUCTS_TITLE)}</h1><p>${esc(ALL_PRODUCTS_DESCRIPTION)}</p><ul>${links}</ul>`
    ),
    jsonLd: [breadcrumbs(["Home", "/"], [ALL_PRODUCTS_TITLE, "/all-products"])],
  };
}

function collectionQuery(collection) {
  if (collection.productIds) return `select=${LIST_FIELDS}&productid=in.(${collection.productIds.join(",")})`;
  if (collection.categoryIds) return `select=${LIST_FIELDS}&categoryid=in.(${collection.categoryIds.join(",")})`;
  // Size lives on variant rows, so this matches them the way the shop page does. Codes hold "|".
  const sizes = collection.sizes.map((s) => `"${s}"`).join(",");
  return `select=${LIST_FIELDS},match:productsizecolors!inner(productid)&match.size=in.(${encodeURIComponent(sizes)})`;
}

async function collectionPage(slug, rest) {
  const collection = getCollection(slug);
  if (!collection) return NOT_FOUND;
  const path = `/collections/${slug}`;
  const products = await rest(`products?${collectionQuery(collection)}&order=productid.desc&limit=${LISTED_PRODUCTS}`);
  return {
    status: 200,
    title: collection.title,
    description: collection.subtitle,
    canonical: path,
    bodyHtml: frame(`<h1>${esc(collection.title)}</h1><p>${esc(collection.subtitle)}</p>${productList(products)}`),
    jsonLd: [
      breadcrumbs(["Home", "/"], ["Collections", "/collections"], [collection.title, path]),
      ...(products.length ? [itemList(products)] : []),
    ],
  };
}

async function productPage(id, rest) {
  if (!PRODUCT_ID_RE.test(id)) return NOT_FOUND;
  const rows = await rest(
    `products?productid=eq.${id}&select=productid,name:display_title,description,retailprice,fabric,` +
      `categories(name),productimages(imageurl,displayorder),productsizecolors(stock)`
  );
  const product = rows[0];
  if (!product) return NOT_FOUND;

  const path = `/product/${product.productid}`;
  const text = stripMarkdown(product.description);
  const category = product.categories?.name;
  const price = Number(product.retailprice);
  const inStock = (product.productsizecolors || []).some((v) => Number(v.stock) > 0);
  const image = firstImage(product, 1200);
  const fallback = `${product.name}${category ? ` — ${category}` : ""} · ${rupees(price)}`;
  const facts = [
    category && `Category: ${category}`,
    product.fabric && `Fabric: ${product.fabric}`,
    `Price: ${rupees(price)}`,
    inStock ? "In stock" : "Sold out",
  ].filter(Boolean);

  return {
    status: 200,
    title: product.name,
    description: text ? text.slice(0, 160) : fallback,
    canonical: path,
    type: "product",
    image,
    bodyHtml: frame(
      `<h1>${esc(product.name)}</h1>` +
        (image ? `<img src="${esc(firstImage(product, 600))}" alt="${esc(product.name)}" width="600"/>` : "") +
        `<ul>${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` +
        (text ? `<p>${esc(text)}</p>` : "")
    ),
    jsonLd: [
      breadcrumbs(["Home", "/"], ["Shop", "/shop"], [product.name, path]),
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        image: image ? [image] : undefined,
        description: text || fallback,
        sku: product.productid,
        category: category || undefined,
        material: product.fabric || undefined,
        brand: { "@type": "Brand", name: SITE_NAME },
        offers: {
          "@type": "Offer",
          url: `${SITE_URL}${path}`,
          price,
          priceCurrency: "INR",
          itemCondition: "https://schema.org/NewCondition",
          availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          seller: { "@id": `${SITE_URL}/#store` },
          hasMerchantReturnPolicy: RETURN_POLICY,
        },
      },
    ],
  };
}

// `rest(query)` runs a PostgREST query as the anonymous storefront, so RLS decides what is public.
// It throws on failure: an outage must not look like a missing page, which would drop it from Google.
export async function describePage(rawPath, rest) {
  const path = `/${rawPath}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
  if (path === "/") return homePage(rest);
  if (path === "/shop") return shopPage(rest);
  if (path === "/all-products") return allProductsPage(rest);
  if (STATIC_PAGES[path]) return STATIC_PAGES[path]();
  const collection = path.match(/^\/collections\/([^/]+)$/);
  if (collection) return collectionPage(collection[1], rest);
  const product = path.match(/^\/product\/([^/]+)$/);
  if (product) return productPage(product[1], rest);
  return NOT_FOUND;
}
