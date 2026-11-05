import fs from "fs";
import path from "path";
import { CACHE_DEGRADED, CACHE_RENDERED, renderResponse } from "../handler";
import { renderHtml } from "../html";
import { describePage } from "../pages";
import { COLLECTIONS } from "../../storefront/lib/collections";
import { HERO_SLIDES } from "../../storefront/lib/heroSlides";
import { buildSitemap, sitemapResponse } from "../sitemap";

const shell = fs.readFileSync(path.join(__dirname, "../../../public/index.html"), "utf8");
const IMG = "https://x.supabase.co/storage/v1/object/public/mockups/BC1/a.webp";
const product = {
  productid: "BC1",
  name: "Silk Saree",
  description: "**Yellow** silk saree",
  retailprice: 2195,
  fabric: "Silk",
  categories: { name: "Saree" },
  productimages: [{ imageurl: IMG, displayorder: 0 }],
  productsizecolors: [{ stock: 0 }, { stock: 2 }],
};
const rest = (rows = [product]) => jest.fn(() => Promise.resolve(rows));
const ld = (page, type) => page.jsonLd.find((j) => j["@type"] === type);

describe("describePage", () => {
  test("the home page preloads the first hero slide, one file per device, matching the app's breakpoint", async () => {
    const html = renderHtml(shell, await describePage("", rest()));
    const { url, mobileUrl } = HERO_SLIDES[0].images[0];
    expect(html).toContain(`<link rel="preload" as="image" href="${mobileUrl}" media="(max-width: 767px)" fetchpriority="high"/>`);
    expect(html).toContain(`<link rel="preload" as="image" href="${url}" media="(min-width: 768px)" fetchpriority="high"/>`);
    expect(html.match(/rel="preload"/g)).toHaveLength(2);
  });

  test("a product preloads its first photo and its text copies stay lazy, so one file is downloaded", async () => {
    const images = [
      { imageurl: IMG, displayorder: 0 },
      { imageurl: IMG.replace("a.webp", "b.webp"), displayorder: 1 },
    ];
    const html = renderHtml(shell, await describePage("product/BC1", rest([{ ...product, productimages: images }])));
    const first = "https://www.bindalscreations.com/images/BC1/a_1200.webp";
    expect(html.match(/rel="preload"[^>]*>/g)).toEqual([
      `rel="preload" as="image" href="${first}" fetchpriority="high"/>`,
    ]);
    expect(html).toContain(`<img src="${first}"`);
    expect(html).not.toContain("_600.webp");
    const photos = html.match(/<img src="[^"]*BC1\/[^>]*>/g);
    expect(photos).toHaveLength(2);
    photos.forEach((tag) => expect(tag).toContain('loading="lazy"'));
  });

  test("a product with no photo preloads nothing", async () => {
    const html = renderHtml(shell, await describePage("product/BC1", rest([{ ...product, productimages: [] }])));
    expect(html).not.toContain('rel="preload"');
  });

  test("a product gives real text, an offer in rupees and a canonical URL", async () => {
    const page = await describePage("product/BC1", rest());
    expect(page.status).toBe(200);
    expect(page.canonical).toBe("/product/BC1");
    expect(page.bodyHtml).toContain("Yellow silk saree");
    expect(page.bodyHtml).toContain('href="/collections/sarees"');
    const offer = ld(page, "Product").offers;
    expect([offer.price, offer.priceCurrency, offer.availability]).toEqual([2195, "INR", "https://schema.org/InStock"]);
  });

  test("a product's offer and the store state the published return policy", async () => {
    const page = await describePage("product/BC1", rest());
    const policy = ld(page, "Product").offers.hasMerchantReturnPolicy;
    expect(policy.merchantReturnDays).toBe(7);
    expect(policy.returnFees).toBe("https://schema.org/ReturnFeesCustomerResponsibility");
    expect(policy.merchantReturnLink).toBe("https://www.bindalscreations.com/policies/returns");
    const contact = await describePage("contact", rest());
    expect(ld(contact, "ClothingStore").hasMerchantReturnPolicy).toEqual(policy);
  });

  test("all-products links every product, across pages of results", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ productid: `BC${i}`, name: `Piece ${i}` }));
    const q = jest
      .fn()
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ productid: "BC-last", name: "Last <Piece>" }]);
    const page = await describePage("all-products", q);
    expect([page.status, page.canonical]).toEqual([200, "/all-products"]);
    expect(page.bodyHtml).toContain('href="/product/BC0"');
    expect(page.bodyHtml).toContain('href="/product/BC-last"');
    expect(page.bodyHtml).toContain("Last &lt;Piece&gt;");
    expect(q).toHaveBeenCalledTimes(2);
    expect(q.mock.calls[1][0]).toContain("offset=1000");
  });

  test("a product with no stock says so", async () => {
    const page = await describePage("product/BC1", rest([{ ...product, productsizecolors: [{ stock: 0 }] }]));
    expect(ld(page, "Product").offers.availability).toBe("https://schema.org/OutOfStock");
    expect(page.bodyHtml).toContain("Sold out");
  });

  test.each(["product/NOPE", "collections/nope", "no-such-page", "product/a%2Cb", "product/a.b"])(
    "%s is a real 404, and noindex",
    async (p) => {
      const page = await describePage(p, rest([]));
      expect([page.status, page.noindex]).toEqual([404, true]);
    }
  );

  test("a malformed product id never reaches the database", async () => {
    const q = rest();
    await describePage("product/x&select=purchaseprice", q);
    expect(q).not.toHaveBeenCalled();
  });

  test("database text cannot inject markup", async () => {
    const page = await describePage("product/BC1", rest([{ ...product, name: "<script>alert(1)</script>" }]));
    expect(page.bodyHtml).not.toContain("<script>");
    const html = renderHtml(shell, page);
    expect(html).not.toContain("<script>alert(1)");
  });

  test("a thin description is built up from the product's facts, a long one cut at a word", async () => {
    const thin = await describePage("product/BC1", rest([{ ...product, description: "Yellow Green" }]));
    expect(thin.description).toBe("Silk Saree, ₹2,195, from Bindal's Creation in Ghaziabad. Yellow Green");
    const words = "word ".repeat(60).trim();
    const long = await describePage("product/BC1", rest([{ ...product, description: words }]));
    expect(long.description.length).toBeLessThanOrEqual(160);
    expect(long.description).toMatch(/word…$/);
  });

  test("every photo is shown and described by its colour and view", async () => {
    const images = [
      { imageurl: IMG, displayorder: 1, productcolor: "Green" },
      { imageurl: IMG, displayorder: 0, productcolor: "Yellow" },
    ];
    const page = await describePage("product/BC1", rest([{ ...product, productimages: images }]));
    expect(page.bodyHtml).toContain('alt="Silk Saree in Yellow, view 1"');
    expect(page.bodyHtml).toContain('alt="Silk Saree in Green, view 2"');
    expect(ld(page, "Product").image).toHaveLength(2);
  });

  test("a colour already in the name is not repeated", async () => {
    const page = await describePage(
      "product/BC1",
      rest([{ ...product, name: "Green Silk Saree", productimages: [{ imageurl: IMG, productcolor: "Green" }] }])
    );
    expect(page.bodyHtml).toContain('alt="Green Silk Saree"');
  });

  test("a product names its colour only when it has one", async () => {
    const one = [{ stock: 1, color: "Red" }, { stock: 0, color: "Red" }];
    const two = [{ stock: 1, color: "Red" }, { stock: 1, color: "Blue" }];
    expect(ld(await describePage("product/BC1", rest([{ ...product, productsizecolors: one }])), "Product").color).toBe("Red");
    expect(ld(await describePage("product/BC1", rest([{ ...product, productsizecolors: two }])), "Product").color).toBeUndefined();
  });

  test("a product links its collection and similar pieces, leaving out sold-out ones", async () => {
    const inStock = { productid: "BC2", name: "Other Saree", retailprice: 2000, productsizecolors: [{ stock: 1 }], productimages: [] };
    const soldOut = { productid: "BC3", name: "Gone Saree", retailprice: 2000, productsizecolors: [{ stock: 0 }], productimages: [] };
    const q = jest
      .fn()
      .mockResolvedValueOnce([{ ...product, categoryid: "SA" }])
      .mockResolvedValueOnce([inStock, soldOut]);
    const page = await describePage("product/BC1", q);
    expect(q.mock.calls[1][0]).toContain("categoryid=in.(SA)");
    expect(q.mock.calls[1][0]).toContain("productid=neq.BC1");
    expect(page.bodyHtml).toContain('href="/product/BC2"');
    expect(page.bodyHtml).not.toContain('href="/product/BC3"');
    expect(page.bodyHtml).toContain("View all Sarees");
    expect(ld(page, "BreadcrumbList").itemListElement[1].item).toBe("https://www.bindalscreations.com/collections/sarees");
  });

  test("every collection has its own search title and a full description", async () => {
    const titles = COLLECTIONS.map((c) => c.seoTitle);
    expect(new Set(titles).size).toBe(COLLECTIONS.length);
    COLLECTIONS.forEach((c) => {
      expect(c.description.length).toBeGreaterThanOrEqual(80);
      expect(c.description.length).toBeLessThanOrEqual(160);
    });
    const page = await describePage("collections/lehengas", rest());
    expect(page.title).toBe("Bridal & Festive Lehengas in Ghaziabad");
  });

  test("the store shows real shop photos, its map and its pin", async () => {
    const store = ld(await describePage("", rest()), "ClothingStore");
    expect(store.image[0]).toBe("https://www.bindalscreations.com/store/store-front.webp");
    expect(store.geo.latitude).toBeCloseTo(28.67, 2);
    expect(store.hasMap).toContain("maps.google.com");
  });

  test("the FAQ answers are structured data", async () => {
    const page = await describePage("faq", rest());
    expect(ld(page, "FAQPage").mainEntity.length).toBeGreaterThan(5);
    expect(page.bodyHtml).toContain("<h2>");
  });

  test("a FAQ answer with a link ends with its label, in the text and in the structured answer", async () => {
    const page = await describePage("faq", rest());
    expect(page.bodyHtml).toMatch(/See our <a href="\/policies\/returns">Returns &amp; Exchange policy<\/a>\.<\/p>/);
    const answers = ld(page, "FAQPage").mainEntity.map((q) => q.acceptedAnswer.text);
    expect(answers.find((a) => a.startsWith("Damaged or wrong items"))).toMatch(/See our Returns & Exchange policy\.$/);
    expect(answers.some((a) => /See our$/.test(a))).toBe(false);
  });

  test("the custom tailoring page shows the Hinglish line and the occasions the app shows", async () => {
    const { bodyHtml } = await describePage("customize", rest());
    expect(bodyHtml).toContain('<p lang="hi-Latn">Photo bhejiye, hum bana denge.</p>');
    expect(bodyHtml).toContain("Shaadi · Sangeet · Mehendi · Haldi · Reception · Festivals");
  });

  test("every page links collections, privacy and terms in plain HTML", async () => {
    const { bodyHtml } = await describePage("about", rest());
    ["/collections", "/policies/privacy", "/policies/terms"].forEach((to) =>
      expect(bodyHtml).toContain(`<a href="${to}">`)
    );
  });

  test("the website names its alternate spellings and promises no site search", async () => {
    const site = ld(await describePage("", rest()), "WebSite");
    expect(site.alternateName).toEqual(["Bindals Creation", "Bindal's Creations"]);
    expect(site.potentialAction).toBeUndefined();
  });

  test("a product lists its in-stock sizes, delivery and returns, and says so in structured data", async () => {
    const variants = [
      { stock: 1, color: "Red", size: "XL|42" },
      { stock: 2, color: "Red", size: "S|36" },
      { stock: 0, color: "Red", size: "M|38" },
    ];
    const page = await describePage("product/BC1", rest([{ ...product, categoryid: "SA", productsizecolors: variants }]));
    expect(page.bodyHtml).toContain("<li>Sizes: S (36), XL (42)</li>");
    expect(page.bodyHtml).toContain("Dispatches in 2 days · Delivered in 5–7 days · 7-day returns &amp; exchange");
    const p = ld(page, "Product");
    expect(p.size).toEqual(["S (36)", "XL (42)"]);
    expect(p.audience).toEqual({ "@type": "PeopleAudience", suggestedGender: "female", suggestedAgeGroup: "adult" });
    expect(p.offers.seller).toEqual({ "@id": "https://www.bindalscreations.com/#store", name: "Bindal's Creation" });
    expect(p.offers.shippingDetails).toBeUndefined();
    expect(p.offers.priceValidUntil).toBeUndefined();
  });

  test("a sold-out product lists no sizes and no dispatch promise, and an unknown category no audience", async () => {
    const page = await describePage(
      "product/BC1",
      rest([{ ...product, categoryid: "JNS", productsizecolors: [{ stock: 0, size: "M|38" }] }])
    );
    expect(page.bodyHtml).not.toContain("Sizes:");
    expect(page.bodyHtml).not.toContain("Dispatches");
    expect(page.bodyHtml).toContain("7-day returns");
    const p = ld(page, "Product");
    expect([p.size, p.audience]).toEqual([undefined, undefined]);
  });

  test("the home page describes the store, with the shop's closed day left out", async () => {
    const store = ld(await describePage("", rest()), "ClothingStore");
    expect(store.address.postalCode).toBe("201001");
    expect(store.openingHoursSpecification.dayOfWeek).not.toContain("Tuesday");
  });

  test("a collection lists its products and a trailing slash is the same page", async () => {
    const q = rest();
    const page = await describePage("collections/sarees/", q);
    expect(q.mock.calls[0][0]).toContain("categoryid=in.(SA)");
    expect(page.canonical).toBe("/collections/sarees");
    expect(page.bodyHtml).toContain('href="/product/BC1"');
  });

  test("a size collection lists its products, with size codes safely encoded", async () => {
    const q = rest();
    const page = await describePage("collections/plus-size", q);
    expect(q.mock.calls[0][0]).toContain("match:productsizecolors!inner(productid)");
    expect(decodeURIComponent(q.mock.calls[0][0])).toContain('match.size=in.("3XL|46",');
    expect(q.mock.calls[0][0]).not.toContain("|");
    expect(page.bodyHtml).toContain('href="/product/BC1"');
  });
});

