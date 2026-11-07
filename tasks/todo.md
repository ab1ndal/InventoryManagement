# Todo

Pruned 2026-10-29. Finished work lives in git history / PRs; this file keeps only what is open plus the
reference facts still needed.

## ▶ RIGHT NOW (2026-11-05)

Nothing is broken or urgent. Newest changes are live but not all proven on real use.

Owner:
- [ ] Admin check (~5 min) at `/admin/bills`: full-name customer search; wrong payment shows the red box; Final Amount
      over 30% off shows the warning. Do not confirm a real bill.
- [ ] Send the shop questions as one WhatsApp batch (ask Claude to format them).
- [ ] Later: one accountant session; name one complaints contact for the website.

Waiting, nothing to do:
- Merchant Center review of the 25 test products (feed `?sample=25`). "Found by Google" is hidden on purpose. Do not
  turn on automatic image improvements.
- First real courier lookup by `tracking-sweeper`, about 09:17 UTC on 2026-11-05.

Claude, next:
- [ ] Transactional bill save, step 1: new database step unused by any screen, proved locally and in a rolled-back
      production test. Plan is in the owner's private audit folder.
- [ ] Confirm the tracking sweep's first real lookup worked.
- [ ] PR #196 LIVE 2026-11-07: customer phone as +91 box + number box (no live reformat), "Add this customer" prefilled from the bill search. Owner to try on the next new customer. SupplierForm still has the old cursor-jumping phone box.
- [ ] Merchant Center: fix what Google flags, then point the source at the full feed (778 items). Held 2026-11-04: review still running. AI labels: owner decided none (2026-11-06).
- [ ] Order emails: Gmail filed a real order's emails in Spam. PR #172 is live but unproven: both formats reached the Inbox on the one test account. Check placement on the next real orders. Own-domain sending is the lasting fix, not possible for now.
- [ ] Shiprocket Brand Name set to Bindals Creation 2026-11-04: confirm on the next Shiprocket email.

## PARKED by owner 2026-11-06 (do not start without the owner)

