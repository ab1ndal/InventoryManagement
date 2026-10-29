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
- Cashfree: KYC passed 2026-10-24, no video KYC needed; rejected 2026-10-28, manually activated
  2026-10-29 (PG + Payment Links + Payment Forms); account manager Saurabh Kumar. Owner guide:
  https://claude.ai/artifact/XypgAiSTZZFiUNMJBFRBth

### Shiprocket setup: RESUME HERE (updated 2026-10-29)
Courier fallback deployed 2026-10-29. **Test parcel DEFERRED by owner 2026-10-29** (Cashfree is on production keys,
checkout off; until the parcel runs, the first real order is the first real Process). Then, in order: test parcel (live checks 5/7, webhook, GST compare) →
packaging → shipping + returns scenarios → Cashfree go-live (step 7 below).
- [x] Shipping quote fixes merged to main 2026-10-26 (branch `fix/shipping-quote-weight-cheapest`): cheapest
  courier (was recommended); quote at max(dead, volumetric) with ASSUMED packages by heaviest class
  (bag 30×40×4 / bag 40×50×5 / box 45×35×12, same dims sent at Process); flat fallback ₹99→₹150
  (server + WhatsApp checkout). 347 deno + 34 checkout tests green.
- [x] Deployed 2026-10-27 (05:37 UTC): checkout-quote, create-order, run-jobs, courier-status, cashfree-webhook,
  order-status (--no-verify-jwt), admin-order-action (JWT on). Live quote to Lucknow 226001: Kurti ₹140,
  Saree ₹150, Lehenga ₹190 (source "rate"); no pincode → ₹150 flat.
