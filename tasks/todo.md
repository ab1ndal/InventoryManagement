# Todo

Pruned 2026-10-29. Finished work lives in git history / PRs; this file keeps only what is open plus the
reference facts still needed.

## ⏭ NEXT, HIGH PRIORITY: real-money payment test on production

Removes the biggest go-live risk without shipping anything. Owner at /admin/online-orders + phone for UPI (~10 min):
1. Owner switches Online checkout ON.
2. Claude places an order for a cheap item in Chrome; owner approves a small real UPI payment.
3. Verify: order PAID via the production webhook, shop "new order" email + customer email arrive, payment in the
   Cashfree production dashboard, `www.` domain accepted by Cashfree.js in production mode.
4. Owner cancels in admin with refund to original; verify the refund on production (refund-sweeper completes the leg).
5. Checkout OFF again (or stay on if all passed).
Option: ship that order instead of cancelling (covers the test parcel too, minus the refund test).

**Progress 2026-10-30:** first real order WEB-000006 paid on production (₹110 = shipping; WEB500 zeroed the
kurti). Webhook, paid status, shop + customer confirmation emails all worked; Cashfree shows ₹110 unsettled, T+1,
due 31 Oct 8 PM. Shiprocket create failed (missing `billing_last_name` key) → fixed PRs #107/#109, deployed.
Owner retries Process on 2026-10-31. PR #110 (no automatic default courier) open: merge + deploy BEFORE that retry.
Refund leg of this test not exercised (order is being shipped instead).

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
- Deploy: `supabase functions deploy <fn> --use-api --import-map supabase/functions/deno.json` (`--no-verify-jwt`
  for all except admin-order-action). Secrets propagate without redeploy. Migrations: `npm run migrate` from the
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
- [ ] Curate Wedding / Festive collections (hidden until then); Kids pending photos.
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
- Catalogue tagging with Jev: `tasks/future-jev-catalogue-tagging.md`.

## Other

- WhatsApp Community marketing and event promo copy: `tasks/whatsapp-community.md`.
- Storefront action plan (Diwali 8 Nov 2026): `tasks/storefront-action-plan.md`.
