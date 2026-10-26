# Todo

## ONLINE ORDERS: built, awaiting go-live (2026-10-24)

Live DB has every migration (atomic writes, online orders, r7, refunds, ship); `checkout_live = false`.
Merged + deployed: free-shipping nudge (#39), in-store atomic billing + product/customer delta edits (#46),
server functions + admin Online Orders screen (#47). Storefront pages + policy text merged in PR #58
(2026-10-24, checkout still behind the switch). **Edge Functions deployed 2026-10-25** (all 9 ACTIVE v1);
pg_cron/pg_net on, Vault secrets + CRON_SECRET set, 3 cron jobs scheduled.
Deploy gotcha: `supabase functions deploy <fn> --use-api --import-map supabase/functions/deno.json`
(without `--import-map` the server bundler can't resolve `@supabase/supabase-js`).

### Reference facts
- Names: website/brand = **Bindal's Creation**; legal/GST name everywhere else = **Bindals Creation**
  (bills/labels BINDALS CREATION). Site footer/Terms/Privacy say "Bindals Creation (Prop. Pooja Bindal)".
- Address: always *58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001*. The GST record's
  "Subhangini Fancy Saree" is a different shop: never use it. GST screenshots in `docs/` (untracked).
- Cashfree: KYC passed 2026-10-24, no video KYC needed; account manager Saurabh Kumar. Owner guide:
  https://claude.ai/artifact/XypgAiSTZZFiUNMJBFRBth

### Go-live checklist (owner + controller, in order)
1. Owner puts the remaining secrets in Supabase (never chat): CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET,
   CASHFREE_ENV=sandbox (blocked: Cashfree dashboard region restriction, see CASHFREE section), and after
   Shiprocket KYC + API user + pickup location `Shop`: SHIPROCKET_API_EMAIL, SHIPROCKET_API_PASSWORD,
   SHIPROCKET_WEBHOOK_TOKEN. Already set 2026-10-25: CRON_SECRET, IP_HASH_SALT, SITE_URL, ALLOWED_ORIGIN,
   GMAIL_USER, GMAIL_APP_PASSWORD (Gmail send verified).
2. [X] Deploy functions (2026-10-25): `--no-verify-jwt` for checkout-quote, create-order, order-status,
   cashfree-webhook, run-jobs, courier-status, refund-choice, refund-sweeper; admin-order-action with JWT on.
   Redeploy after secret changes is NOT needed (secrets propagate without redeploy).
3. [X] pg_cron 1.6 + pg_net 0.14 enabled; Vault `online_orders_project_url` + `online_orders_cron_secret`
   (= CRON_SECRET function secret); `schema/golive_online_orders_cron.sql` applied (2026-10-25).
4. Cashfree dashboard webhook → cashfree-webhook URL; Shiprocket webhook →
   `https://www.bindalscreations.com/hooks/courier-status` with x-api-key token.
5. Revert `b4a5e49` (restores Account → Order history).
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

## STOREFRONT: open items (pruned 2026-10-25)

Branch `fix/storefront-polish-oct25` (not pushed yet) holds the 2026-10-25 owner batch: ring-free header
logo, footer split (Shop / Explore), Load more after 48 products, "Last piece in this design", tax line
"Final price", ₹0 products hidden (RLS, live), colour picks swap the photo, Size Guide diagram, About copy
rewrite + CC stock photo, Wedding/Festive hidden, contact placeholders hidden, /customize page + hero
slide 2 + home band + PDP link + FAQ, lint cleared, cart/wishlist flaky tests fixed.
Review findings + triage: `tasks/site-review-2026-10-25.md`.

**Owner (content / decisions)**
- [ ] Photos of 2-4 custom pieces already made (customer reference + finished piece) for /customize. Top trust fix.
- [ ] Real shop photos: storefront + interior (Contact), shop/tailor photo for About (replaces CC stock).
- [ ] Fix BC25022's price in admin (₹0, hidden from the storefront until then).
- [ ] Decide: product names back on cards? "Diwali Glam" name? sentence-case page titles? Inter body font?
- [ ] First-order discount terms (amount + how to claim) before it goes on the promo line.
- [ ] Optional: Diwali 50 swaps via `tasks/diwali-pick-sheet.html`.

**Build later** (details in `tasks/site-review-2026-10-25.md`)
- [ ] PDP mobile: one sticky action; beige add-to-cart looks disabled.
- [ ] "More like this" shows men's coat suits under women's 3-pc suits ("Suit (3 Pc)" mixes both).
- [ ] Home: fewer repeating rails; trust bar as a plain fact strip; collections index made visual; nav taxonomy.
- [ ] Mobile footer: compact accordions.
- [ ] Filters cleanup (fabric bug, greyed options, size groups), after Diwali.

## CUSTOM TAILORING (owner 2026-10-25: main differentiator, take orders now)

- [X] Phase A live on the branch: `/customize` (WhatsApp opener, call, email), terms in Terms/Returns
  "Custom orders", nav + promo + hero slide 2 + home band + PDP link + FAQ.
- [ ] Owner: take requests on WhatsApp; quote; advance and balance by Cashfree Payment Links made in the
  dashboard (needs dashboard access, see Cashfree blocker below).
- [ ] CA: own-fabric stitching as a service; does the advance create a time of supply (receipt voucher)?
  HSN/SAC codes.
- [ ] Full build (upload form, status page, admin, payment links via API): `tasks/customization-plan.md`
  phases 2-9; all owner questions answered there. When setting the Cashfree webhook, also tick
  PAYMENT_LINK_EVENT.

## PRODUCT DESCRIPTIONS + TAGS (in progress)

Source of truth: `tasks/description-revamp-plan.md` and `scripts/describe/README.md`.
Done: pilot 20 descriptions written to prod (ai_reviewed); tag vocab approved for all 52 categories;
`tag_vocab` + `product_tags` + `replace_product_tags` live (PRs #65-67); mockup-generator writes tags for
new products.
- [ ] Owner: review pilot-20 tags (page https://claude.ai/artifact/E8SaPSKde8J1p8W2yeZkpc), then write them.
- [ ] Admin product form tag picker (`replace_product_tags`, scope 'all').
- [ ] Batches of the other ~767 products (about 150 each, each reviewed on its own page).
- [ ] Then PDP detail rows + Occasion and Work filters.

## CASHFREE / LEGAL (owner actions)

- [ ] **BLOCKER 2026-10-25:** Cashfree dashboard "Access restricted in your region" when logging in from the
  US. Sandbox keys, webhook URL and live keys need someone in India to log in, or Saurabh to allow non-India
  access (email drafted). Avoid a VPN while the account is under review.
- [ ] Confirm the Cashfree bank-account step (dashboard "Next Steps 1/2").
- [ ] CA: composition shop selling online intra-state from its own site; HSN (6210 on record vs 6204/6211/6203).

## RETENTION (after checkout goes live)

- [ ] Custom SMTP before magic-link login goes to prod (orders already mail via Gmail).
- [ ] Abandoned-cart emails (signed-in customers).
- [ ] Liked-item emails (back in stock, price drop); needs consent + unsubscribe.
- [ ] Later, only if demand shows: COD with a surcharge and OTP/WhatsApp confirmation.

## PARKED: online seller = regular-scheme LLP (2026-10-20)

Owner chose UP-only sales from the composition shop instead. Revive only for India-wide delivery:
SANTOSH GLOBAL LLP (GSTIN 09AFKFS5575H1ZC). Needs an LLP current account, gateway/courier KYC in the LLP's
name, GST tax invoices instead of Bills of Supply, and CA answers on stock transfer and related-party
pricing. CA questions doc: https://claude.ai/code/artifact/342df0ee-b022-4959-86c6-dc0367787dfa

## Other

- WhatsApp Community marketing and event promo copy: `tasks/whatsapp-community.md`.
- Storefront action plan (Diwali 8 Nov 2026): `tasks/storefront-action-plan.md`.
