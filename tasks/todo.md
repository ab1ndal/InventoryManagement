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

### Shiprocket setup: RESUME HERE (paused 2026-10-25)
Full steps: `tasks/accounts-setup.md` §3. Shiprocket works from the US (no region block, unlike Cashfree).
- [x] Signup + business details (company "Bindals Creation", site bindalscreations.com).
- [x] Pickup address nickname `Shop` (= `PICKUP_LOCATION` in `_shared/shiprocket.ts`) saved, VERIFIED,
  primary; contact Pooja Bindal 9810873280; Mon + Wed–Sun 10:00–20:30. No OTP was asked.
  Its status toggle showed grey: check it turns on after KYC (don't flip it before then).
- [x] Public-calculator rate table recorded in accounts-setup step 5 (₹99 flat fee holds for ≤1 kg).
- [ ] Owner: KYC (selfie + GSTIN OTP on GST mobile).
- [ ] Owner: wallet ₹500 (prepaid shipping balance, not a fee; check the 100%-cashback offer terms).
- [ ] Owner: API user (Settings → API), email e.g. bindalscreations+api@gmail.com (any email ≠ login
  email), modules Orders/Shipments-Courier/Tracking/Pincode/Settings, Buyer's Details Allowed. Owner
  creates it, not Claude: the password shows once and would land in Claude's screenshots.
- [ ] Owner generates webhook token (`openssl rand -hex 32`, own terminal); Claude can fill the webhook
  URL `https://www.bindalscreations.com/hooks/courier-status`, owner pastes token, toggle on.
- [ ] Owner sets SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD / SHIPROCKET_WEBHOOK_TOKEN via
  `supabase secrets set --env-file` (temp file, then rm); Claude verifies names with `supabase secrets list`.
- [ ] Test parcel to a UP family address; re-check rates in the logged-in dashboard.
- [ ] Then live API checks from `docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md` (UNVERIFIED items).
Browser work uses Claude in Chrome; owner is already logged in to app.shiprocket.in in that profile.

### Go-live checklist (owner + controller, in order)
1. Owner puts the remaining secrets in Supabase (never chat): CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET,
   CASHFREE_ENV=sandbox ([X] sandbox keys set 2026-10-26; US access granted), and after
   Shiprocket KYC + API user + pickup location `Shop`: SHIPROCKET_API_EMAIL, SHIPROCKET_API_PASSWORD,
   SHIPROCKET_WEBHOOK_TOKEN. Already set 2026-10-25: CRON_SECRET, IP_HASH_SALT, SITE_URL, ALLOWED_ORIGIN,
   GMAIL_USER, GMAIL_APP_PASSWORD (Gmail send verified).
2. [X] Deploy functions (2026-10-25): `--no-verify-jwt` for checkout-quote, create-order, order-status,
   cashfree-webhook, run-jobs, courier-status, refund-choice, refund-sweeper; admin-order-action with JWT on.
   Redeploy after secret changes is NOT needed (secrets propagate without redeploy).
3. [X] pg_cron 1.6 + pg_net 0.14 enabled; Vault `online_orders_project_url` + `online_orders_cron_secret`
   (= CRON_SECRET function secret); `schema/golive_online_orders_cron.sql` applied (2026-10-25).
4. [X] Cashfree (Test) webhook → cashfree-webhook URL, 2026-10-26: success/failed/user-dropped payment events,
   default retry. No refund events offered on that form; refund-sweeper polls refunds after 1 h instead.
   Unsigned POST returns 401 (deployed, signature check on). Redo in Production at go-live. Shiprocket webhook →
   `https://www.bindalscreations.com/hooks/courier-status` with x-api-key token.
5. Revert `b4a5e49` (restores Account → Order history).
6. Sandbox end-to-end with checkout switched on for testing only: pay (UPI testsuccess@gocash), shelf check
   1 of 2 unavailable, Process (AWB/label/BoS), refund both choices, cancel, tracking webhook. Settle the
   UNVERIFIED API items (api notes files) against real responses.
   2026-10-26 sandbox run (API + SQL, Claude), WEB-000001..05, all now cancelled, stock restored (2/2),
   checkout off. PASSED: webhook pay (sig OK), cancel+original (Cashfree refund ids issued), cancel+store
   credit (guest → vouchers, 1 yr), stock-race partial refund (1 of 2 units, no shipping leg) + original,
   remainder cancel + store credit (incl. ₹99 shipping), double choice → already_chosen, 48 h default →
   original via refund-sweeper, voucher-paid order (₹500 voucher + ₹99 Cashfree) cancel → new ₹500 voucher
   at once + ₹99 per choice, all emails sent. Test vouchers (₹1,198) voided; stuck shiprocket_create jobs
   closed. Guest 401 bug fixed + deployed (PR #71). NOT tested live: shelf-check partial (Process needs
   Shiprocket), registered-customer credit (covered by schema/test_online_orders_refunds.sql), admin UI
   buttons (cancel run via SQL RPC), refund-leg completion (sweeper polls processing legs after 1 h; check
   order_refund_legs all 'completed'). Known: shiprocket_create job retries cancelled orders only while
   Shiprocket is unconfigured (not-configured branch runs before the status skip). First real order = WEB-000006.
7. Switch CASHFREE_ENV=production + live keys, superadmin flips "Online checkout" on in /admin/online-orders.

### Un-stick/rebook + returns: SHIPPED 2026-10-26 (PT; 2026-10-27 04:18 UTC)
- Plan B (send back / rebook): PR #72 (112e6af). Plan A (returns): PR #73 (9a20a3d). Both merged to main.
- Live: `npm run migrate` applied migration_online_orders_rebook.sql then migration_online_returns.sql. Deployed v8 of
  admin-order-action (JWT on), run-jobs + courier-status (--no-verify-jwt). Unauthenticated POST → 401 on all three.
- Verified live: `order-returns` bucket public=false, 10 MB, 5 image types; 3-arg checkpoint/mark_packed gone; delivered_at
  backfill = 0 (only the 5 cancelled sandbox orders exist). Admin list/detail/ExchangePage PostgREST queries → 200
  (aliased embeds OK); anon → permission denied; superadmin sees orders + returns tables; role=user sees nothing;
  order_return_photos.path denied to authenticated. exchange_record dry run (bill 351 item 995, superadmin claims,
  rolled back) returned an id; exchanges count + stock unchanged after.
- NOT tested (needs Shiprocket set up, so a real order can ship + get a bill): mark delivered, open/receive/refund a return,
  signed photo upload + view, return refund email wording, in-store exchange of a delivered online bill. Checklist:
  .superpowers/sdd/2026-10-26-online-returns/final-review.md "Must verify". Run it after
  Shiprocket setup, with the shipping scenarios.
- Keep REBOOK_API_CANCEL unset until cancel-by-AWB is verified on a real Shiprocket shipment.
- Deferred: customer order page Returned badge; customer self-service return request; hide Shipping line in ExchangePage
  for online bills (ticking it now refuses the whole exchange); edge sortReturns compares timestamps as strings.
- Worktrees + local branches removed 2026-10-26; ledgers kept in .superpowers/sdd/2026-10-26-online-{order-unstick-rebook,order-unstick-rebook-ui,returns}/.
- Open owner questions: manual (non-catalogue) items never restock on in-store exchange (kept as before) — switch on?
- Ledgers hold every ruling (B: R1–R5; A: RA1–RA8). Specs/plans: docs/superpowers/{specs,plans}/2026-10-26-*.

### Follow-ups (non-blocking)
- "Send back to To-check" for an order stuck in processing after AWB (ship builder gap 1).
- Courier fallback if quoted courier refuses; Shiprocket duplicate order_id / update-keeps-shipment checks.
- BillTable/BillingForm: block edit/cancel/delete of online (Website) bills; hide Website from the in-store
  payment picker (review S5).
- `salesmethods` serial sequence lags its rows (pre-existing; new in-store method inserts would collide).
- Two Shiprocket token-store helpers (pay context.ts vs ship process.ts) — consolidate.

## STOREFRONT: open items (pruned 2026-10-25)

PR #70 (`fix/storefront-polish-oct25`, merged 2026-10-25 as `4b780d5`) shipped the owner batch: ring-free header
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

- [x] ~~**BLOCKER 2026-10-25:**~~ resolved 2026-10-26, US access granted. Was: Cashfree dashboard "Access restricted in your region" when logging in from the
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