describe("sitemap", () => {
  const log = jest.fn();

  test("lists static pages, every collection and every product, and nothing private", async () => {
    const xml = await buildSitemap(rest([{ productid: "BC1" }, { productid: "BC2" }]));
    expect(xml).toContain("<loc>https://www.bindalscreations.com/</loc>");
    expect(xml).toContain("<loc>https://www.bindalscreations.com/customize</loc>");
    expect(xml).toContain("<loc>https://www.bindalscreations.com/collections/plus-size</loc>");
    expect(xml).toContain("<loc>https://www.bindalscreations.com/product/BC2</loc>");
    expect(xml).not.toMatch(/\/(admin|cart|checkout|account|login|search|track)/);
  });

  test("lists each product's photos at the site's own address, in display order", async () => {
    const productimages = [
      { imageurl: "https://x.supabase.co/storage/v1/object/public/mockups/BC1/b.webp", displayorder: 1 },
      { imageurl: "https://x.supabase.co/storage/v1/object/public/mockups/BC1/a.webp", displayorder: 0 },
    ];
    const xml = await buildSitemap(rest([{ productid: "BC1", productimages }]));
    const first = xml.indexOf("<image:loc>https://www.bindalscreations.com/images/BC1/a_1200.webp</image:loc>");
    const second = xml.indexOf("<image:loc>https://www.bindalscreations.com/images/BC1/b_1200.webp</image:loc>");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
  });

  test("pages past the database's row cap", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ productid: `A${i}` }));
    const q = jest.fn().mockResolvedValueOnce(full).mockResolvedValueOnce([{ productid: "LAST" }]);
    const xml = await buildSitemap(q);
    expect(q.mock.calls[1][0]).toContain("offset=1000");
    expect(xml).toContain("/product/A999<");
    expect(xml).toContain("/product/LAST<");
  });

  test("an outage is a 503 and logged, never an empty sitemap", async () => {
    const down = jest.fn(() => Promise.reject(new Error("timeout")));
    const r = await sitemapResponse({ rest: down, log });
    expect(r.status).toBe(503);
    expect(r.body).not.toContain("<urlset");
    expect(log).toHaveBeenCalledWith("seo_sitemap_failed", { error: "timeout" });
  });
});

