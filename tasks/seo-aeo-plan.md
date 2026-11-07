# SEO and AEO plan

Written 2026-11-03. Goal from the owner: rank very highly for Indian ethnic wear, so people find the site on Google.

## The honest target

No plan can guarantee a ranking. Google states there is no way to pay for or request a better local ranking, and
appearing in AI features is not guaranteed even for a perfect page.

"Indian ethnic wear" and "saree" are contested by Myntra, Ajio, Libas, Manyavar, Utsav Fashion and similar sites, with
far more pages, links and brand searches. Competing there first would waste a year. So climb in this order, each rung
paying for the next:

| Rung | Example searches | Why this order | Honest horizon (judgment, not a promise) |
|---|---|---|---|
| 1. Brand | bindal's creation, bindals creation ghaziabad | Must be won first; also the signal Google trusts | Weeks |
| 2. Local | saree shop in ghaziabad, lehenga shop ghaziabad, sherwani ghaziabad | Physical shop beats national sites on distance | 2-6 months |
| 3. Niche with a real edge | plus size lehenga 6XL, get a lehenga made from a photo, custom sherwani | Few sites stock or do this; the shop does | 4-9 months |
| 4. Long tail | silk saree with red border, cotton kurti 4XL, what to wear to a sangeet | Low competition, high intent, adds up | 6-12 months |
| 5. Category | silk sarees online, designer lehenga online | Needs the links and reviews earned above | 12-24 months |
| 6. Head terms | indian ethnic wear, ethnic wear online | Stretch goal. Only after rung 5 | 24+ months, may not happen |

Search volumes above are not yet measured. Step 2.1 replaces guesses with real data, and this order changes if the data says so.

## What the audit found (2026-11-03)

Live site:
- Every URL serves crawlers the same 1.5 KB empty page, with one title and no text.
- Unknown URLs return 200, so junk can be indexed.
- No canonical tags. Structured data exists only on product pages and only after JS runs. Google's merchant listing
  docs discourage this: markup added by JS makes Shopping crawls "less frequent and less reliable".
- Sitemap made by hand, last updated 2026-10-23, and missing `/customize`. Bare domain redirects with a temporary 307.
- `main.js` is 841 KB before compression.

Catalogue (820 visible products, queried from prod):
- **Only 149 distinct names.** 67 products are called "Silk-Lehenga", 58 "Cotton-Kurti". Titles this repetitive make
  pages look like duplicates. This is the biggest on-page problem after rendering.
- **523 of 820 descriptions are under 80 characters** (average 95). Only 23 have been reviewed.
- Stock is mostly one-offs, so product URLs die often. Long-term ranking power must live on collection pages.

Delivery area:
- Since 2026-11-03 the site names no delivery area, by owner decision. Rungs 5 and 6 are national searches, so they depend on
  the owner's decision about delivery area.

Corrections to the earlier audit:
- `llms.txt` is **not** worth doing for Google. Google says no AI text files or special schema are needed.
- FAQ rich results ended for all sites on 2026-05-07. FAQ markup is harmless and stays because it mirrors visible text, but
  it will not produce a rich result. The value is the visible answers.

## AEO in one paragraph

For Google, AEO is SEO. AI Overviews and AI Mode draw from the normal index through normal Googlebot, with no extra
requirements. Google's list: crawlable, internally linked, text not locked in images, structured data matching the visible
page, good page experience, and Merchant Center and Business Profile kept current. Those features can run several related
searches for one question, so complete coverage of a topic helps. So AEO here means: real text in the HTML, direct answers
to real questions, facts stated consistently everywhere, and third-party mentions. Anyone selling a separate AEO trick is
selling something Google says does not exist.

## Rules that are never broken

These protect the domain. One penalty undoes a year of work.
1. **Same HTML for everyone.** Never serve bots different content (cloaking). Text in rendered HTML must match the app.
2. **No bought links**, link exchanges or link packages. Paid placements get `rel="sponsored"`.
3. **No fake or incentivised reviews**, and no `aggregateRating` until real reviews are shown on that page.
4. **No mass-produced pages.** No "saree shop in {city}" pages for places the shop does not serve. That is doorway abuse.
   No keyword lists of cities.
