# Todo

## ONLINE ORDERS: built, awaiting go-live (2026-10-24)

Live DB has every migration (atomic writes, online orders, r7, refunds, ship); `checkout_live = false`.
Merged + deployed: free-shipping nudge (#39), in-store atomic billing + product/customer delta edits (#46),
server functions + admin Online Orders screen (#47). Edge Functions are in the repo but **not deployed**.
Held branch: `feat/online-orders-storefront` (live checkout UI, order/track/account/refund pages, policy text
for courier-rate shipping) — merge at go-live so policy wording matches what customers pay.

### RESUME HERE (session ended 2026-10-24)
- **Names (owner 2026-10-24):** website/brand name = **Bindal's Creation** (no s; matches logo; domain
  bindalscreations.com unchanged). Legal/GST name everywhere else = **Bindals Creation** (bills/labels in caps
  BINDALS CREATION). Shipped in PRs #49, #50, #51.
- **Cashfree onboarding** (tab open in Claude-in-Chrome): steps 1–2 done (brand "Bindals Creation", category
  Family Clothing, turnover ₹10–50 L, Collect Payments, Website https://www.bindalscreations.com, no test
  login). **Step 3 KYC next**: owner enters business PAN, signatory (Aadhaar OTP), beneficial owner
  (Pooja Bindal 100%); Claude can fill Principal Place of Business; then GST certificate upload; step 4 bank.
- **GST facts (screenshots in `docs/`, untracked):** legal name POOJA BINDAL, trade name Bindals Creation,
  Proprietorship, Composition. GST principal place = *H NO-23, MIRJAJAN-58, Subhangini Fancy Saree, SIHANI GATE,
  Chandrapuri, Ghaziabad, UP 201001*. Owner 2026-10-24: same physical shop as the site address; canonical
  short address = *58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001* (site already uses
  it, no change). "Subhangini Fancy Saree" is a different shop: never use it. Cashfree PPOB: accept the GST
  prefill if it comes; if typed by hand, use the short address.
  Owner to decide: show "Bindals Creation (Prop. Pooja Bindal)" on bills + footer; ask CA about HSN (6210 on
  record vs 6204/6211/6203 for ethnic garments).
- **Held branch `feat/online-orders-storefront`** now conflicts with the name changes (policyContent.js,
  footer/SEO) — rebase on main and re-run tests before merging at go-live.
- Guide doc for the owner: https://claude.ai/artifact/XypgAiSTZZFiUNMJBFRBth (setup steps + what remains).

### Go-live checklist (owner + controller, in order)
1. Owner: Cashfree account active (sandbox keys first), Shiprocket KYC + API user + pickup location `Shop`,
   Gmail app password for bindalscreations@gmail.com. Owner puts secrets in Supabase (never chat):
   CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, CASHFREE_ENV=sandbox, SHIPROCKET_API_EMAIL,
   SHIPROCKET_API_PASSWORD, SHIPROCKET_WEBHOOK_TOKEN, GMAIL_USER, GMAIL_APP_PASSWORD, ALLOWED_ORIGIN,
   SITE_URL, IP_HASH_SALT, CRON_SECRET.
2. Deploy functions: `--no-verify-jwt` for checkout-quote, create-order, order-status, cashfree-webhook,
   run-jobs, courier-status, refund-choice, refund-sweeper; admin-order-action with JWT verification on.
3. Enable pg_cron + pg_net; Vault secrets `online_orders_project_url`, `online_orders_cron_secret`; then run
   `schema/golive_online_orders_cron.sql` by hand.
4. Cashfree dashboard webhook → cashfree-webhook URL; Shiprocket webhook →
   `https://www.bindalscreations.com/hooks/courier-status` with x-api-key token.
5. Merge `feat/online-orders-storefront`.
6. Sandbox end-to-end with checkout switched on for testing only: pay (UPI testsuccess@gocash), shelf check
   1 of 2 unavailable, Process (AWB/label/BoS), refund both choices, cancel, tracking webhook. Settle the
   UNVERIFIED API items (api notes files) against real responses.
7. Switch CASHFREE_ENV=production + live keys, superadmin flips "Online checkout" on in /admin/online-orders.

### Follow-ups (non-blocking)
- "Send back to To-check" for an order stuck in processing after AWB (ship builder gap 1).
- Courier fallback if quoted courier refuses; Shiprocket duplicate order_id / update-keeps-shipment checks.
- BillTable/BillingForm: block edit/cancel/delete of online (Website) bills; hide Website from the in-store
  payment picker (review S5).
- `salesmethods` serial sequence lags its rows (pre-existing; new in-store method inserts would collide).
- Two Shiprocket token-store helpers (pay context.ts vs ship process.ts) — consolidate.

## Website review with Anushka (2026-10-19), in priority order

Deadline driver: Diwali 8 Nov 2026. Until real checkout ships, Diwali orders use the
WhatsApp + Cashfree Payment Link bridge (`tasks/checkout-shipping-plan.md` Phase A).


New Comments (done 2026-10-20, PR #31 merged + live):

1. [X] We need to make the logo appear more prominantly at all the locations it appear (header/footer). it should scale with the zoom. It should be more visible for the favicon as well
   → header uses monogram crop (rem-sized), footer 2x in native gold, new favicon/apple/192/512 icons.
2. [X] Remove AI tells like eyebrows for the sections
3. [X] in the cards, the "title" is not providing much info. The material is already there and people can see the product
   → visible title dropped; name kept as image alt / screen-reader text.
4. [X] Lets make a new view list of everyday items like cordsets, shirts, kid's collection
   → /collections/everyday = cord sets, kurtis, shirts, T-shirts, tops + home rail. **Kids pending: 0 kids products have photos.**
5. [X] Show some photo caroasal for mens - 1 to 2 categories [ Kurta Pajama, Sherwani, Shirts]
   → Sherwani + Kurta Pajama home rails (+ collections); shirts live in Everyday.
6. [X] in the Size listing where we have XL, L - Add all from XS to 2XL at the very minimum, add additional plus or minus sizes if they are in addition to there. Show the ones not in stock as out of stock.
7. [X] In the details, replace Sizes with available sizes

### P0: quick wins before Diwali (this week)

- [X] Rename "Diwali Edit" → "Diwali Glam" (2026-10-19).
- [ ] More hero carousel images (3 today, looks sparse). **Blocked on owner supplying photos**
  (product-only or lifestyle, either is fine). Add them, then review the look together.
- [X] "More like this" ranked by category/price/colour/fabric, sold-out dropped, all 8 visible on
  desktop, "View all" link, small categories borrow from their header group (2026-10-19).
- [X] Category pages get /shop filters + sort + paging, scoped to the collection (2026-10-19).
- [X] Home thumbnail band shown on phones only (it repeated the header text row on md+).
- [X] Men's "Short Kurta" (SK) moved from Kurtis to Men. Owner may rename the DB category
  "Men's Short Kurta" so the card badge is unambiguous.

### Product descriptions + tags revamp (paused 2026-10-19, waiting on owner review)

Full context: `tasks/description-revamp-plan.md` (read its "Resume here" section first) and
`scripts/describe/README.md`. No DB writes have happened yet.

- [ ] Owner: review the 20-product pilot page https://claude.ai/artifact/7ft65naksZtpdYTVPpDJGe.
  Each product has Approve / Needs changes / Reject plus a comment box. Comments save to the
  page itself (collection `feedback`, one doc per product ID).
- [ ] Claude: read the feedback (ArtifactData `list` on collection `feedback` of that URL), fold
  it and the known fixes into `scripts/describe/prompt.md`, re-run the 20, and republish the
  page for a second look.
- [ ] Once the 20 are approved: draft the tag vocab per category, then run the other ~767 live
  products in batches of about 150 (Codex Terra, Sonnet for flagged ones), each batch
  reviewed on its own page.
- [ ] After approval: migration for `tag_vocab` / `product_tags`, write the descriptions and tags,
  then PDP detail rows plus Occasion and Work filters.

### P1: unblock real checkout (owner actions, not code)

**Owner decision 2026-10-20: the shop sells online itself, stays on the composition scheme,
delivers within Uttar Pradesh only** (composition dealers can't make inter-state supplies,
CGST s.10(2)(c)). LLP route parked (section below) until India-wide delivery is wanted.
Online orders get a Bill of Supply from the shop, same as in-store.

- [ ] UP-only checkout + policy/FAQ/trust-bar wording: branch `feat/checkout-up-only-v2`
  (PR #14 rebased + 3 missed "across India" spots).
- [ ] Cashfree KYC in the **shop's** name (proprietor Pooja Bindal, shop's current account).
  Signup opened 2026-10-23 at merchant.cashfree.com (direct, not a partner link); OTP step pending.
  Submit the website for review only after `feat/cashfree-readiness` (real Terms/Privacy) is live.
- [X] Courier: **Shiprocket** (decided 2026-10-20). Owner steps: `tasks/accounts-setup.md` §3;
  integration spec: `tasks/checkout-shipping-plan.md` Phase C.
- [ ] Ask CA to confirm: composition shop may sell online intra-state from its own website.

### P2: checkout build (Phase B of `tasks/checkout-shipping-plan.md`)

- [ ] Prepaid only, **no COD** (costlier, couriers block it in high-return pincodes). Cashfree
  covers UPI, RuPay, Visa, Mastercard.
- Decided 2026-10-23: gateway = **Cashfree** (replaces the 2026-10-20 Razorpay pick; reasons in
  `tasks/checkout-shipping-plan.md` "Gateway decision"). Also rejected YouPI-PG (github.com/youpi-pg/YouPI-PG):
  confirms payments by scraping bank SMS/notifications with open bugs that can mark unpaid orders
  paid, no license, repo ~1 month old, APK reads every SMS incl. OTPs, ~20 txn/day, no cards/refunds.
- [ ] Two paths: guest checkout (nothing saved) and signed-in checkout (cart + address saved;
  magic-link login already shipped).
- [ ] Shipping estimate by pincode at checkout (Apple-style), via the Shiprocket rate API. Use 2–3
  weight classes instead of per-item weights: heavy (lehengas), medium (sarees), light.
  Cart keeps "Shipping calculated at checkout" until then.
- [ ] Online orders get a Bill of Supply from the shop (reuse the existing BoS billing; design
  pass on creating the bill from an online order).

### P3: retention emails (after checkout ships)

- [ ] Custom SMTP (also required before magic-link login goes to prod).
- [X] Wishlist saved to signed-in customers' accounts (PR #33, merged 2026-10-21).
  `schema/migration_wishlist_items.sql` applied to prod 2026-10-21.
- [ ] Abandoned-cart emails (signed-in customers with items left in the cart).
- [ ] Emails about liked items (back in stock, price drop). Needs consent + unsubscribe link.

### Later, only if demand shows

- [ ] COD with a surcharge (plus OTP/WhatsApp confirmation).

## PARKED 2026-10-20 — Online seller = regular-scheme company (owner decision 2026-10-14)

Superseded for now: owner chose UP-only sales from the composition shop (see P1 above).
Revive this when India-wide delivery is wanted.

Online orders will be sold by SANTOSH GLOBAL LLP (GSTIN 09AFKFS5575H1ZC, regular, UP; PAN AFKFS5575H;
registered at the shop address; same owner). Delivery across India; PR #14 (UP-only) closed.
Fallback if CA finds the LLP route too heavy: UP-only via the composition shop (reopen PR #14), later
move the shop to the regular scheme. CA questions doc: https://claude.ai/code/artifact/342df0ee-b022-4959-86c6-dc0367787dfa

- [ ] LLP current bank account in the LLP's name (GST Rule 10A; Amazon penny-drop failed on the personal
  joint account 2026-07-24, see ../amazon_listing/tasks/todo.md). Needed before gateway KYC.
- [ ] After CA picks option A/B/C: swap seller identity on the site (or reopen PR #14 for B).
- [ ] Swap seller identity on the site: footer line (`StorefrontFooter.jsx:156`, currently the shop's
  composition GSTIN), Terms/Privacy drafts, shipping/returns policy pages, Contact page.
- [ ] Gateway + courier KYC in the new company's name (not the shop's).
- [ ] Online orders get a GST **tax invoice** from the new company (not a Bill of Supply). Decide where
  those invoices are made (this app's billing vs separate) — needs a design pass.
- [ ] CA questions: (1) stock moving from the composition shop to the new company — a composition
  dealer issues a Bill of Supply, so the company gets no input credit and pays full GST on the
  online sale; (2) GST rate on apparel by price slab, and whether site prices stay GST-inclusive;
  (3) related-party pricing between the two businesses.

## DONE: storefront fixes batch (2026-10-14, branch fix/storefront-sizes-auth-footer)

- [X] Signed-in customers saw empty shop (no `authenticated` read policy) — migration
  `schema/migration_storefront_authenticated_read.sql` APPLIED to prod 2026-10-14; non-admin
  authenticated = 787 products / 0 bills, admin = 3,676
- [X] Sizes: `lib/sizes.js` formatSize/compareSizes; PDP, cart, checkout, WhatsApp text, shop filter
  show "XS, S, M, L, XL, 2XL…" in that order. Letter sizes drop the "|42" number because it
  disagrees with the size guide (guide XL bust 40 vs code XL|42) — owner may want guide fixed.
- [X] Footer shop links reuse NAV_LINKS; CartDrawer `inert` fixed; guest cart drops hidden products
- [X] Plus sizes up to 6XL: promo line + trust row (5 signals)
- [X] Imageless side effects checked: PDP shows "Product not found"; 0 server cart rows affected;
  home band uses fixed collections (all populated), so the ">=10 products" worry is obsolete

- [X] Shop size filter listed all 55 variant sizes; now only the 18 visible products have (2026-10-20).

## DONE: Andaaz-style left filter sidebar on /shop (2026-10-14, PR #24 merged 5861d50)

Spec `docs/superpowers/specs/2026-10-14-shop-filter-sidebar-design.md`, plan
`docs/superpowers/plans/2026-10-14-shop-filter-sidebar.md`, branch `feat/shop-filter-sidebar`.

- [X] Root cause: un-paged productsizecolors queries hit PostgREST 1000-row cap (fabric mapping fine)
- [X] RPC `get_shop_available_options` applied to prod 2026-10-14 + verified as anon
- [X] Track A (hook) + Track B (sidebar UI) merged; product-query race fixed (owner asked)
- [X] Tests (only baseline 6 fail), build, Playwright: 787 → Blue 210 → +XL 50 → <₹2k 29 = SQL truth
- [X] PR #24 merged; live smoke on bindalscreations.com/shop: same counts, no page errors

- Follow-ups: size labels show raw codes ("XL|42") on shop AND product page — pick a display
  format site-wide; CartDrawer passes `inert=""` (React 19 ignores it, closed drawer keyboard-reachable).
- Pre-existing, NOT fixed: no read policy on products/productsizecolors/categories for
  `authenticated` role → a magic-link-signed-in customer would see an empty shop.

## Overnight run 2026-10-13 → 14 (owner said "auto approve and implement overnight")

Rules: merge only code PRs that pass tests + screenshot checks (each revertable with one revert).
Do NOT apply prod schema changes, publish UP-only/legal text, or touch accounts.

- [X] PR #11 plans merged; PR #12 Diwali Edit collection (/collections/diwali, 50 Jev picks) merged
- [X] Supplier names/codes stripped from 9 descriptions (backup in session scratchpad)
- [X] Header: rotating promo line + category row + mobile drawer — PR #16 merged
- [X] Header categories → collection pages (sarees/lehengas/suits/kurtis/gowns/men) — PR #17 merged
- [X] 4-col grid, flatter cards, Sold out badge (low-stock badge dropped: 78% of items have 1-3 pcs) — PR #18 merged
- [X] Diwali 50 description rewrites drafted: `tasks/diwali-description-drafts.md` (owner approval; 25 have notes)
- [X] Product page: size guide modal, lightbox, details table, sticky bar, WhatsApp ask, more like this, single-option auto-select — PR #20 merged
- [X] Home: category band → hero slider (product photos) → Diwali/New/category rails → trust row → brand story — PR #21 merged
- [X] Live smoke test after deploy 7f33c74: /, /shop, /collections/diwali, /collections/men, /product/BC252742, /size-guide, /cart, /checkout, /policies/shipping — no page errors

### Waiting on owner (morning)

1. Review the Diwali 50 (`tasks/diwali-pick-sheet.html`), send back IDs if you change any.
2. Approve description drafts (`tasks/diwali-description-drafts.md`; 25 flagged).
3. ~~CA questions → merge PR #14~~ superseded 2026-10-14: online seller is the regular-scheme company (see top).
4. ~~Start Razorpay + Delhivery One KYC~~ superseded: Cashfree + Shiprocket in the shop's name (`tasks/accounts-setup.md`).
5. ~~Review `tasks/legal-drafts.md` (Terms/Privacy).~~ Approved + published 2026-10-23 (`feat/cashfree-readiness`).
6. First-order discount terms (amount + how to claim) before adding it to the promo line.

### Next build items (action plan)

- Filters cleanup (fabric bug, greyed options, size groups) — after Diwali.
- Shop page left sidebar; `/shop` URL filters (category links currently use collections instead).
- Footer still lists old category names (Salwar Suits, Dupattas); align with NAV_LINKS.

- [X] ₹99 shipping policy wording fixed — PR #13 merged
- [X] UP-only checkout validation — PR #14 open, HOLD until CA confirms
- [X] Terms/Privacy drafts: `tasks/legal-drafts.md` (owner/legal review, not on site)
  Resume: `gh pr list`; `git worktree list`; `gh auth switch -u ab1ndal` before pushing, switch back to abindal-nyase after.

## Storefront revamp — ACTION PLAN: `tasks/storefront-action-plan.md` (Diwali 8 Nov 2026); details in `tasks/storefront-revamp-plan.md`

The image filter below is Phase 0 of that plan.

## Storefront: show only products with storage images (DONE 2026-10-13)

Applied to prod 2026-10-13. Verified: anon REST count 787, service role 3,676,
`get_shop_filter_options` still works, policy EXISTS executes in ~28 ms.

Live data (2026-10-13): 3,676 products, 787 with `productimages` rows, every
row a valid object in storage (0 dangling), 745 of the 787 in stock.

Proposed: one migration, no client changes. Replace anon policy
`storefront anon read products` (`using (true)`) with
`using (exists (select 1 from productimages pi where pi.productid = products.productid))`
plus `create index productimages_productid_idx on productimages (productid)`
(none exists today). Covers all ~8 storefront product queries and the
`get_shop_filter_options` RPC (security invoker). Admin unaffected (`admin_only`
policy via `is_admin()`).

- [X] Owner decision 2026-10-13: keep out-of-stock products visible (787, images-only).
- [X] Write `schema/migration_storefront_products_with_images.sql`
- [X] Apply to prod, verify anon count = 787 and admin count = 3,676
- [X] Side effects checked 2026-10-14 (see top); imageless product URL becomes "not found"; cart items for
  imageless products lose price in `cartApi.fetchLiveVariantData`; home category
  tiles need >=10 products, so some categories may disappear

## Event promo copy — Festive Pop-Up, Day 2

Written 2026-08-01 for Day 2 on **Sunday 2 August 2026, 12 Noon – 6 PM**,
R-14/84, Raj Nagar, Ghaziabad · +91 98108 73280. Raksha Bandhan / Teej
collection: sarees, suits, cord sets, bedsheets, silver rakhi.

**Two different addresses — do not conflate them:**

- **Shop** (permanent): 58, Sihani Gate Market, Near Durga Bhabhi Chowk,
  Ghaziabad, UP 201001. This is where customers have actually been, so it is the
  right recall hook in outreach and the right address in the Community profile.
- **Pop-up** (this event only): R-14/84, Raj Nagar, Ghaziabad — a home venue.
  Always label it as a separate, temporary location or customers will turn up at
  the shop, or at Raj Nagar expecting the shop.

Day 1 drew 4 visitors, 2 of them relatives — a distribution failure, not a
product one. A home venue also needs personal invitation rather than broadcast,
which is why the 1:1 messages below matter more than Status or Instagram.

Reusable for the next event: swap dates and the collection line.

### Personal invite — regulars (Hinglish)

> Namaste 🙏 [Name] ji
>
> Aaj humare Festive Pop-Up ka **aakhri din** hai — Raksha Bandhan aur Teej ke liye special collection.
>
> 📅 Aaj, Ravivar · 12 Noon – 6 PM
> 📍 R-14/84, Raj Nagar, Ghaziabad
>
> Sarees, suits, cord sets, bedsheets aur silver rakhi. Silver rakhi jaldi khatam ho rahi hai.
>
> Aap zaroor aaiye — parivaar aur doston ko bhi laaiye 😊
> 📞 +91 98108 73280

### Personal invite — regulars (English)

> Namaste 🙏 [Name]
>
> Today is the **last day** of our Festive Pop-Up — our Raksha Bandhan and Teej collection.
>
> 📅 Today, Sunday · 12 Noon – 6 PM
> 📍 R-14/84, Raj Nagar, Ghaziabad
>
> Sarees, suits, cord sets, bedsheets and silver rakhis. The silver rakhis are going quickly.
>
> Do come by — bring your family and friends 😊
> 📞 +91 98108 73280

Add one personalised line per recipient ("aapke liye kuch achhi sarees rakhi
hain", or a reference to their last purchase). That line is what separates an
invitation from a forward, and it roughly doubles response.

### Follow-up — Day 1 visitors who did not buy

> Namaste 🙏 Kal aane ke liye dhanyavaad!
>
> Aaj humara aakhri din hai, 12 se 6 baje tak. Kuch aur pieces bhi laga diye hain.
>
> Agar aapko kuch pasand aaya tha, bataiye — main aapke liye alag rakh doonga.
>
> 📍 R-14/84, Raj Nagar, Ghaziabad

The offer to set something aside is the hook — they have already seen the
collection, so urgency alone will not move them.

### WhatsApp Status overlay

> **AAJ AAKHRI DIN**
> 12 – 6 PM
> R-14/84, Raj Nagar
> Sarees · Suits · Silver Rakhi

Post twice — around 9–10 AM and again around 2 PM as a "still open till 6"
nudge. Status expires from view quickly, so twice does not read as spam.

### Instagram caption

> **Last day!** ✨ Our Raksha Bandhan & Teej pop-up wraps up today.
>
> Sarees, suits, cord sets, bedsheets, and handpicked silver rakhis — all in one place.
>
> 📅 Today, Sunday 2 August · 12 Noon – 6 PM
> 📍 R-14/84, Raj Nagar, Ghaziabad
> 📞 +91 98108 73280
>
> All are welcome — bring your friends and family 🌸
>
> #BindalsCreation #RakshaBandhan2026 #Teej #Ghaziabad #RajNagar #FestiveCollection #SilverRakhi #EthnicWear #PopUpShop #GhaziabadShopping

Feed post *and* a story — stories outperform feed for same-day urgency.

### Order of operations

1. Get flyer + copy onto the shop phone so staff can send without waiting on the
   US-based owner
2. ~8 AM IST — Status post #1, Instagram post + story
3. 8–10 AM IST — personal messages, warmest customers first (export batches are
   already sorted that way). 40–60 sends, spaced out, never one burst
4. ~2 PM IST — Status post #2
5. After the event — begin Community seeding with batch 1

Do **not** seed the Community during the event: it adds ban risk for no
same-day benefit.

Note: WhatsApp Status only reaches people who have the shop's number saved.
Importing customer contacts does not change that — visibility is bidirectional.

---

## Community setup — name, description, seeding shortcut

An earlier WhatsApp **group** already exists (created 2025-06-15 by Aashu),
carrying the New Arrivals / order-by-DM messaging below.

**Seeding shortcut:** adding that existing group to the new Community moves all
its members into the announcement group automatically — no per-person adds, so
none of the spam-detection or report risk that manual adding carries. Members
are notified that the group joined a Community. Do this first; use the vCard
batches only to mop up customers who are not already in that group.

The old group survives as a sub-group where members can still chat. The
announcement group sits alongside it, admin-only.

**Community name:** `Bindal's Creation` — logo as the photo. Recognition is the
main defence against reports.

**Invite link:** https://chat.whatsapp.com/ErIgYB8O2Cq6z8DXYG1iCg
(Verify it came from Community info -> Invite via link, not a sub-group's invite.
The old June 2025 group's link was .../LqRuaTiFH4K4k6oQ9APtFP -- different, good.)
Pass it to the export script with `--link=` to regenerate outreach messages.

**Description** (adapted from the existing group's, plus address and hours,
which the original lacked, and a line setting the one-way expectation):

> ‼️ **New Arrivals at Bindal's Creation** ‼️
>
> Explore our latest collection in-store at Ghaziabad, India — or shop online from the comfort of your home.
>
> To place an order, message any admin directly with the **reference number, size, colour, and your complete address**.
> Minimum order quantity: 2 items
>
> 📍 58, Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001
> 📞 +91 98108 73280
>
> Only admins post here, so your chat stays clutter-free.
>
> Happy Shopping! 🛍️
>
> —
>
> नए कलेक्शन की खरीदारी करें अब घर बैठे!
>
> ऑर्डर करने के लिए किसी भी एडमिन को **रेफरेंस नंबर, साइज़, रंग, और पूरा पता** भेजें।
> न्यूनतम ऑर्डर: 2 आइटम
>
> 📍 58, सिहानी गेट मार्केट, दुर्गा भाभी चौक के पास, गाज़ियाबाद, उ.प्र. 201001
> 📞 +91 98108 73280
>
> यहाँ केवल एडमिन ही पोस्ट करते हैं।
>
> हैप्पी शॉपिंग! 🛍️

Open: how many members does the existing group have? That number decides how
much manual vCard seeding is actually left to do.

### INCIDENT 2026-08-02: account restricted after 56 outreach messages

Sending 1:1 invites via the click-to-chat page (`outreach-links.html`), the
**developer's personal Indian number** was restricted by WhatsApp after
**56 messages**. That number had WhatsApp activated only the previous day
(2026-08-01) and is the Community **owner**.

A day-old account has no trust history and a far lower ban threshold than an
established one. Never seed or bulk-send from a newly activated number.

Unaffected: the shop number (+91 98108 73280) and the developer's US number.
The shop number is a Community admin, so announcements and member management
still work. If the restriction proves permanent, recreate the Community under
the shop number while membership is still small — that is the correct owner
anyway, since a shop's customer channel should not hang off a personal number.

Cause: unsolicited 1:1 messages to recipients with no prior chat history, sent
faster than a human pace. The `wa.me` / `web.whatsapp.com/send` links reduced
each send to ~5 seconds, so 56 went out in a short window. Recipient recognition
was already weak (customers had not saved the number), which raises report
probability, and rate plus low recognition together are the exact spam profile.

The tooling optimised for speed while the guidance said to go slow. Written
pacing advice does not survive contact with a fast tool.

**Rules going forward:**

- Never send bulk 1:1 WhatsApp outreach from a personal or shop number again.
  Use the Cloud API with an approved marketing template (task 4), or a BSP.
- If manual outreach is unavoidable: hard cap ~20–25/day, spread over hours,
  and only to people with existing chat history.
- Any future outreach tool must enforce a throttle, not merely document one.
- Recovery: request review in-app; never evade with a new number, SIM, or VPN —
  evasion converts a temporary restriction into a permanent ban.

Reached before the restriction: 56 of 197, the warmest cohort (batches 1-3).

**Restriction length: 24 hours** (countdown shown in-app) — the standard
first-offence temporary restriction. Number usable again 2026-08-03.

Decisions taken:

- **Do not rebuild the Community.** The invite link
  (.../ErIgYB8O2Cq6z8DXYG1iCg) already went to 56 customers; rebuilding orphans
  it for everyone yet to click. The Community keeps working while its owner is
  restricted, because the shop number is an admin.
- **Transfer ownership to the shop number** using the developer's US number,
  which is unrestricted and was the original creator. Ownership transfer is
  known to work — it was used once already to move ownership to the Indian
  number. Not urgent at 24 hours, but correct hygiene: a shop's customer
  channel should not depend on a personal number that can be restricted.
- **Add a second admin** (Aashu or family). Single-admin dependency is what
  turned one restriction into a structural problem.
- No appeal needed at 24 hours; it lapses on its own. Appealing a short
  restriction is not worth the attention.
- **Resuming outreach:** 141 contacts remain. A 24-hour restriction is a first
  warning, and repeat offences escalate hard. Do not resume 1:1 blasting from
  any personal number — use the Cloud API path (task 4) or a BSP. If manual
  sending happens at all, cap it near 20/day to people with chat history.

### Seeding method — decided 2026-08-01: do NOT bulk-add

Customers cannot be assumed to recall the shop by name — it is one of several
they visit — and none have the shop's number saved. An unexplained group from an
unrecognised number reads as spam, and reports from people with no prior chat
history are what get a number banned. So:

| Who                                            | Method                                                |
| ---------------------------------------------- | ----------------------------------------------------- |
| Members of the old June 2025 group             | Merge the group — zero adds, zero risk               |
| Anyone who has **saved** the shop number | Direct add works                                      |
| Everyone else                                  | **Invite link**, sent in a personal 1:1 message |
| Batch 8 cold tail (20 never billed)            | Skip                                                  |

Direct-adding is earned per customer, not done in bulk.

An add is permitted when the recipient is on the default *Everyone* setting **or**
has saved the adder's number. Chat history alone does **not** unlock it — the gate
reads their address book, not the conversation. So asking customers to save the
shop number is worth doing explicitly: it unlocks both direct adds and WhatsApp
Status visibility, which is bidirectional for the same reason.

Messaging someone with no prior contact is always allowed, so the invite link
works universally. Pace those sends too — bulk unsolicited 1:1 messages from a
newly activated number carry their own spam risk.

**Personalisation beats recognition.** `vcf-export/outreach-list.csv` (written by
the export script) lists name, phone, last purchase month, and what they bought,
in warmest-first order. Naming their actual purchase re-establishes recall far
better than naming the shop:

> Namaste 🙏 **Bindal's Creation** (58, Sihani Gate Market, Ghaziabad) se —
> aapne humse July mein **kurta pajama** liya tha 😊
>
> Aaj humara Festive Pop-Up ka aakhri din hai, 12 se 6 baje.
> 📍 Pop-up sthal: R-14/84, Raj Nagar (humari dukaan se alag jagah)
>
> Naye collection ke liye humara WhatsApp group join kariye: [link]

**Consequence for priorities:** recognition is 100% at the billing counter, so
the bill QR (task 3) is the highest-quality acquisition path, not a nice-to-have.
Promote it above the member-marking UI once the event is done.

### Verified 2026-08-01: adds are gated by the recipient's privacy setting

Adding a family member from the newly-activated Indian number failed with:

> Couldn't add XXX to the community announcement group, so they were not added
> to the community. You can invite them privately to join this group.

The same person added successfully from the long-used US number. Cause: their
"Who can add me to groups" is set to *My contacts*, and the gate is evaluated
against whether **the adder** is in **the recipient's** address book. The US
number is saved there; the freshly activated Indian number is not.

Implications:

- Customers with *My contacts* set cannot be added from either number, since
  neither is in their address book. The add simply fails.
- Customers on the default *Everyone* can be added, but see an unrecognised
  number adding them — the report risk.
- WhatsApp's own error text points at the fix: invite privately.

**Do not run bulk seeding from the Indian number.** A WhatsApp account activated
the same day, immediately performing bulk group adds, is a textbook spam
signature and the ban threshold for new accounts is low. That number is also the
shop's public contact on the flyer and bills, so a ban would hurt well beyond
this Community. Let it build normal 1:1 traffic for some weeks first.

Community ownership *was* successfully transferred to the Indian number, so the
earlier note in this file that WhatsApp has no ownership transfer was wrong.

---

## WhatsApp Community Marketing

Decided 2026-08-01. Primary marketing route is a **WhatsApp Community announcement
group**, not a Channel: it can be seeded directly (Channels cannot — following is
always user-initiated), admins can see the member list, and member phone numbers
are hidden from other members. Paid 1:1 Cloud API messages are reserved for
occasional event nudges.

Rejected along the way, with reasons:

- **Channel** — not seedable, membership invisible, so no way to target
  non-followers or detect leaves.
- **Plain Group** — seedable, but exposes every customer's phone number to all
  other members. Communities solve this; Groups do not.
- **open-wa / unofficial APIs** — would need an always-on VPS holding a live
  WhatsApp Web session (this app is a client-side SPA with no server), breaks
  WhatsApp ToS, risks a ban on the business number, and still cannot add
  Community followers.
- **Broadcast lists** — 256 cap, and only reach people who saved the store number.

### Done (2026-08-01)

- [X] `schema/migration_marketing_consent_community.sql` — applied to prod.
  `marketing_consents` append-only log (RLS `admin_only` via `is_admin()`),
  `customers.marketing_opt_in`, `community_status` state machine,
  `community_status_at`. Backfilled 200 consent rows as `counter_verbal`.
- [X] `scripts/export-customers-vcf.js` — exports opted-in customers as batched
  vCard 3.0 files for contact import. Ordered by last purchase date so the
  warmest customers land in batch 1 and never-billed contacts land last;
  add risk is concentrated in the final batch. Skips existing members on
  re-run, so a partial seed can be resumed.
- [X] `.gitignore` — `vcf-export/` and `*.vcf` (exports contain customer PII).
- [X] Exported 197 contacts to `vcf-export/` in 8 batches of 25, ordered newest
  purchase first. Batches 1–3 bought within 3 months, 4–7 within 5 months,
  batch 8 is the cold tail (20 of 22 never billed).
- [X] Imported all 197 to the **owner's US iPhone** via AirDrop, 2026-08-01 PT.
  All prefixed `BC ` — search "BC" in Contacts to isolate or bulk-delete them.

### Numbers and their roles (settled 2026-08-01)

Three distinct numbers are in play. Only one means anything to customers.

| Number                                               | Role                                                     | Customer recognition  |
| ---------------------------------------------------- | -------------------------------------------------------- | --------------------- |
| Developer's US number                                | Created the Community; regular personal use              | None                  |
| Developer's personal Indian number                   | Community **owner**; WhatsApp activated 2026-08-01 | None                  |
| **+91 98108 73280** (shop, on flyer and bills) | Community **admin**                                | The only one with any |

**Sender identity barely matters; where replies land does.** Customers have not
saved any of these numbers, so WhatsApp shows raw digits whichever one sends —
recognition is not the deciding factor. Identity is carried by the *message text*
(shop name, location, and the customer's own last purchase), which works from any
number.

What actually decides the sender:

- **Replies go to the sending phone.** Price, size, and availability questions
  must reach someone who can answer during Indian shop hours.
- **Whatever number sends first is the number customers save.** Migrating a
  customer base off a personal number later is painful — WhatsApp does not move
  chat history between numbers cleanly.

So: prefer the shop number for continuity, but sending from a personal number is
acceptable when that person will field the replies. Always put
**+91 98108 73280** in the message body so there is a verifiable callback path
regardless of sender.

**Operational consequence:** the developer is in the US and the shop phone is in
India, so the developer cannot send outreach. Developer prepares the list, copy,
and invite link; whoever holds the shop phone sends. That handoff is the most
likely thing to break — get `vcf-export/outreach-list.csv`, the flyer, and the
message drafts onto that phone before each push.

Contacts were imported to the developer's US iPhone, which is useful for building
the list but not for sending. The vCards need to reach the shop phone too.

Worth checking: is the shop number on WhatsApp **Business** rather than regular
WhatsApp? Labels, quick replies, catalogue, and away messages all help a shop.
Note from `supabase/SMS_SETUP.md`: the Business app and the Cloud API cannot
share a number — currently no clash, since the API uses a separate alternate
number, but do not consolidate them later without checking.

### 1. Mark customers as Community members  — blocks repeat seeding

Without this `community_status` never advances past `not_added`, so every export
re-exports everyone and the skip logic is dead weight.

- [X] Multi-select checkbox column on `CustomerTable.js`
- [X] Bulk action: set `community_status` to `member` / `invite_pending` / `left`,
  stamping `community_status_at`
- [X] Show current `community_status` as a column so state is visible at a glance
- [X] Filter by `community_status` so "who still needs adding" is one click

Files: `src/admin/components/CustomerTable.js`, `src/admin/pages/CustomersPage.js`

### 2. Consent checkbox on customer create/edit

New customers currently get no consent record — they'd need another backfill.

- [X] Checkbox on `CustomerForm.js`: "Send store offers on WhatsApp"
- [X] On submit, write a `marketing_consents` row (`source: 'counter_form'`,
  `recorded_by`: current admin) and set `customers.marketing_opt_in`
- [X] Unchecking an opted-in customer writes an `opt_out` row — never delete or
  mutate consent history, the log is append-only by design

Files: `src/admin/components/CustomerForm.js`

### 3. Community QR on bill PDF

Cheapest recurring acquisition channel — compounds with every bill printed.

- [X] Generate QR for the Community invite link
- [X] Add to bill PDF footer with a short line of copy
- [ ] Same QR as a printed counter sign (non-code task)

Files: billing PDF generation under `src/admin/components/billing/`

### 4. Event nudge — paid 1:1 Cloud API

For occasional pushes to customers not yet in the Community. Needs a Meta
**marketing**-category template approved (1–24h); the existing `bindals_invoice`
template is Utility and cannot carry promotional content.

- [ ] Submit reusable marketing template — fixed scaffolding plus `{{1}}` name,
  `{{2}}` campaign body, `{{3}}` link, so future campaigns need no re-approval.
  Templates that are only variables get rejected.
- [ ] `send-campaign` edge function reusing existing `WHATSAPP_*` secrets;
  refuses to send when `marketing_opt_in` is false; idempotent per campaign
- [ ] `campaigns` + `channel_invites` tables for send/delivery history
- [ ] Trigger button on the Customers page — single-customer first (staff ask in
  person, converts better), bulk later

Cost: ~₹0.86/message + 18% GST, billed at **recipient** country rates, so Indian
rates apply regardless of the developer being US-based. ~₹200 for a 200-person blast.

Watch: Meta is steering marketing traffic to the **MM Lite API** and phasing out
Cloud API marketing support. Check before investing heavily here.

### 5. Data hygiene

- [ ] Fix 3 customers with 9-digit `+91` numbers, then re-run the export:
  customerid 273 (Rohit Yadav), 274 (Ruhi), 328 (Manju)

### Blocked / needs owner action (not code)

- [ ] Create the WhatsApp Community + announcement group, capture invite link.
  Name it after the shop with the logo as the photo — recognition is the
  main defence against add-related reports.
- [ ] Add the pre-existing group (created 2025-06-15) to the Community first —
  its members join the announcement group automatically, at no add risk.
- [ ] Then seed only the customers not already in that group, one vCard batch
  per day, in file order (warmest first). Watch the member list after each
  batch: several immediate exits means slow down. Consider stopping after
  batch 7 and inviting the cold tail personally.
- [ ] Verify the Cloud API sender number is `+91`, not a US number
- [ ] Confirm the WABA sold-to entity is the Indian business (GST invoicing)
- [ ] Check the WABA messaging limit before any blast — unverified accounts cap
  at 250 business-initiated conversations per 24h

---

## Migration runner: unblocked 2026-10-21

The 26 unrecorded files (all verified applied, see `tasks/migrations-audit-2026-10-20.md`)
were inserted into `_migrations` on 2026-10-21. `npm run migrate` now reports
"No pending migrations." and is the normal way to apply new files again.
New files must not contain `BEGIN`/`COMMIT`: `exec_sql` rejects transaction commands
(`0A000`). The 14 older files that have them are recorded, so the runner never replays them.

## Online signup fixed 2026-10-21

`resolve_my_customer()` failed for every first-time online shopper. There were two bugs:
- 32-char `customer_ulid` vs `varchar(26)`, fixed by `migration_fix_resolve_my_customer_ulid.sql`.
- `42702 column reference "email" is ambiguous`. RETURNS TABLE column names clash with
  unqualified customers columns, in `update_my_customer` too. Fixed by
  `migration_fix_customer_fn_variable_conflict.sql` (`#variable_conflict use_column`).
Both applied to prod. Verified in a rolled-back transaction with a temp `auth.users` row:
resolve, then update, then resolve again; ULID is 26 chars and the row links. The phone
must be E.164 (`chk_phone_format`).
