import { buildFeed, feedResponse } from "../feed";

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