5. **AI may draft, a human checks.** AI text must state facts verified from the photo or the shop. 500 lookalike AI
   descriptions is scaled content abuse. Publish in small batches, and watch Search Console after each.
6. **Structured data only states what the page shows.** Price, stock, hours and policies must match.
7. **Never 404 a product that has earned traffic.** Sold out stays live, says so, and links to similar pieces.
8. **Never reuse a seasonal URL for something else.** `/collections/diwali` stays the Diwali page, year after year.

## Phase 0: settle facts and turn on measurement (week 1)

| # | Step | Who | Done when |
|---|---|---|---|
| 0.1 | Settle delivery area. Site names none meanwhile (owner 2026-11-03) | Owner | Decision recorded |
| 0.2 | Verify `www.bindalscreations.com` in Search Console by DNS, submit sitemap | Owner + dev | Sitemap shows "Success" |
| 0.3 | Save baseline: indexed pages, impressions, clicks, top queries, GA4 organic sessions | Dev | Numbers in this file |
| 0.4 | Claim and verify Google Business Profile, if not done | Owner | Verified |
| 0.5 | Change bare domain to a permanent redirect in Vercel | Dev | `curl` shows 308 |
| 0.6 | Verify in Bing Webmaster Tools (imports from Search Console) | Owner + dev | Sitemap accepted |
| 0.7 | Confirm the Cloudflare and Vercel firewalls do not block Googlebot, Bingbot or AI search crawlers | Dev | Test fetches return 200 |

Diwali is 2026-11-08. SEO work started now will not rank for it. The next real demand is wedding season and Holi, and pages
for those need to be live and indexed well ahead.

## Phase 1: make the site readable (weeks 1-3)

In progress on branch `feat/seo-render`, option A: a Vercel function adds real head, text and structured data to the same
HTML every visitor gets.

| # | Step | Done when |
|---|---|---|
| 1.1 | Finish function: rename shell, rewrites, private routes untouched, app removes server tags on start | `curl` of a product shows its name, price, text |
| 1.2 | Real 404s; an outage serves the working app, never a 404 | Tests, and `curl` of unknown URL shows 404 |
| 1.3 | Canonical on every page; filters and search point to or stay out of the index | Inspected in Search Console |
| 1.4 | Product, Breadcrumb, ItemList, ClothingStore in initial HTML | Rich Results Test passes on 5 pages per type |
| 1.5 | Add shipping and return policy to the store markup, from the policy text, after 0.1 | Merchant listing report clean |
| 1.6 | Sitemap generated automatically, with `lastmod`, and `/customize` included | Fresh without a manual run |
| 1.7 | Crawlable path to every product: paginated collection links, not just the first 48 | Every sitemap URL reachable by links |
| 1.8 | Text in HTML matches what the app shows. Home page lists what home shows | Side-by-side check, rule 1 |
| 1.9 | Page speed: measure field data, then split `main.js` where it helps | LCP, INP, CLS "good" on mobile in Search Console |

Ship one route type at a time if possible, and check live with URL Inspection before moving on. Rollback is one Vercel
promote. The function touches every storefront URL, so merging needs explicit owner OK.

## Phase 2: know what people search, and fix titles (weeks 2-6)

| # | Step | Who | Done when |
|---|---|---|---|
| 2.1 | Keyword research: Google Keyword Planner (free with Ads account), Search Console, autocomplete, competitors' categories. Hindi and Hinglish included | Dev + owner | Sheet: query, volume, intent, target page, one page per intent |
| 2.2 | **Unique product titles**: "Yellow Silk Saree with Red Border". From colour, fabric, work, type. Verified against the photo | Dev + AI + owner sample | No two live products share a title |
| 2.3 | Descriptions: continue the existing revamp (`tasks/description-revamp-plan.md`), prioritised by stock and search demand. Batches of 50, watch, continue | Dev + AI + owner sample | Under-80-char count falls each batch, indexing does not drop |
| 2.4 | Image alt text and file names from the same facts. At least 4x3 or 1x1 high-resolution images | Dev | All live images have real alt text |
| 2.5 | Collection pages become the ranking pages: buying guidance, questions, links to related collections. Written by hand. **Decided 2026-11-05:** no text that describes the page or its products (intros and subtitles removed); the title and products say what the page is, and the meta description tells search engines. Add text only when the owner gives real buying advice a shopper would use | Owner facts + dev | Each has useful text a shopper would read |
| 2.6 | New collections only where 2.1 shows demand and stock exists: plus-size lehengas, bridal lehengas, wedding sherwanis, silk sarees | Owner + dev | Live with at least 12 products each |