describe("renderHtml", () => {
  test("replaces the shell's head tags, fills the root and keeps the app's scripts", async () => {
    const html = renderHtml(shell, await describePage("faq", rest()));
    expect(html.match(/<title/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/name="robots"/g)).toHaveLength(1);
    expect(html).not.toContain('name="googlebot"');
    expect(html).toContain('rel="canonical" href="https://www.bindalscreations.com/faq"');
    expect(html).toMatch(/<div id="root"><div data-ssr-body/);
  });

  test("server text is hidden only by a script, so a reader without JS still sees it", async () => {
    const html = renderHtml(shell, await describePage("faq", rest()));
    expect(html).toContain('.js [data-ssr-body]{display:none}');
    expect(html).toContain('classList.add("js")');
    expect(html).not.toMatch(/<div data-ssr-body[^>]*display:\s*none/);
  });

  test("server text comes back if the app's main bundle fails to load, and only then", () => {
    const html = renderHtml(shell, { title: "T" });
    const script = html.match(/<script>(document\.documentElement[\s\S]*?)<\/script>/)[1];
    expect(html.indexOf(script)).toBeLessThan(html.indexOf("</head>") / 2);
    const root = { classList: new Set() };
    root.classList.add = (c) => Set.prototype.add.call(root.classList, c);
    root.classList.remove = (c) => Set.prototype.delete.call(root.classList, c);
    let onError;
    new Function("document", "addEventListener", script)(
      { documentElement: root },
      (type, fn, capture) => {
        expect([type, capture]).toEqual(["error", true]);
        onError = fn;
      }
    );
    expect(root.classList.has("js")).toBe(true);
    onError({ target: { tagName: "SCRIPT", src: "https://x/static/js/123.abc.chunk.js" } });
    onError({ target: { tagName: "IMG", src: "https://x/static/js/main.abc.js" } });
    expect(root.classList.has("js")).toBe(true);
    onError({ target: { tagName: "SCRIPT", src: "https://x/static/js/main.abc123.js" } });
    expect(root.classList.has("js")).toBe(false);
  });

  test("page text with $ patterns stays literal", () => {
    const html = renderHtml(shell, { title: "T", bodyHtml: "cost $& more" });
    expect(html).toContain("cost $& more");
  });

  test("structured data cannot close its script tag", () => {
    const html = renderHtml(shell, { jsonLd: [{ name: "</script><b>" }] });
    expect(html).not.toContain("</script><b>");
  });

  test("an unexpected shell is an error, not a broken page", () => {
    expect(() => renderHtml("<html></html>", { title: "T" })).toThrow(/root div/);
  });
});

describe("renderResponse", () => {
  const log = jest.fn();

  test("a good page is cached at the CDN", async () => {
    const r = await renderResponse({ path: "faq", shell, rest: rest(), log });
    expect([r.status, r.cacheControl]).toEqual([200, CACHE_RENDERED]);
  });

  test("a database outage serves the working app as 200, never a 404, and logs it", async () => {
    const down = jest.fn(() => Promise.reject(new Error("timeout")));
    const r = await renderResponse({ path: "product/BC1", shell, rest: down, log });
    expect([r.status, r.cacheControl, r.html]).toEqual([200, CACHE_DEGRADED, shell]);
    expect(log).toHaveBeenCalledWith("seo_render_failed", { path: "product/BC1", error: "timeout" });
  });

  test("a missing page is a 404 that still contains the app", async () => {
    const r = await renderResponse({ path: "nope", shell, rest: rest(), log });
    expect(r.status).toBe(404);
    expect(r.html).toContain('id="root"');
  });
});