- Vercel "10 GB" warning: almost certainly Hobby Fast Origin Transfer, from `/images/*` passing every photo through
  Vercel since 2026-11-04 (#139). Vercel can't cache them: Supabase adds `set-cookie: __cf_bm`. Fix A = make the
  rewrite cacheable (rewrite-caching header + drop set-cookie, test on preview with GET, not HEAD) or a tiny image
  proxy function; fix B = point images back at Supabase (zero Vercel use, loses Google Images: Storage sends
  `x-robots-tag: none`). If the limit nears, do B at once. Cold Supabase misses take ~2 s per photo.
- Manual tracking number added after "Picked up": send the customer an email? Carrier links: not now. Edit after
  delivery: stays allowed.
- Storage (~16 GB, Supabase Pro so within quota): `mockups-temp` 8.2 GB = 1,536 unreviewed batch mockups for 716
  products with no photo (review, shrink to WebP, or drop and mark cards rejected); `mockups` 4.4 GB of archival PNGs
  never served (copy off Supabase, delete, stop `upload_archival` in mockup-generator `publish.py`).
- Old bill PDFs: new ones are JPEG since #189 (expect ~0.2 MB; confirm on the next saved bill). Regenerating the 386
  stored 6 MB bills needs owner OK. Regenerate path leaves old `-v<timestamp>` files (17 orphans, 108 MB).

Dropped 2026-11-05: real test orders. The first Shiprocket parcel (WEB-000006) was still in transit a week later in
the same pincode, so the shop delivers by its own means (Self delivery preselected, #187; tracking number #188) and
keeps Shiprocket for bulk.

## SEO / AEO (updated 2026-11-04)

Plan and rules: `tasks/seo-aeo-plan.md`.

**Live 2026-11-04:** PRs #139 photos, #140 lazy private pages, #138 titles and alt text, #141 Merchant feed. Checked on production: photos
return `x-robots-tag: all`, sitemap lists 1,028 photos, feed has 778 valid items, no page errors or failed requests across 8 pages.

**Dev, next**
- [ ] Check Vercel bandwidth in the dashboard around 2026-11-08, now that photos pass through Vercel. Try one real checkout, because it now loads on demand.
- [x] Rich Results Test 2026-11-04: collection (Breadcrumbs, Carousels) and product (Product, Merchant, Breadcrumbs) valid; product has non-critical warnings.
- [x] Indexing requested 2026-11-04: kurta-pajama, about, contact, all-products. Search Console's page report was still dated 2026-10-22.
- [ ] Saree titles LIVE 2026-11-04: all 89 unique, final list in `tasks/title-drafts/sarees.json`. Wait 4 weeks of Search Console data, then decide on other categories. Check recorded colours against photos first.
- [ ] New photos will go live with shared titles such as "Silk Saree", because `title_detail` is empty until someone fills it. 731 visible products have none, and about 2,860 more have no photo yet. mockup-generator is getting `title_detail` drafting on branch `feat/title-detail` (started 2026-11-04).
- [x] Kids collection + header link LIVE 2026-11-06 (PR #191): all five C- categories, 5 kurta pajamas at launch; more join as photos are approved. Indexing requested for `/collections/kids` 2026-11-06 (was "URL is not on Google", referring page none detected).
- [x] Shipping markup (plan 1.5) LIVE 2026-11-06 (PR #192): free delivery across India at ₹5,000+ only; below that is a courier quote, so no rate stated. Rich Results Test on /contact 2026-11-06: 4 valid (Local business, Organization, Return policy, Shipping policy); warnings were optional `priceRange` (left out: no fixed value stays true) and `refundType` (added as FullRefund, PR #195, live).
- [x] Decided 2026-11-06 (owner): no AI labels on feed text or photos; owner vets every photo and text in detail. PR #193 closed, branch `feat/feed-ai-text` kept. Risk accepted: Google Merchant Center asks for `structured_title`/`structured_description` and IPTC `DigitalSourceType` on AI content, with no review exemption (support.google.com/merchants/answer/14743464). Revisit if Merchant Center flags items. Do not reopen otherwise.
- [x] IndexNow LIVE 2026-11-06 (PR #194): daily 08:00 IST workflow sends sitemap changes to Bing and other IndexNow engines; first run sent all 850 pages (status 200; the very first try got 403 SiteVerificationNotCompleted, fine minutes later). A failed run emails via GitHub; state is kept so the next day retries.
- [ ] Manual "Request indexing" 2026-11-07, 10 URLs, all accepted (~1 min each, no quota hit): /collections, /collections/everyday, /faq, /size-guide, sarees BC25005, BC25008, BC25057, BC251579, BC251716, BC251762. Spend daily requests on collection/site pages first, then best-titled products. Daily automation via Claude in Chrome: not set up; needs a check that a background run can drive Chrome.
- [ ] 1.9 field data: PageSpeed Insights API without a key hit its daily quota (2026-11-06). Read Core Web Vitals in Search Console instead, or add a key.
- [ ] Add photos in batches and watch Search Console: "Crawled, not indexed" rising means slow down and improve the thinnest pages. Sitemap, feed and all-products pick up new products automatically.
- [ ] Index check 2026-11-07 (URL Inspection API, all 850 sitemap pages): 29 indexed. Site pages 10 of 13 and collections 10 of 12 indexed (Kids indexed 2026-11-07, a day after the request). Products 9 of 823: 660 "Discovered - currently not indexed" (known, not yet crawled), 154 unknown to Google, 1 crawled not indexed. No canonical mismatches. Read: Google is rationing crawl on a young, low-authority site; not a page fault. Levers: links from collections to products, outside links (Business Profile, Instagram), time. Re-run monthly and compare; access in memory reference_search_console_api.
- [ ] Order snapshots still store `name`, so order pages and emails show the old title.
- [x] Needs title list in admin: Inventory toggle, PR #173.
- [x] Collection intro text removed 2026-11-05 (owner: no page descriptors). Step 2.5 now waits for real buying advice from the owner.

**Owner**
- [x] Delivery area decided 2026-11-05: all India, no out-of-state warnings anywhere.
- [ ] Google Ads account, for Keyword Planner volumes (2.1).
- [x] Merchant Center account 5899745962 set up 2026-11-05: test feed `?sample=25` under review, account shipping flat ₹250 under ₹5,000. Full feed after the review (see Claude, next).
- [x] Business Profile website link fixed: Google Search panel shows `http://www.bindalscreations.com/` (checked 2026-11-05), which 308s to `https://www.`.
- [x] Bing Webmaster Tools site added 2026-11-06 (data takes up to 48 h). Sitemap submitted there 2026-11-07 (property `bindalscreations.com`). AI training and grounding: no setting needed, both default to Allow and the site sends no NoArchive/NoCache (Bing blog 2026-10-30; new rules from 2027-02-01). Check Site Explorer and Search Performance after 2026-11-09.
- [ ] Review QR counter card. Real shop and tailoring photos.

Decided, 2026-11-04: home wording names women, men and kids. Owner considers it settled, do not reopen.

Decided, 2026-11-04: Vercel's edge cache does not engage for the image rewrite (always MISS, even with
`x-vercel-enable-rewrite-caching` and `CDN-Cache-Control`), so those headers were dropped. Speed matches direct Storage.

## ONLINE ORDERS: go-live

State 2026-10-29: everything built, deployed, configured. Cashfree on PRODUCTION keys (+ prod webhook, domain
whitelisted, UPI + cards active, settlement bank active). Shiprocket KYC done, wallet ₹1,000, pickup `Shop`
verified. Customer login email via Gmail SMTP with branded templates. `checkout_live = false`.
Untested against real services: payment on production keys (task above) and Process with Shiprocket (below).

**Shipping (test parcel DEFERRED by owner 2026-10-29)**
- [ ] Test parcel to a UP family address through the real flow (checkout on briefly, cheap item, admin Process →
  AWB, label, Bill of Supply, pickup). Check the label PDF: Shiprocket's customer invoice must NOT go in the parcel
  (composition dealer can't issue a "Tax Invoice"). Until this runs, fallback = book the parcel by hand in Shiprocket.
- [ ] With the parcel: Shiprocket live checks 5 (update keeps shipment) and 7 (webhook retry) —
  `docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md` § Live checks.
- [ ] After the parcel: compare wallet deduction with the quote (GST included? ₹5 "Smart Order" charged? if so add
  ₹5 before rounding). Owner accepts absorbing GST; rule = never undercharge freight.
- [ ] Buy packaging (2 bags + 1 box); pack a kurti, saree, lehenga; measure + weigh; replace the assumed sizes in
  `supabase/functions/_shared/shipping.ts` (and LIGHT/MEDIUM/HEAVY kg if needed).
- [ ] Returns "Must verify" after a real delivery: `.superpowers/sdd/2026-10-26-online-returns/final-review.md`
  (mark delivered, open/receive/refund a return, photo upload, refund email, in-store exchange of an online bill).
- Keep `REBOOK_API_CANCEL` unset until cancel-by-AWB is verified on a real shipment.
- Optional: Cashfree API + success-rate alerts (dashboard → Developers); request Net Banking activation.

**Reference**
- Pricing: live cheapest-courier rate rounded up to ₹10; free ≥ ₹5,000; no-rate fallback by chargeable weight
  ≤0.5 kg ₹90, ≤1 ₹140, ≤2 ₹150, ≤3 ₹180, ≤5 ₹230 (PR #79). WhatsApp checkout still flat ₹150.
- Deploy: `supabase functions deploy <fn> --use-api --import-map supabase/functions/deno.json`. `supabase/config.toml` fixes the
  gateway check for functions that take no user token (webhooks, cron). Check `supabase functions list` after deploying. Secrets propagate without redeploy. Migrations: `npm run migrate` from the
  branch that holds the file (it only sees files in the checked-out tree).
- Webhooks: Cashfree → `https://epotsxdugwfhyeiudjox.supabase.co/functions/v1/cashfree-webhook` (v2026-01-01,
  success/failed/dropped); Shiprocket → `https://www.bindalscreations.com/hooks/courier-status` (x-api-key).
- Sandbox orders WEB-000001..05 are cancelled test data (refund legs closed as 'failed'). First real order = WEB-000006.
- Names: website/brand **Bindal's Creation**; legal/GST **Bindals Creation** ("Bindals Creation (Prop. Pooja Bindal)").
  Address always *58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001* (never the GST record's
  "Subhangini Fancy Saree"). Cashfree account manager: Saurabh Kumar.
- Shiprocket API user bindalscreations+api@gmail.com (Orders/Shipments/Courier); token for scripts: owner runs the
  login curl in their own terminal (`read -s` password) → session scratchpad `sr/login.json`, valid ~10 days.

**Follow-ups (non-blocking)**
- [ ] "Send back to To-check" for an order stuck in processing after AWB.
- [ ] After PR #110: a courier refusal stops Process with no way to pick another courier in admin (Porter or cancel
  only). Add a "choose courier" admin action if this happens in practice.
- [ ] Deferred returns polish: customer order page Returned badge; customer self-service return request; hide the
  Shipping line in ExchangePage for online bills; edge sortReturns compares timestamps as strings.
- [ ] Owner question: manual (non-catalogue) items never restock on in-store exchange — switch on?

## STOREFRONT

**Owner (content / decisions)**
- [ ] Photos of 2-4 custom pieces (customer reference + finished piece) for /customize. Top trust fix.
- [ ] Tailor/embroidery photo to replace the CC BY zari stock photo on About (Craftsmanship section).
- [ ] Fix BC25022's price in admin (₹0, hidden from the storefront until then).
- [ ] Decide: product names back on cards? "Diwali Glam" name? sentence-case page titles? Inter body font?
- [ ] First-order discount terms (amount + how to claim) before it goes on the promo line.
- [ ] Curate Wedding / Festive collections (hidden until then).
- [ ] Optional: Diwali 50 swaps via `tasks/diwali-pick-sheet.html`.

**Build later** (details in `tasks/site-review-2026-10-25.md`)
- [ ] PDP mobile: one sticky action; beige add-to-cart looks disabled.
- [ ] "More like this" shows men's coat suits under women's 3-pc suits ("Suit (3 Pc)" mixes both).
- [ ] Home: fewer repeating rails; trust bar as a plain fact strip; collections index made visual; nav taxonomy.
- [ ] Mobile footer: compact accordions.
- [ ] Filters cleanup (fabric bug, greyed options, size groups), after Diwali.

## CUSTOM TAILORING (main differentiator; Phase A live)

- [ ] Owner: take requests on WhatsApp; quote; advance + balance by Cashfree Payment Links from the dashboard (live).
- [ ] Full build (upload form, status page, admin, payment links via API): `tasks/customization-plan.md` phases 2-9.
  When setting its webhook, tick PAYMENT_LINK_EVENT (Payment Link tab).

## PRODUCT DESCRIPTIONS + TAGS

Source of truth: `tasks/description-revamp-plan.md`, `scripts/describe/README.md`.
- [ ] Owner: review pilot-20 tags (https://claude.ai/artifact/E8SaPSKde8J1p8W2yeZkpc), then write them.
- [ ] Admin product form tag picker (`replace_product_tags`, scope 'all').
- [ ] Batches of the other ~767 products (about 150 each, each reviewed on its own page).
- [ ] Then PDP detail rows + Occasion and Work filters.

## CA / LEGAL

- [ ] CA: composition shop selling online intra-state from its own site.
- [ ] CA: is shipping charged to customers part of composition turnover (1% on it)? Is GSTIN invoicing ON in
  Shiprocket fine for a composition dealer?
- [ ] CA: own-fabric stitching as a service; does a custom-order advance create a time of supply (receipt voucher)?
- PARKED (owner 2026-10-29): HSN on Bills of Supply. Rule 49 lists HSN on a BoS; the ≤₹5 cr B2C relief is
  written for tax invoices (Rule 46). CA can't classify products. Draft if revived: 6203 men's suits/ensembles/
  trousers/jeans/kurta pajama/sherwani/blazer/Nehru; 6204 women's lehenga/gown/dress/readymade suits/cord sets/
  skirt-top/sharara/plazo/kurti; 6205 shirt; 6206 tops; 6109/6110/6104 knitted T-shirt/sweatshirt/legging;
  6214 dupatta/shawl/safa; 7117 mala; sarees by fibre 5407 synthetic, 5007 pure silk, 5208 cotton, 5804 net.
  Open: "Silk" sarees art silk?; is ST "Suits" unstitched fabric?; kurti 6204 vs 6206. GST registration lists
  6210/5903/5209/5407/7117 (6210 likely wrong).

## RETENTION (after checkout goes live)

- [ ] Abandoned-cart emails (signed-in customers).
- [ ] Liked-item emails (back in stock, price drop); needs consent + unsubscribe.
- [ ] Later, only if demand shows: COD with a surcharge and OTP/WhatsApp confirmation.
- If login emails drift to Spam: move auth/order mail to Resend/Brevo on bindalscreations.com (SPF/DKIM/DMARC);
  see `tasks/auth-email-plan.md`.

## PARKED: online seller = regular-scheme LLP (2026-10-20)

Owner chose UP-only sales from the composition shop. Revive only for India-wide delivery: SANTOSH GLOBAL LLP
(GSTIN 09AFKFS5575H1ZC) needs an LLP current account, gateway/courier KYC in the LLP's name, GST tax invoices,
and CA answers on stock transfer and related-party pricing. CA doc:
https://claude.ai/code/artifact/342df0ee-b022-4959-86c6-dc0367787dfa

## ROADMAP (not scheduled)

- WhatsApp notifications for the shop (new order) and customers (milestones, covers phone-only customers):
  `tasks/future-whatsapp-notifications.md`.
  **Sender number (findings 2026-10-31):**
  - Do NOT put the shop number +91 98108 73280 on the API. It is the owner's personal + business WhatsApp; direct
    Cloud API registration removes it from the app. "Coexistence" (app + API on one number) needs the WhatsApp
    Business app ≥ 2.24.17, a paid BSP (Interakt/AiSensy/DoubleTick; Meta allows it only via a Solution Partner/Tech
    Provider), India support is contested (DoubleTick says yes; 360dialog/Woztell list India unsupported), and it
    turns off broadcast lists, disappearing/view-once/live location, group sync. Rejected.
  - Chosen: a separate sender SIM (an old number is fine). Needs one-time SMS/voice OTP and must not be on the
    WhatsApp app at registration (delete the account first). Set a 6-digit PIN; keep the SIM recharged. One-way:
    the number can't go back to the app while on the API. 98108 73280 stays as is: it receives the shop alerts,
    and customer templates carry a "Chat with us" wa.me/919810873280 button so replies reach the owner.
  - Prior setup: a Cloud API bill sender (`send-bill-sms`, template `bindals_invoice`, "alternate number") was
    removed 2026-07-09 in `e99227f` (function undeployed, secrets unset; bills now use wa.me links). Prod has no
    `WHATSAPP_*` secrets. Meta-side assets may still exist; may only ever have been Meta's free US test number.
  - [ ] Owner: business.facebook.com → WhatsApp Manager → Phone numbers. +91 "Connected" → reuse (send Phone
    Number ID + display-name status). Only a +1 test number, or nothing → register the old SIM. Also check whether
    `bindals_invoice` is still an approved template.
- Catalogue tagging with Jev: `tasks/future-jev-catalogue-tagging.md`.

## Other

- WhatsApp Community marketing and event promo copy: `tasks/whatsapp-community.md`.
- Storefront action plan (Diwali 8 Nov 2026): `tasks/storefront-action-plan.md`.