Title format is a test: apply it to one category, read 4 weeks of Search Console data, then roll out.

## Phase 3: win local and shopping (weeks 2-12)

Google's local factors are relevance, distance and prominence, and it says more reviews and positive ratings can help.

| # | Step | Who |
|---|---|---|
| 3.1 | Profile: correct categories, hours, description, real shop photos, products, attributes. Exact same name, address, phone as the site | Owner |
| 3.2 | **Ask every happy customer for a Google review**, in store with a QR at billing, online by a link after delivery. No discounts for reviews | Owner + dev adds link to delivered message |
| 3.3 | Reply to every review. Post a photo update weekly | Owner |
| 3.4 | Merchant Center free listings from a live feed of in-stock products. India is eligible | Dev + owner |
| 3.5 | Link Merchant Center and Business Profile so local stock can appear, if eligible for the shop | Owner + dev |
| 3.6 | Same name, address, phone on every directory the shop is on: JustDial, IndiaMART, Sulekha, wedding directories | Owner |
| 3.7 | Replace the stock photo on About with real shop and family photos | Owner |

## Phase 4: earn authority (month 2 onward, never stops)

Rungs 5 and 6 are decided here. Page work alone will not get there.

| # | Step | Who |
|---|---|---|
| 4.1 | Guides only the shop can write, 2 a month: how to measure for a blouse, how to tell real silk, how much fabric a lehenga takes, what to wear to haldi, sangeet and reception. Real photos, a named real author, direct answer in the first lines | Owner knowledge + dev |
| 4.2 | Answer real questions: collect what customers ask on WhatsApp and in store. Those are the queries | Owner, 5 minutes a week |
| 4.3 | Customer stories and before/after from custom tailoring, with permission | Owner |
| 4.4 | Local press and mentions: Ghaziabad news, market associations, bridal bloggers, wedding planners | Owner |
| 4.5 | Instagram and YouTube Shorts: real pieces, tailoring process, draping. Name and link consistent | Owner |
| 4.6 | Product reviews on site once there are real ones. Then, and only then, `aggregateRating` | Dev, later |
| 4.7 | Brand searches: packaging, bills, shop signage carry the site name. Every customer who searches the brand helps | Owner |

## Measuring

Weekly (10 minutes): Search Console errors, manual actions, coverage drops.

Monthly, recorded in this file:
- Indexed pages against sitemap. Target 90% of live products within 8 weeks of Phase 1, as a judgment.
- Impressions, clicks and average position, for branded and non-branded separately.
- Position for a fixed list of 30 queries per rung, chosen in 2.1.
- Business Profile views, calls and direction requests. Review count and rating.
- GA4 organic sessions, organic orders and revenue. Orders matter more than rankings.
- AEO check: ask the same 10 questions in Google AI Mode, ChatGPT, Perplexity and Copilot. Record if the shop appears and
  if the facts are right. Search Console counts AI Overviews and AI Mode traffic inside the Web report, without its own split in
  the Google doc checked here.

## When to change course

| Signal | Action |
|---|---|
| Pages "Crawled, not indexed" keep rising after Phase 1 | Stop adding pages, improve the thinnest ones |
| Rankings drop after a description batch | Pause batches, compare with a control category |
| Manual action appears | Stop everything, fix it first, then file for reconsideration |
| Rung 2 not moving by month 6 | Audit profile and reviews before more content |
| Traffic rises but orders do not | Fix intent targeting and product pages before more SEO |
| Core update drop | No panic edits. Wait for it to finish, compare with competitors |

Paid ads are outside this plan. Shopping ads could bring orders during the months SEO takes to work, and that is a separate
budget decision.

## Needed from the owner

1. Decision on delivery area (0.1).
2. Access: domain DNS for Search Console, Business Profile, Merchant Center.
3. Real photos: shop front, inside, family, tailoring.
4. A named author for guides, and willingness to ask for reviews.
5. About 2 hours a week ongoing. Authority comes from the shop, not from code.

