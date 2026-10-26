# Customization service plan

Written 2026-10-25. Status: **plan, awaiting owner answers (bottom)**. Next focus after Diwali (8 Nov 2026).
Builds on the online-orders system (`docs/superpowers/specs/2026-10-23-online-orders-design.md`,
`schema/migration_online_orders*.sql`, `supabase/functions/*`) and reuses its Cashfree client,
webhook, Gmail mailer, rate-limit table and token-link pattern.

## Goal
Customers ask the shop to make a garment from a design they send. In-house designers and tailors
quote a price and a timeline; the customer pays 50% to start and the rest when the piece is ready.
Garments: lehengas, sarees (fall/pico/blouse work), dresses, kurtis, suits; men's sherwanis,
jodhpuri suits, suits, blazers, coat-pants, formal suits.

## User flow
**Customer**
1. `/customize` landing: what we make, how it works (4 steps), example pieces, FAQ, CTA.
2. Request form: garment type, design photos (1–4), budget (₹), quantity, fabric (optional: "you
   choose" / "I'll bring my own" / free text), needed-by date (optional), notes, name, phone, email.
3. Confirmation screen + email with a private link `/custom/:ref?t=<token>` (same pattern as
   `/order/:ref`). Ref format `CUS-000123`.
4. Shop replies with a quote (price, ready-by date, notes, valid for 7 days). Email + WhatsApp
   carry the link. Customer accepts → pays 50% advance on Cashfree's hosted page, or declines.
5. Status updates by email: in production → ready (with balance link) → delivered/collected.
6. Measurements: taken in store, or sent via the size-guide measurement list (see open questions).

**Admin** (`/admin/custom-orders`)
1. Inbox of new requests (photos via signed URLs, budget, contact, WhatsApp button).
2. Quote form: price, ready-by date, delivery mode + fee, notes → sends quote. Can decline with reason.
3. After advance: mark in production → mark ready (creates balance link) → mark delivered/collected.
4. Cancel/refund action with the refund rule applied (see lifecycle).

## Spec (v1)
- Anyone can submit (no login), rate-limited. If logged in, the request links to the customer and
  shows under Account → My custom orders.
- Budget is the customer's target, not a price. The quote is the only binding price.
- Quantity 1–20 per request. Several different garments = several requests (keeps one price/state each).
- Quote valid 7 days; expired quotes can be re-issued by admin (same request, new quote row).
- Advance = `ceil(quote × 0.5)` to the rupee; balance = quote + delivery fee − advance.
- Delivery: in-store collection (default) or shipping **within UP only** (same composition rule as
  online orders, `tasks/checkout-shipping-plan.md`). Shipping booked manually in Shiprocket in v1.
- Edge cases: duplicate submit (idempotency key from the form), photo upload fails midway (request
  stays `draft` and is swept after 24 h), customer pays an expired/cancelled link (webhook arrives on
  a non-`quoted` request → auto-refund + flag), double webhook (idempotent by `cf_payment_id`),
  balance never paid (reminders at 7 and 14 days, then admin decides; the advance is kept per rule).

**Out of scope v1:** live chat/design back-and-forth on site (WhatsApp does this), 3D/measure-by-photo,
fabric catalogue, multiple quotes to compare, EMI/pay-later, COD, Shiprocket API for custom pieces,
inter-state delivery, discount codes/vouchers/store credit on custom orders.

## Quote lifecycle (state machine, `custom_requests.status`)
```
draft ──upload ok──▶ submitted ──admin quote──▶ quoted ──advance PAID──▶ advance_paid
  │                    │  └─admin decline─▶ declined      │  ├─7 days─▶ expired ──re-quote─▶ quoted
  └─24h─▶ (deleted)    └─customer cancel─▶ cancelled      │  └─customer decline─▶ declined
advance_paid ──admin──▶ in_production ──admin──▶ ready ──balance PAID──▶ balance_paid
balance_paid ──admin──▶ delivered | collected
advance_paid | in_production ──admin cancel──▶ cancelled (refund per rule)
```
Transitions happen only in SECURITY DEFINER SQL functions (like `online_order_*`), each writing an
event row. Payment-driven transitions only after re-reading Cashfree (never trust the webhook body).

**Advance refund rule (recommended default, owner to confirm):** full refund if cancelled before
`in_production`; after cutting starts, no refund (fabric is bought and cut for this order) unless
the shop cancels, then full refund. Shop can't make it → full refund to source.

## Data model (migration sketch, `schema/migration_custom_orders.sql`)
```sql
create sequence public.custom_request_ref_seq;
create table public.custom_requests (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('CUS-' || lpad(nextval('public.custom_request_ref_seq')::text, 6, '0')),
  idempotency_key uuid unique not null,
  status text not null default 'draft' check (status in ('draft','submitted','quoted','expired',
    'declined','cancelled','advance_paid','in_production','ready','balance_paid','delivered','collected')),
  garment_type text not null check (garment_type in ('lehenga','saree','dress','kurti','suit',
    'sherwani','jodhpuri','mens_suit','blazer','coat_pant','other')),
  quantity int not null check (quantity between 1 and 20),
  budget numeric(12,2) check (budget > 0),
  fabric_choice text check (fabric_choice in ('shop','own','described')),
  fabric_notes text, needed_by date, notes text check (length(notes) <= 2000),
  contact_name text not null, contact_phone text not null, contact_email text not null,
  customerid int references public.customers(customerid), auth_user_id uuid,
  access_token_hash text not null,
  delivery_mode text check (delivery_mode in ('collect','ship')), address jsonb,
  bill_id int references public.bills(billid),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.custom_request_photos (id uuid pk, request_id uuid fk, storage_path text unique,
  mime text, bytes int, created_at timestamptz);
create table public.custom_quotes (id uuid pk, request_id uuid fk, price numeric(12,2) not null check (price > 0),
  delivery_fee numeric(12,2) not null default 0, ready_by date not null, notes text,
  valid_until timestamptz not null, status text check (status in ('open','accepted','expired','superseded','declined')),
  created_by uuid, created_at timestamptz);
create table public.custom_payments (id uuid pk, request_id uuid fk, quote_id uuid fk,
  kind text check (kind in ('advance','balance')), amount numeric(12,2) check (amount >= 1),
  cf_link_id text unique, link_url text, cf_order_id text, cf_payment_id text unique,
  status text check (status in ('active','paid','expired','cancelled','refunded','refund_pending')),
  paid_at timestamptz, unique (request_id, kind, quote_id));
create table public.custom_events (id bigserial pk, request_id uuid fk, kind text, data jsonb, actor uuid, at timestamptz);
```
RLS: same block as orders — enable RLS, revoke from anon/authenticated, grant service_role, admin
`select` policy via `profiles.role in ('admin','superadmin')`. Customer reads only through
`custom_request_public(ref, token_hash)` and `my_custom_requests()` (SECURITY DEFINER, returns safe
JSON; never staff notes). Rate limiting reuses `code_attempts` with a new scope `custom_submit`
(extend `code_attempts_scope_check`).

## Storage (design photos)
- New **private** bucket `custom-designs` (no public read; anon has no storage policy).
- Upload: `custom-request` Edge Function validates the form, creates the `draft` row, returns up to 4
  **signed upload URLs** (`createSignedUploadUrl`, path `requests/<id>/<n>.<ext>`). Browser uploads
  directly, then calls `custom-request/submit` which checks each object exists, size ≤ 8 MB, MIME in
  jpeg/png/webp/heic (re-checked from the stored object, not the client's claim) → `submitted`.
- Client side: compress to ≤ 2000 px WebP/JPEG before upload (HEIC converted when the browser can).
- Bucket file-size limit 8 MB and allowed MIME types set on the bucket itself.
- Admin views via short-lived signed URLs (5 min). Drafts and their files swept after 24 h by the
  existing `run-jobs` cron. Photos kept 1 year after close, then deleted (privacy policy line).
- Anti-abuse: 3 submits per IP hash per day and 5 per phone per week (`IP_HASH_SALT` already set);
  honeypot field; Cloudflare Turnstile only if spam appears.

## Payments (recommendation: Cashfree Payment Links, one per instalment)
**Why links, not the `create-order` checkout:** `create-order`/`online_order_create` is built around
cart lines, stock holds, promo/credit maths and Shiprocket; a custom piece has no SKU or stock and is
paid in two instalments weeks apart. A Payment Link is hosted by Cashfree (no checkout UI to build),
can be sent on WhatsApp/email, has its own expiry, and refunds work on its underlying order.
**Why two links, not one partial-payment link:** a partial link lets the customer pay any amount at
any time; two fixed links give exact 50%/balance amounts, separate receipts and clean states.
- Advance link created when the customer accepts the quote (`link_id = CUS-000123-A-<quote#>`,
  amount fixed, expiry = quote `valid_until`, `link_notify` email+SMS on). Balance link created at
  `ready` (`…-B`, expiry 30 days, `link_auto_reminders: true`).
- Webhook: same `cashfree-webhook` endpoint, new `PAYMENT_LINK_EVENT` branch → signature already
  verified over the raw body → **re-fetch `GET /pg/links/{link_id}`**, act only on `link_status = PAID`
  and `link_amount_paid = amount` → `custom_payment_confirm()` (idempotent on `cf_payment_id`).
  Note: link payments also fire `PAYMENT_SUCCESS_WEBHOOK` with a Cashfree-made `order_id`; today
  `reconcilePayment` returns `not_found` for unknown refs (harmless), keep it that way and add a test.
- Refunds: `POST /pg/orders/{order_id}/refunds` on the link's underlying order, `refund_id` prefixed
  `CUS-` so the existing `REFUND_STATUS_WEBHOOK` branch (which expects UUID legs) routes it to a new
  `custom_refund_set_status` instead of logging "unknown refund".
- Return URL `/custom/:ref?t=…` shows "payment received, confirming…" and polls the status function.
- Payment link fees: same PG pricing as checkout (0% on first ₹20 lakh offer); confirm with the
  account manager that links count toward the offer.

## Tax / Bill of Supply (flag for CA, do not build until answered)
Questions for the CA (add to `tasks/accounts-setup.md`):
1. Is a garment made from the shop's fabric a supply of goods (composite, principal = garment) and
   stitching on customer's own fabric a supply of **services**? Composition dealers may supply
   services only up to a limit; confirm the limit and rate for the shop's turnover.
2. Does receiving a 50% advance create a time of supply for a composition dealer (the advance relief
   for goods may not cover composition dealers)? If yes, issue a **receipt voucher** for the advance
   and the Bill of Supply on delivery for the full value, showing the advance adjusted.
3. HSN/SAC to use for custom garments and for tailoring services.
4. Shipping custom pieces: same UP-only rule as online orders?
Build default until answered: one Bill of Supply (`bills.document_type = 'bos'`) at delivery for the
full amount, advance shown as received; a simple numbered advance receipt (PDF/email) at payment.

## Notifications
Gmail mailer (`_shared/mailer.ts`, already verified live): request received (customer + shop inbox),
quote sent, advance received, in production, ready + balance link, balance received, delivered,
cancelled/refund. All with the `/custom/:ref` link. WhatsApp stays manual: admin screen shows a
`wa.me` button with a pre-filled message per state. Email failures queue in `order_jobs`-style retry
(new kind) via `run-jobs`.

## Admin screen (`src/admin/pages/CustomOrdersPage.jsx`)
Tabs by state (New, Quoted, In production, Ready, Done, Closed). Row: ref, garment, qty, budget,
age, customer. Drawer: photos (signed URLs, lightbox), request details, quote history, payments,
events, actions valid for the current state only. Mutations via `admin-custom-action` Edge Function
(JWT on, role check), mirroring `admin-order-action`.

## Storefront pages
- `/customize` landing (static content file like `aboutContent.js`) + form (React Hook Form + Zod).
- `/custom/:ref` status page (token link, like `OrderPage.jsx`): request, quote with Accept/Decline,
  pay buttons, timeline.
- Account → "My custom orders" list (logged-in customers, via `my_custom_requests()`).
- Nav: header link "Customize" + footer Help entry; home band after Diwali.
- Size guide's measurement list (`MeasurementDiagram.jsx`) reused on the form as "how to measure".

## Phased steps (each verifiable; local DB harness `scripts/test-db.sh` for all SQL)
1. **CA questions** sent (no code). Owner answers open questions below.
2. **Schema** `schema/migration_custom_orders.sql` + `schema/test_custom_orders.sql`: tables, RLS,
   state-transition functions, rate limit scope. Test: every legal/illegal transition, idempotent
   confirm, refund rule, anon cannot select any table.
3. **Bucket + submit function** `supabase/functions/custom-request/{index,handler,handler_test}.ts`:
   draft, signed upload URLs, submit validation, rate limit. Tests: oversize/bad MIME rejected,
   duplicate idempotency key returns the same ref, rate limit hits.
4. **Storefront** `src/storefront/pages/CustomizePage.jsx`, `customizeContent.js`,
   `CustomRequestPage.jsx`, `lib/customApi.js`, routes in `src/App.js`. Tests: form validation,
   upload flow with mocked API, status page per state.
5. **Admin** `src/admin/pages/CustomOrdersPage.jsx` + `supabase/functions/admin-custom-action/`:
   quote, decline, mark states. Tests: actions shown only for valid states; role check.
6. **Payments** `_shared/cashfree.ts` (createLink/fetchLink/cancelLink), webhook branch, refunds,
   accept-quote endpoint. Tests: fake Cashfree for PAID/PARTIALLY_PAID/EXPIRED, duplicate webhook,
   payment on a cancelled request → auto-refund. Then sandbox end-to-end with a real link.
7. **Emails + reminders** templates in `_shared/emails.ts`, jobs in `run-jobs`. Test with injected transport.
8. **BoS at delivery** per CA answer (reuse `online_order_create_bos` pattern) + advance receipt.
9. **Launch**: policy text (custom-order terms, refund rule, photo retention) on Terms/Returns pages,
   nav links, feature flag `storefront_settings.custom_live` (off until owner flips it, like checkout).

Phase A bridge (zero code, usable right after Diwali): a "Customize" page with a WhatsApp CTA and
the quote/advance done by manually created Cashfree Payment Links from the dashboard.

## Open questions for the owner (recommended default in bold)
1. Measurements: **in store or by video call for v1; customers who can't come fill the 7-point
   measurement list on the status page after paying the advance.** Alternative: ask on the form.
2. Quote channel: **email + WhatsApp, both linking to the status page where they accept and pay.**
3. Delivery vs pickup: **collect in store by default; shipping within UP at a quoted fee.**
4. Minimum order: **₹3,000 quote minimum (below that, regular alteration in store).**
5. Turnaround: **shop sets per quote; show "usually 2–4 weeks" on the landing page; no rush orders v1.**
6. Cancellation after advance: **full refund before cutting starts; none after, unless the shop cancels.**
7. Price field: **a budget ("your budget"), not a fixed price; the quote is binding.**
8. Fittings/trials: **one trial included for stitched pieces; extra alterations after delivery free for 7 days.**
9. Own fabric: **accepted (customer drops it at the shop); quote covers stitching only.**
10. Login: **not required to submit; optional login shows requests in Account.**