- [x] Rate table 2026-10-29 (API, cheapest courier, prepaid, from 201001, 11 UP cities × 0.5–5 kg; JSON in that
  session's scratchpad `sr/rates-2026-10-29.json`). Charged now (ceil ₹10): light ~1 kg ₹110 Ghaziabad / ₹130–140
  rest of UP; medium 2 kg ₹120 / ₹150; heavy ~4 kg ₹170 / ₹190, Bareilly + Kanpur ₹230. API `rate` = freight
  only; dashboard adds a ₹5 "Smart Order" line; no GST shown anywhere. If GST is extra, absorbed loss ≈ ₹17 /
  ₹25 / ₹37 per order (light/medium/heavy).
  **Owner decision 2026-10-29: keep the rule as is** (live rate rounded up to ₹10, free ≥ ₹5,000, ₹150 fallback);
  accept the GST loss. Owner rule: never undercharge freight. Fallback (no rate) is now by weight slab (PR #79,
  deployed checkout-quote + create-order 2026-10-29): ≤0.5 kg ₹90, ≤1 ₹140, ≤2 ₹150, ≤3 ₹180, ≤5 ₹230 (highest UP
  freight per slab). Live check: no pincode Kurti ₹140 / Lehenga ₹230; Lucknow rate ₹140 / ₹190. WhatsApp checkout
  (checkout off) still flat ₹150. Still open after the test parcel: add the ₹5 Smart Order if the wallet deduction
  includes it.
- [ ] Buy packaging (2 bag sizes + 1 box); pack a kurti, saree, lehenga; measure + weigh; replace the
  assumed sizes in `_shared/shipping.ts` (and LIGHT/MEDIUM/HEAVY kg if real weights differ).
- [ ] GST: after the test parcel, compare wallet deduction with the quoted rate. If rates exclude 18% GST,
  add the markup to quotes (composition dealer: no ITC, GST is a cost; can't show GST to the customer).
- [ ] Ask CA: is the shipping charged to customers part of composition turnover (1% tax on it)? Also: is
  GSTIN invoicing ON in Shiprocket (its invoices to us carry our GSTIN) fine for a composition dealer?
Full steps: `tasks/accounts-setup.md` §3. Shiprocket works from the US (no region block, unlike Cashfree).
- [x] Signup + business details (company "Bindals Creation", site bindalscreations.com).
- [x] Pickup address nickname `Shop` (= `PICKUP_LOCATION` in `_shared/shiprocket.ts`) saved, VERIFIED,
  primary; contact Pooja Bindal 9810873280; Mon + Wed–Sun 10:00–20:30. No OTP was asked.
  Its status toggle showed grey: check it turns on now that KYC is done (2026-10-29).
- [x] Public-calculator rate table recorded in accounts-setup step 5 (superseded by Lite-plan API rates below).
- [x] Owner: KYC done 2026-10-29 (dashboard "Complete KYC: COMPLETED"); onboarding survey filled (website,
  Instagram, Facebook, WhatsApp wa.me/919810873280; GSTIN invoicing ON, TDS No, Central GST).
- [x] Owner: wallet recharged ₹500 on 2026-10-29, 100% cashback credited: API balance "1000". Minimum balance to
  book a courier is ₹100. Pickup `Shop` via API 2026-10-29: status 2, phone_verified 1, primary (meaning of
  status 2 unverified: confirm the dashboard toggle is on before the test parcel).
- [x] Owner: API user created 2026-10-26 (Settings → Additional Settings → API Users),
  bindalscreations+api@gmail.com, modules Orders/Shipments/Courier only (form has no Tracking/Pincode
  modules; Settings skipped, code calls no Settings endpoint). EMAIL + PASSWORD secrets set, names verified.
- [x] Webhook token generated by owner, SHIPROCKET_WEBHOOK_TOKEN set (names verified), Shiprocket
  Webhooks page: URL `https://www.bindalscreations.com/hooks/courier-status`, x-api-key, ENABLED 2026-10-26.
  Unauthenticated POST to the URL returns 401; dashboard Test Webhook = success (token matches).
- [ ] Test parcel to a UP family address, run through the real flow: checkout on briefly (Cashfree still
  sandbox, UPI testsuccess@gocash), place a cheap real item, admin Process → real Shiprocket AWB, label,
  pickup; then checkout off. Re-check rates in the logged-in dashboard. Also look at the
  label/invoice PDF: Shiprocket's customer invoice must not go in the parcel (we print our own Bill of
  Supply; a "Tax Invoice" with our GSTIN is not allowed for a composition dealer).
- [~] Live API checks (`docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md` § Live checks): 1, 2, 3 verified
  2026-10-26 (code's assumptions hold); 8 partial. 4 + 6 verified 2026-10-29 (api notes). Left: 5/7 with the test parcel. Lite-plan API rates 2026-10-26 (cheapest, prepaid, from 201001; GST inclusion unknown):
  Ghaziabad ₹73.72/₹115.72/₹130.40, Lucknow + Varanasi ₹81.72/₹132.72/₹148.52 for 0.5/1/2 kg.
  Higher than the public calculator; checkout charges the live rate rounded up to ₹10 (₹99 only as fallback), so no gap.
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
5. [x] Revert `b4a5e49` (restores Account → Order history): PR #81, merged 2026-10-29.
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
   Go-live audit 2026-10-29 (Claude, read-only):
   - [x] Production domain whitelist: bindalscreations.com APPROVED (added 2026-10-24). Confirm www works on the
     first real payment.
   - [x] Production success webhook: default NOTIFY_URL entry exists and create-order sends notify_url, so
     PAYMENT_SUCCESS reaches cashfree-webhook. [x] Production endpoint added 2026-10-29:
     https://epotsxdugwfhyeiudjox.supabase.co/functions/v1/cashfree-webhook, version 2026-01-01, success + failed +
     user-dropped, default retries; dashboard test → 200 (signature verified with the production secret). Cashfree
     also shows a second NOTIFY_URL row (2026-01-01, same 3 events) next to the 2023-08-01 default; both hit the same
     function, duplicates are harmless (handler re-reads Cashfree). Left as is.
   - [x] Payment methods active: UPI, credit + debit cards (Visa/Mastercard/RuPay/Maestro). Net Banking OFF
     (optional: request activation). Amex not available.
   - [x] 6 sandbox refund legs (WEB-000001/3/4/5) closed 2026-10-29 (owner approved): legs + their 4 refunds set
     'failed' with note "Sandbox test refund; closed before production keys" ('completed' would email). No jobs queued.
   - [x] Owner: production API keys set in Supabase 2026-10-29; CASHFREE_ENV digest = sha256("production").
     Checkout still off. Next: test parcel as a real paid order.
   - [x] Order history restored: PR #81 merged 2026-10-29 (owner: nobody orders yet, ship now).
   - [x] Shiprocket pickup `Shop`: toggle looks on (green outline, knob right), VERIFIED, PRIMARY (2026-10-29).
   - [ ] Custom SMTP for Supabase Auth before PR #81: customers sign in by magic link to see orders, and the
     built-in mailer is rate-limited.
   - [ ] API + success-rate alerts (Cashfree dashboard → Developers), optional.
   **PENDING (owner 2026-10-29).** Cashfree production account is active (PG + Links + Forms, settlement bank
   active), so nothing on Cashfree's side blocks this. Do it only after the Shiprocket setup above: wallet,
   the test parcel, then the shipping + returns scenarios (KYC + live check 6 done 2026-10-29).

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
- [x] Courier fallback (PR #75, merged + deployed 2026-10-29: run-jobs, courier-status, admin-order-action v12,
  ACTIVE, unauthenticated POST → 401): Process retries assign-AWB without
  courier_id when Shiprocket refuses the quoted courier (status 200/400/422 only; never after a timeout).
  Watch `awb_quoted_courier_refused` logs: the default courier may cost more than the quote.
- Shiprocket update-keeps-shipment check (live check 5, with the test parcel). Duplicate order_id verified 2026-10-29.
- [x] BillTable/BillingForm: online (Website) bills locked (no edit/cancel/delete, globe marker) and Website
  hidden from the in-store payment picker: PR #84, merged 2026-10-29. Same PR pinned the ReturnsSection test
  clock (3 tests went red on 2026-10-28 when the real date left the 7-day window). Full suite 775/775.
- [x] `salesmethods` sequence realigned (last_value 7 = max id): PR #85, migrated + merged 2026-10-29.
- [x] Token-store helpers consolidated: process.ts uses context.ts `dbTokenStore` (2026-10-27).

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
  dashboard. Unblocked 2026-10-29: Payment Links is activated on the live account.
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
- [x] Cashfree settlement bank account ACTIVE (Union Bank, account name BINDALS CREATION), checked in
  the dashboard 2026-10-29.
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