## Current state

Updated 2026-11-04. Rendering is live (PR #131). Open work and merge order: `tasks/todo.md`, SEO / AEO section.

Done:
- 0.2 Sitemap submitted in Search Console: Success, 843 pages. 0.5 Bare domain is a permanent 308.
- 1.1, 1.2, 1.3, 1.6, 1.8 live. 1.4 checked on one product with Google's live test: Product, Merchant listing and Breadcrumb valid.
- 1.5 Return policy markup, from the policy text. Shipping markup added 2026-11-06 after 0.1 (all India): the store states free delivery at ₹5,000 and above only, because below that the fee is a live courier quote.
- 1.7 `/all-products` lists every product in plain links, in the app and in server HTML, linked from every footer.
- 1.9 Product page layout shift fixed. Field data still to be read in Search Console.
- 10 pages sent to Google's priority queue: home, shop, customize, lehengas, suits, kurtis, gowns, men, sherwani, plus-size.

Baseline, 2026-11-03: 9 pages indexed, 4 not indexed, 14 web clicks over about 3 months. Core Web Vitals had no data.

Google Maps listing as of 2026-11-03: 3.8 stars from 25 reviews. Its website link is `http://wwwbindalscreations.com/`, missing a dot, and that domain does not resolve. The address reads "58, Sihani Gate, Richalpuri, Naya Ganj" against the site's "58 Sihani Gate Market, Near Durga Bhabhi Chowk". Listing not managed from the account that owns Search Console.

Open, needs the owner:
- 0.1 decided 2026-11-05: all India. 0.4 and 3.1 Find who manages the listing, then fix its website link and address.
- 0.6 Bing Webmaster Tools. 3.2 Counter QR card (review link is live, PR #137). 3.4 Merchant Center account 5899745962 set up 2026-11-05, 25-item test feed in review.

Open, dev:
- Request indexing for kurta-pajama, about, contact, all-products, after PR #138 is live.
- 2.1 keyword research needs an Ads account. 2.3 descriptions, 2.5 collection text.

Live 2026-11-04:
- PR #139, photos: Storage sent `x-robots-tag: none` on every image, so none could reach Google Images. Found after the audit.
- PR #138, 2.4 alt text, plus titles, descriptions, product links and store markup.
- PR #140, 1.9 page speed: main.js 846 KB to 664 KB. Public pages stay eager to protect layout stability.
- PR #141, 3.4 Merchant Center feed, 778 in-stock items.

IndexNow, 2026-11-06: `.github/workflows/indexnow.yml` runs daily at 08:00 IST and sends Bing, Yandex, Naver, Seznam and Yep the
pages added to or removed from the sitemap since the last run (first run sends all). Key file `public/4a3dab4214c8fd6eee375524f8e3de46.txt`.
Google does not use IndexNow, and its Indexing API is only for job postings and livestreams, so it is not used.
`llms.txt` and an on-site AI chat agent were considered and rejected: no major AI search engine reads them.

Live 2026-11-04: 2.2 saree titles, owner reviewed. 16 titles became 89, list in `tasks/title-drafts/sarees.json`. Five stock colours corrected.

Catalogue, 2026-11-04: 3,685 products, 3,530 in stock, and 821 with photos. Only products with photos show on the site, and
photos are being added steadily. Sarees are the largest category: 1,300 products, 89 visible. Figures earlier in this plan
count visible products only. Stock depth is an advantage for rungs 3 to 5 once photos catch up.

Found while drafting: colours recorded on some products do not match their photos, such as BC25875 (Off White, photo magenta).
Titles and alt text state these colours, so check colours before rolling titles out to other categories.

Sitemap has no `lastmod`: products have no change date, and a made-up date is worse than none.

## Sources

- Google, AI features and your website: https://developers.google.com/search/docs/appearance/ai-features
- Google, merchant listing structured data: https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
- Google, spam policies: https://developers.google.com/search/docs/essentials/spam-policies
- Google, local ranking: https://support.google.com/business/answer/7091
- Google, free product listings: https://support.google.com/merchants/answer/13889434
- FAQ rich results ended: https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/
- Competitor sets: https://ahrefs.com/websites/mirraw.com/competitors and https://ahrefs.com/websites/utsavfashion.com/competitors
