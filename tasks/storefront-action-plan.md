# Storefront action plan — priority order (Diwali 2026)

Written 2026-10-13. Deadline: **Diwali, Sun 8 Nov 2026** (~3.5 weeks).
Details and rationale for each item: `tasks/storefront-revamp-plan.md`.
Jev tagging details: `tasks/future-jev-catalogue-tagging.md`.

## Owner decisions (2026-10-13)
- **Look first.** Do the visual revamp before checkout; orders keep going through WhatsApp.
- **Diwali curation:** the storefront shows ~50 hand-picked Diwali products first, then expands.
- **Hero:** Andaaz-style slider using the best product photos for now; lifestyle photos swap in later.
- **Promo line offers:** free shipping over ₹5,000, first-order discount, festive collection,
  WhatsApp help / custom fitting.

## Already done
- [x] Only products with photos shown (787) — PR #8
- [x] Cost-price descriptions cleared (9) — 2026-10-13
- [x] Auth proxy fix (stuck-loading for returning visitors) — PR #9
- [x] 3:4 top-anchored card crop — PR #10, live
- [x] Jev review of all 3,676 descriptions

## P0 — Diwali catalogue (target: by Mon 19 Oct)
Without the right 50 products nothing else matters, and they take your time to pick.
1. [ ] **Remove supplier names/codes** from the 10 flagged descriptions (security; 30 min).
2. [ ] **Diwali shortlist with Jev:** score the 787 visible products for festive / wedding /
       party wear, drop items with no stock, rank ~120 candidates.
3. [ ] **Pick sheet:** a local page of the candidates (photo, name, price, stock) where you
       tick 50 and export the IDs. *You pick, about 1 hour.*
4. [ ] **Curation switch:** a `storefront_listed` flag on `products`; the storefront shows only
       listed products that have photos. Set it for your 50. To expand later, flip more flags
       (an admin toggle comes later, P5).
5. [ ] **Polish the 50:** clean descriptions (remove AI-caption tone and `**` markdown), check
       category/fabric, tag occasion/work/package with Jev. *You approve the drafts.*

## P1 — Shell and grid (target: Fri 23 Oct)
6. [ ] **Copy fixes:** "handpicked with love" everywhere (incl. shop subtitle "Handcrafted
       garments, thoughtfully made"); hide the BrandStory "[Brand / store photo]" placeholder;
       remove the gap under the hero; fix `scrollbar-hide`.
7. [ ] **Colours as tokens:** gold / white / brown, no hardcoded hexes.
8. [ ] **Rotating promo line:** free shipping over ₹5,000 · Diwali collection is live ·
       WhatsApp us for help and custom fitting · first-order discount.
       *Note:* there's no online checkout yet, so the discount has to be honoured on WhatsApp
       or in store (e.g. a code to mention). Confirm before it goes live.
9. [ ] **Header:** search box; category row; a **Diwali** tab linking to the curated set.
10. [ ] **Grid:** 4 columns on desktop / 2 on mobile, flat cards, real badges (New, Only X left, Sold out).

## P1b — Diwali online payments bridge (target: Sat 25 Oct)
See `tasks/checkout-shipping-plan.md` Phase A and `tasks/accounts-setup.md`.
10a. [ ] CA confirms selling through the website, UP only, under composition. *You.*
10b. [ ] Cashfree + Shiprocket accounts (KYC). *You.* Real Terms/Privacy pages: approved 2026-10-23 (`feat/cashfree-readiness`).
10c. [ ] Shipping policy says UP only, ₹99 below ₹5,000; checkout blocks non-UP addresses.
10d. [ ] Flow: WhatsApp order → Cashfree Payment Link → Bill of Supply → Shiprocket booking → tracking on WhatsApp.

## P2 — Home page (target: Wed 28 Oct)
11. [ ] **Category band:** small rounded icons under the header (product-photo crops).
12. [ ] **Hero slider:** full width, 3–5 Diwali slides made from the best product photos,
        headline and button as text over the image. Slides live in a config file.
13. [ ] **Rails:** "Diwali Edit" first, then one row per main category in the curated set.
14. [ ] **Trust row** (handpicked with love, easy returns, WhatsApp help, free shipping over ₹5,000);
        the About section moves below the products; contact cards with map and hours.

## P3 — Product page (target: Sun 1 Nov)
15. [ ] **Size guide** opens in a modal on the page.
16. [ ] **Structured details table** (occasion, work, what's included, blouse stitched or not)
        for the 50, from P0 step 5.
17. [ ] **Sticky add-to-cart bar**, "Ask on WhatsApp" button, "More like this" row.

## Buffer and launch (2–7 Nov)
18. [ ] Full pass on phone and desktop, fixes, then announce (WhatsApp community / Instagram).
        Diwali is Sun 8 Nov.

## After Diwali (P4–P5)
19. [ ] **Shop filters:** fabric filter bug, options greyed out when they still have matches,
        customer-facing category groups, separate size groups (kids / adult / waist).
        Low urgency while only 50 products are shown.
20. [ ] **Online checkout / order placement** (prepaid, UP only) and a real first-order discount code. See `tasks/checkout-shipping-plan.md` Phase B.
21. [ ] **Expand the catalogue:** admin toggle for `storefront_listed`, then grow past 50
        category by category.
22. [ ] **Lifestyle photos** for the hero and About; swap them into the slider config.
23. [ ] **Jev tagging for the whole catalogue** (`tasks/future-jev-catalogue-tagging.md`);
        rewrite the 451 descriptions flagged for rewriting.
24. [ ] **Guard against leaks:** admin-form warning when a description contains cost, MRP or a supplier name.

## Your tasks, by date
- **By ~Oct 17:** pick the 50 Diwali products from the pick sheet.
- **By ~Oct 19:** approve the polished descriptions and tags for the 50.
- **Before P1 #8 goes live:** confirm how the first-order discount is honoured (amount + how to claim).
- **Anytime:** lifestyle photos (not blocking Diwali).
