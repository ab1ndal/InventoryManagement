// node --test scripts/indexnow/indexnow.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { batches, changedUrls, sitemapProblem, sitemapUrls, SITE } from "./indexnow.mjs";

test("reads page URLs on this site, not image entries or other hosts", () => {
  const xml = `<urlset>
  <url><loc>${SITE}/</loc></url>
  <url><loc>${SITE}/product/BC1</loc><image:image><image:loc>${SITE}/images/BC1/a.webp</image:loc></image:image></url>
  <url><loc>${SITE}/shop?a=1&amp;b=2</loc></url>
  <url><loc>${SITE}/product/BC1</loc></url>
  <url><loc>https://other.example/x</loc></url>
</urlset>`;
  assert.deepEqual(sitemapUrls(xml), [`${SITE}/`, `${SITE}/product/BC1`, `${SITE}/shop?a=1&b=2`]);
});

test("sends every URL the first time, then only additions and removals", () => {
  assert.deepEqual(changedUrls(null, ["a", "b"]), ["a", "b"]);
  assert.deepEqual(changedUrls(["a", "b"], ["b", "c"]), ["c", "a"]);
  assert.deepEqual(changedUrls(["a"], ["a"]), []);
});

test("refuses an empty sitemap or one that shrank by more than half", () => {
  assert.match(sitemapProblem(null, []), /no page URLs/);
  const before = Array.from({ length: 100 }, (_, i) => `u${i}`);
  assert.match(sitemapProblem(before, before.slice(0, 49)), /shrank from 100 to 49/);
  assert.equal(sitemapProblem(before, before.slice(0, 50)), null);
  assert.equal(sitemapProblem(null, ["a"]), null);
});

test("splits large lists into requests IndexNow accepts", () => {
  assert.deepEqual(batches(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
  assert.deepEqual(batches([], 2), []);
});
