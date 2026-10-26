# Online orders: sandbox end-to-end test log (2026-10-26)

Live production database and Edge Functions, Cashfree **sandbox** keys (`CASHFREE_ENV=sandbox`).
Run by Claude Code with the owner's go-ahead. Checkout (`storefront_settings.checkout_live`) was
switched on only while test orders were being created (about 2 min, then seconds) and is **off**.

## Setup done first

| Step | Result |
|---|---|
| Cashfree US dashboard access | Granted by Cashfree 2026-10-26 |
| Sandbox API keys | `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_ENV=sandbox` set as Supabase function secrets by the owner (never in chat) |
| Webhook (Test mode) | `https://epotsxdugwfhyeiudjox.supabase.co/functions/v1/cashfree-webhook`, newest version, default retry (2/10/30 min), events: success, failed, user-dropped payment. The form offered no refund events; `refund-sweeper` polls refunds instead |
| Endpoint check | Unsigned POST → `401` (deployed, signature check on) |

## How orders were driven

- **Create:** `POST /functions/v1/create-order` (same call the storefront makes), guest, pincode 201001,
  phone 9810873280, email bindalscreations@gmail.com.
- **Pay:** Cashfree sandbox Order Pay API, `POST https://sandbox.cashfree.com/pg/orders/sessions` with
  UPI collect `testsuccess@gocash` (no secret needed, only the payment session id).
- **Cancel:** SQL `online_order_cancel(order, superadmin, reason)`, the function the admin Cancel button
  reaches through `admin-order-action`. The button itself was not clicked.
- **Refund choice:** `POST /functions/v1/refund-choice` (`preview`, `choose`) with the token from the
  customer email link.
- **48 h default:** the test refund's `token_expires_at` was moved into the past and the
  `online-orders-refund-sweeper` cron command was run by hand.

Products: BC251049 Off White S|36 (variant `a7a8dc0a…`) and BC251048 Magenta XS|34 (`8ae6ee4d…`), ₹500
each, stock 2 each before and after.

## Results

| # | Scenario | Order | Expected | Result |
|---|---|---|---|---|
| 1 | Create order, Cashfree sandbox order | WEB-000001 | session id returned, ₹500 + ₹99 flat shipping (Shiprocket unset → fallback) | PASS, ₹599 |
| 2 | Payment confirmed by webhook | WEB-000001 | `paid`, stock −1 | PASS, paid 4 s after payment, stock 2 → 1. Signature verified with the real secret |
| 3 | Cancel paid order | WEB-000001 | `cancelled`, stock back, refund awaiting choice | PASS, stock 1 → 2, legs ₹500 + ₹99 shipping |
| 4 | Refund to original payment | WEB-000001 | Cashfree refunds created | PASS, cf_refund_id 1319939905 (₹500), 1319939907 (₹99), `processing` |
| 5 | Cancel → store credit (guest) | WEB-000002 | vouchers, refund completed | PASS, vouchers ₹500 + ₹99, expiry 2027-10-26, `completed` |
| 6 | Stock race partial refund (order 2, 1 left) | WEB-000003 (1 unit) then WEB-000004 (2 units) | Y takes 1 unit, refunds 1 unit, **no shipping refund** | PASS, WEB-000004 paid ₹1,099, refund ₹500 only, no shipping leg |
| 7 | Partial refund to original payment | WEB-000004 | Cashfree refund ₹500 | PASS, `processing` |
| 8 | Choose twice on the same refund | WEB-000004 | rejected | PASS, `409 already_chosen` |
| 9 | Cancel remainder → store credit | WEB-000004 | 1 unit + ₹99 shipping as vouchers, total = paid | PASS, ₹500 + ₹99 vouchers, total refunded ₹1,099, stock +1 (only the unit actually taken) |
| 10 | No choice within 48 h → default original | WEB-000003 | sweeper defaults + submits | PASS, `defaulted 1, submitted 2`, cf_refund_id 1319939920/21 |
| 11 | Voucher at checkout (₹500 voucher + ₹99 Cashfree) | WEB-000005 | gateway amount ₹99, voucher used | PASS, `voucher_applied 500`, `gateway_amount 99`, old voucher marked redeemed |
| 12 | Cancel voucher-paid order | WEB-000005 | voucher share back at once, gateway share per choice | PASS, new ₹500 voucher immediately (no choice needed), ₹99 to Cashfree (cf 1319939922) |
| 13 | Checkout switched off after order created | WEB-000003/04 | already-created orders can still be paid | PASS |
| 14 | Emails (outbox jobs) | all | confirmation, shop alert, refund notices | PASS, all `done` |

