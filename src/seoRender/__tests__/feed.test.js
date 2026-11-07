import { buildFeed, feedColour, feedResponse, sampleItems } from "../feed";

const IMG = "https://x.supabase.co/storage/v1/object/public/mockups/BC1";
const product = {
  productid: "BC1",
  name: "Silk Saree",
  description: "**Yellow** silk saree with a red border",
  retailprice: 2195,
  productimages: [
    { imageurl: `${IMG}/b.webp`, displayorder: 1 },
    { imageurl: `${IMG}/a.webp`, displayorder: 0 },
  ],
  productsizecolors: [{ stock: 1, color: "Yellow" }],
};
const rest = (rows) => jest.fn(() => Promise.resolve(rows));

test("an in-stock product has the fields Merchant Center needs", async () => {
  const xml = await buildFeed(rest([product]));
  expect(xml).toContain("<g:id>BC1</g:id>");
  expect(xml).toContain("<g:title>Silk Saree</g:title>");
  expect(xml).toContain("<g:description>Yellow silk saree with a red border</g:description>");
  expect(xml).toContain("<g:link>https://www.bindalscreations.com/product/BC1</g:link>");
  expect(xml).toMatch(/<g:image_link>[^<]*a_1200\.webp<\/g:image_link>/);
  expect(xml).toMatch(/<g:additional_image_link>[^<]*b_1200\.webp<\/g:additional_image_link>/);
  expect(xml).toContain("<g:availability>in_stock</g:availability>");
  expect(xml).toContain("<g:price>2195.00 INR</g:price>");
  expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
  expect(xml).toContain("<g:color>Yellow</g:color>");
});

test("AI-drafted titles and descriptions go only in the structured attributes Google requires", async () => {
  const ai = await buildFeed(rest([{ ...product, title_detail: "Red Border", description_source: "ai_reviewed" }]));
  expect(ai).toContain(
    "<g:structured_title><g:digital_source_type>trained_algorithmic_media</g:digital_source_type><g:content>Silk Saree</g:content></g:structured_title>"
  );
  expect(ai).toContain(
    "<g:structured_description><g:digital_source_type>trained_algorithmic_media</g:digital_source_type><g:content>Yellow silk saree with a red border</g:content></g:structured_description>"
  );
  // Google uses the plain attribute whenever both are present.
  expect(ai).not.toContain("<g:title>");
  expect(ai).not.toContain("<g:description>");

  const human = await buildFeed(rest([{ ...product, title_detail: null, description_source: "manual" }]));
  expect(human).toContain("<g:title>Silk Saree</g:title>");
  expect(human).toContain("<g:description>Yellow silk saree with a red border</g:description>");
  expect(human).not.toContain("structured_");

  // With no description the feed writes its own template text, which no AI drafted.
  const empty = await buildFeed(rest([{ ...product, description: "", description_source: "ai" }]));
  expect(empty).toContain("<g:description>");
  expect(empty).not.toContain("structured_description");
});

test("colours use Google's separator, and a value that is not a colour states none", async () => {
  expect(feedColour("Yellow-Red-Green")).toBe("Yellow/Red/Green");
  expect(feedColour("Red and Yellow")).toBe("Red/Yellow");
  expect(feedColour("Navy Blue")).toBe("Navy Blue");
  expect(feedColour("Red-Yellow-Green-Blue")).toBeNull();
  ["Multi Color", "multicolour", "Multi-Color", "Printed", " ", null].forEach((v) => expect(feedColour(v)).toBeNull());
  const one = (color) => buildFeed(rest([{ ...product, productsizecolors: [{ stock: 1, color }] }]));
  expect(await one("Yellow-Green")).toContain("<g:color>Yellow/Green</g:color>");
  expect(await one("Multi Color")).not.toContain("<g:color>");
});

test("size is stated only when the in-stock pieces share one, and gender and age come from the category", async () => {
  const feed = (categoryid, variants) =>
    buildFeed(rest([{ ...product, categoryid, productsizecolors: variants }]));
  const sold = await feed("SA", [{ stock: 1, color: "Red", size: "FREE-SIZE" }, { stock: 0, color: "Red", size: "M|38" }]);
  expect(sold).toContain("<g:size>Free Size</g:size>");
  expect(sold).toContain("<g:gender>female</g:gender>");
  expect(sold).toContain("<g:age_group>adult</g:age_group>");
  const many = await feed("SA", [{ stock: 1, size: "S|36" }, { stock: 1, size: "M|38" }]);
  expect(many).not.toContain("<g:size>");
  const boy = await feed("C-SW", [{ stock: 1, size: "10|30" }]);
  expect(boy).toContain("<g:gender>male</g:gender>");
  expect(boy).toContain("<g:age_group>kids</g:age_group>");
  const unknown = await feed("JNS", [{ stock: 1 }]);
  expect(unknown).not.toContain("<g:gender>");
  expect(unknown).not.toContain("<g:age_group>");
  expect(unknown).not.toContain("item_group_id");
});

test("sold-out and photo-less products are left out", async () => {
  const soldOut = { ...product, productid: "GONE", productsizecolors: [{ stock: 0 }] };
  const noPhoto = { ...product, productid: "NOPIC", productimages: [] };
  const xml = await buildFeed(rest([soldOut, noPhoto]));
  expect(xml).not.toContain("<item>");
});

test("a product with several colours states none, and an empty description gets a real one", async () => {
  const two = [{ stock: 1, color: "Red" }, { stock: 1, color: "Blue" }];
  const xml = await buildFeed(rest([{ ...product, description: null, productsizecolors: two }]));
  expect(xml).not.toContain("<g:color>");
  expect(xml).toContain("<g:description>Silk Saree, ₹2,195, from Bindal&#39;s Creation in Ghaziabad.</g:description>");
});

test("extra photos stop at Merchant Center's limit of 10", async () => {
  const productimages = Array.from({ length: 14 }, (_, i) => ({ imageurl: `${IMG}/${i}.webp`, displayorder: i }));
  const xml = await buildFeed(rest([{ ...product, productimages }]));
  expect(xml.match(/<g:additional_image_link>/g)).toHaveLength(10);
});

test("database text cannot break the XML", async () => {
  const xml = await buildFeed(rest([{ ...product, name: "A & B <Saree>" }]));
  expect(xml).toContain("<g:title>A &amp; B &lt;Saree&gt;</g:title>");
});

test("pages past the database's row cap", async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ ...product, productid: `A${i}` }));
  const q = jest.fn().mockResolvedValueOnce(full).mockResolvedValueOnce([{ ...product, productid: "LAST" }]);
  const xml = await buildFeed(q);
  expect(q.mock.calls[1][0]).toContain("offset=1000");
  expect(xml).toContain("<g:id>LAST</g:id>");
});

test("an outage is a 503 and logged, never an empty feed", async () => {
  const log = jest.fn();
  const r = await feedResponse({ rest: jest.fn(() => Promise.reject(new Error("timeout"))), log });
  expect(r.status).toBe(503);
  expect(log).toHaveBeenCalledWith("merchant_feed_failed", { error: "timeout" });
});

test("a sample is evenly spaced and never more than asked", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const picked = sampleItems(items, 25);
  expect(picked).toHaveLength(25);
  expect(picked.slice(0, 3)).toEqual([0, 4, 8]);
});

test("no sample, or a sample too large or invalid, keeps every item", () => {
  const items = [1, 2, 3];
  expect(sampleItems(items, undefined)).toEqual(items);
  expect(sampleItems(items, 10)).toEqual(items);
  expect(sampleItems(items, -1)).toEqual(items);
  expect(sampleItems(items, 1.5)).toEqual(items);
});