## Bugs found

1. **Guest checkout returned 401 for everyone (fixed).** The function secret `SUPABASE_ANON_KEY` holds
   the new `sb_publishable_` key; the storefront sends the legacy anon JWT, so `optionalUser` treated it as
   a failed login. Fixed in PR #71 (role `anon` → guest), deployed to `checkout-quote`, `create-order`,
   `order-status`. Verified live: legacy anon bearer → 200, forged token → 401.
2. **`shiprocket_create` job retries cancelled orders while Shiprocket is unconfigured (not fixed, low
   impact).** The "not configured" branch in `_shared/jobs/shiprocket_create.ts` runs before the status
   skip in `ensureSrOrder`, and its checkpoint call raises `order is cancelled`. Goes away once Shiprocket
   secrets are set. The 5 test jobs were closed by hand.

## Not tested yet

- Registered customer **account store credit** at checkout and on refund (needs a signed-in customer;
  covered by `schema/test_online_orders_refunds.sql`).
- Admin UI buttons (Cancel, availability, Process) in `/admin/online-orders`.
- Refund legs reaching `completed`: sweeper polls `processing` legs after 1 h. Check
  `order_refund_legs` for WEB-000001/03/04/05.
- Failed and user-dropped payments (`testfailure@gocash`, closing the page).
- Everything in "Shipping scenarios" below.

## Cleanup

- 4 unused test vouchers (₹1,198) voided (`redeemed = true`, note `VOID: sandbox test 2026-10-26`).
  They had attached to **customer 47** because the test phone is the shop's number.
- WEB-000001..05 kept as cancelled records; the first real order will be **WEB-000006**.
- Stock back to 2 and 2. Checkout off.

## Shipping scenarios still to test (need Shiprocket KYC, API user, secrets, webhook)

Shiprocket's API shapes are marked `UNVERIFIED` in `supabase/functions/_shared/shiprocket.ts`; these tests
settle them against real responses.

| # | Scenario | What to check |
|---|---|---|
| S1 | Live rate quote | Recommended courier rate rounded up to ₹10; free at ≥ ₹5,000; ₹99 when Shiprocket fails |
| S2 | Pincode | UP pincode accepted; non-UP rejected (`not_up`); unknown pincode → `unverifiable` message |
| S3 | Shiprocket order creation after payment | `sr_order_id` stored; `WEB-` letters in order id accepted (UNVERIFIED) |
| S4 | Shelf check: all available → Process | AWB assigned, pickup scheduled, manifest, label PDF, Bill of Supply created, status `packed` |
| S5 | Shelf check: 1 of 2 unavailable → Process | partial refund (no shipping), Shiprocket order shrunk via `update/adhoc` (UNVERIFIED), BoS for shipped unit only |
| S6 | Shelf check: none available | order cancelled, full refund incl. shipping, no Shiprocket shipment |
| S7 | Courier failure mid-Process (e.g. no AWB) | order stays `processing` with error, **Retry** resumes without duplicate shipment |
| S8 | Cancel before AWB (Shiprocket order exists) | Shiprocket order cancelled through API, refund, stock back |
| S9 | Cancel after AWB | refund done, problem flag "Cancel the AWB in Shiprocket dashboard" |
| S10 | Tracking webhook: shipped → out for delivery → delivered | statuses advance, emails, never go backwards |
| S11 | Tracking webhook: courier exception / courier cancelled | problem flag set, status unchanged |
| S12 | RTO → RTO received | `rto`, then **RTO received** puts stock back, refunds items, keeps shipping |
| S13 | Webhook auth | `/hooks/courier-status` rejects wrong `x-api-key` token |
| S14 | Two staff press Process together | second gets `busy`; lease takeover after 5 min works |

### Gaps found while listing these (no code path today)

- **Damaged or wrong item after delivery** (policy: refund or replacement within 48 h): no admin action
  creates a post-delivery item refund. Today it would be manual (Cashfree dashboard refund + voucher).
- **Order stuck in `processing` after a courier failure** cannot be sent back to "to check" or cancelled
  (follow-up "ship builder gap 1" in `tasks/todo.md`).
