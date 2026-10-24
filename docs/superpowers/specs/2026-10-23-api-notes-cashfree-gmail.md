# API notes: Cashfree PG + Gmail SMTP from Supabase Edge (researched 2026-10-23)

Read-only research. Each fact cites the page it came from. **UNVERIFIED** marks anything the
official docs did not state clearly. Re-check before go-live, because Cashfree versions its API by date.

## Cashfree Payment Gateway

### 1. Base URLs, headers
- Sandbox base: `https://sandbox.cashfree.com/pg`. Production base: `https://api.cashfree.com/pg`.
  Source: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
- Auth headers: `x-client-id` + `x-client-secret`. Partner variants also exist but we don't need them. (same URL)
- `x-api-version` is required, in YYYY-MM-DD format. The page says "The current version is `2026-01-01`", and that is the only enum value listed. (same URL)
  - Older versions are still documented at `/previous/v2023-08-01/`, but new code should pin `2026-01-01`.
- Optional headers: `x-request-id` (support tracing) and `x-idempotency-key` (UUID). A retry that reuses the same key does not create a duplicate. Reusing a key with a different body returns 422. (same URL; refunds page below)
- Content type: `application/json` request body. **UNVERIFIED** as an explicit statement in the docs; it is implied by the JSON schema.
- Rate-limit response headers: `x-ratelimit-limit` (example shows 200/min), `x-ratelimit-remaining`, `x-ratelimit-retry`.
  Source: https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create

### 2. Create Order: `POST /orders`
Source: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
- `order_id`: optional, but the docs say you should always send it. It must be 3–45 characters, and "Only alphanumeric characters, underscores (_), and hyphens (-) are allowed." It must be unique; a duplicate returns **409**. If omitted, Cashfree generates one.
- `order_amount` (required): a number with up to 2 decimals and a **minimum of 1** (INR).
- `order_currency` (required): `INR`.
- `customer_details` (required):
  - `customer_id` (required): 3–50 chars. "Use alphanumeric values only." Do not put a UUID with hyphens here, or an email; derive an alphanumeric id instead. Whether `_` or `-` are accepted is **UNVERIFIED**.
  - `customer_phone` (required): 10 chars. International numbers need a `+` prefix.
  - `customer_email` (optional): 3–100 chars.
  - `customer_name` (optional): 3–100 chars.
- `order_meta`:
  - `return_url`: Cashfree redirects the customer here with a GET once the payment reaches a terminal state (success, failed or cancelled). Max 250 chars. The docs recommend keeping `order_id` in the URL; their example is the literal `...thankyou?order_id=devstudio_7349...`.
  - `notify_url`: server-to-server webhook URL, must be https, max 250 chars.
  - `payment_methods` (optional): a comma list such as `cc,dc,upi`.
- **`{order_id}` placeholder substitution in `return_url` is UNVERIFIED.** It does not appear in the latest docs or in the v2023-08-01 docs (https://www.cashfree.com/docs/api-reference/payments/previous/v2023-08-01/orders/create). The safe approach: we generate `order_id` server-side, so we can build the full `return_url` string with the real id already in it.
- `order_expiry_time` (optional): ISO 8601, e.g. `2021-07-02T10:20:12+05:30` or `...Z`. Cashfree stores timestamps in IST. Customers cannot pay after this time.
  - The Create Order page gives **no default**. The dashboard setting allows **5 min to 30 days**, and the payment TTL allows 5 min to 24 h (Settings > Preferences). Source: https://www.cashfree.com/docs/payments/online/resources/payment-lifecycle
  - The actual default when the field is omitted (commonly said to be 30 days) is **UNVERIFIED**. Set it explicitly.
- Response (200): `cf_order_id`, `order_id`, `payment_session_id` (passed to the JS SDK), `order_status` (`ACTIVE` at creation), `order_expiry_time`, `order_amount`, `customer_details`, `order_meta`, `created_at`.
- Errors: 400, 401, 404, 409 (duplicate order_id), 422 (idempotency conflict), 429, 500.
- A `payment_session_id` lifetime of 30 minutes and single use comes only from a search summary, not a doc page. **UNVERIFIED.** If the session is stale, create a new order.

### 3. Get Order / Get Payments for an Order; statuses
- `GET /orders/{order_id}` returns the order. `order_status` values:
  - `ACTIVE`: no successful transaction yet.
  - `PAID`: one successful transaction.
  - `EXPIRED`: not paid and expired; no new attempts can start.
  - `TERMINATED`.
  - `TERMINATION_REQUESTED`.
  - Data is available only for the current and previous financial year.
  - Source: https://www.cashfree.com/docs/api-reference/payments/latest/orders/get
- `GET /orders/{order_id}/payments` returns an **array** of PaymentEntity (`cf_payment_id`, `payment_status`, `payment_amount`, `payment_message`, `payment_method`, ...). The example for one order has a `FAILED` attempt and a `SUCCESS` attempt, so one order can have many attempts. `payment_status` enum: `SUCCESS`, `NOT_ATTEMPTED`, `FAILED`, `USER_DROPPED`, `VOID`, `CANCELLED`, `PENDING`.
  Source: https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order
- Lifecycle rules. Source: https://www.cashfree.com/docs/payments/online/resources/payment-lifecycle
  - A `FAILED` attempt is terminal for that attempt, and "Customers can initiate a new attempt" on the same order while it is still valid.
  - `PENDING`: "Do not fulfil orders in this state."
  - Late success: if an attempt started before expiry succeeds within the TTL, the order can move **EXPIRED → PAID**. Do not treat EXPIRED as final until the TTL has passed.
  - Retry rules after `USER_DROPPED`: **UNVERIFIED**.
- Partial payments: the PG order is paid in full or not at all, so we treat only `order_status == PAID` as paid. A partial-payment concept for standard PG orders is **UNVERIFIED / not documented**.
- The hosted-checkout guide says: "Always verify the order status before you deliver services", "An order is successful when the `order_status` is `PAID`", and "Do not rely solely on browser redirects". Use webhooks plus Get Order.
  Source: https://www.cashfree.com/docs/payments/online/web/redirect

### 4. Frontend JS SDK v3
Source: https://www.cashfree.com/docs/payments/online/web/redirect
- CDN: `<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>`, then `Cashfree({ mode: "sandbox" | "production" })`.
- npm: `npm install @cashfreepayments/cashfree-js`, then `import { load } from "@cashfreepayments/cashfree-js"` and `const cashfree = await load({ mode: "sandbox" })`. `load` resolves to `null` on the server.
- `cashfree.checkout({ paymentSessionId, redirectTarget })`. `redirectTarget` values:
  - `_self` (default, same frame), `_blank` (new tab), `_top`: redirect checkout. The customer returns to `return_url`, or to a Cashfree default page if no return_url was set.
  - `_modal`: popup checkout. The returned promise resolves with `error`, `redirect`, or `paymentDetails`. A result does not mean success; still verify server-side.
  - A DOM element: inline checkout.
- The Elements docs say to load from the CDN and not bundle the SDK (for PCI). That conflicts with the npm guide. **UNVERIFIED** which one applies to hosted checkout; the npm package is officially documented for hosted checkout.
  Source: https://www.cashfree.com/docs/payments/online/element/introduction

### 5. Webhooks
- Payment events. Source: https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks

| `type` | `data.payment.payment_status` |
|---|---|
| `PAYMENT_SUCCESS_WEBHOOK` | `SUCCESS` |
| `PAYMENT_FAILED_WEBHOOK` | `FAILED` (adds `data.error_details{error_code,error_description,error_reason,error_source,...}`) |
| `PAYMENT_USER_DROPPED_WEBHOOK` | `USER_DROPPED` |
| `PAYMENT_CHARGES_WEBHOOK` | TDR/charges, sent after success |

- Payload shape:
  ```
  { data: { order: { order_id, order_amount, order_currency, ... },
            payment: { cf_payment_id, payment_status, payment_amount, payment_currency, payment_message, payment_time, payment_group, ... },
            customer_details, payment_gateway_details, error_details? },
    event_time, type }
  ```
  These paths are the same in versions 2023-08-01, 2025-01-01 and 2026-01-01; newer versions only add fields.
- Request headers: `x-webhook-signature`, `x-webhook-timestamp`, `x-webhook-version`, `x-webhook-attempt`, `x-idempotency-key` (2025-01-01+ only).
- The webhook version is chosen per endpoint in Merchant Dashboard > Webhook Configuration. To migrate, add a new endpoint with the new version, run both in parallel, then disable the old one. The `notify_url` endpoint, `NOTIFY_URL`, is a default that cannot be edited or deleted.
  Source: https://www.cashfree.com/docs/payments/webhooks
  - Which version `notify_url` deliveries use is **UNVERIFIED**. Read the `x-webhook-version` header.
- **Signature** (https://www.cashfree.com/docs/payments/webhooks). Every code sample (Node, Go, PHP, Java, Python) does the same thing:
  ```
  signedPayload = x-webhook-timestamp + rawBody          // plain concatenation, NO separator
  expected      = base64( HMAC_SHA256(key = PG client secret, msg = signedPayload) )
  valid         = constantTimeEqual(expected, x-webhook-signature)
  ```
  - The page's bash pseudocode writes `$timestamp.$payload`. That is PHP-style concatenation, and the real samples use no dot.
  - Use the **raw** body text. Parsing JSON can turn `170.00` into `170` and break the signature.
  - The SDK helper `PGVerifyWebhookSignature(signature, rawBody, timestamp)` exists for Node.
  - The page gives no replay window for the timestamp. **UNVERIFIED**; our own check of 5–10 min skew is a reasonable choice.
- Retries: Cashfree retries until it gets HTTP 200. The default policy is 3 retries at 2, 10 and 30 min. Custom endpoints can use fixed, exponential or custom policies (max 10). Delivery is **at-least-once**, so duplicates happen. Dedupe on the idempotency header (the prose says `x-idempotency-header`; the sample headers show `x-idempotency-key`, which is a doc inconsistency) or on `cf_payment_id` + `type`. No response timeout is documented (**UNVERIFIED**). (https://www.cashfree.com/docs/payments/webhooks)
- IP allowlist (port 443). Production: 52.66.101.190, 3.109.102.144, 18.60.134.245, 18.60.183.142. Sandbox: 52.66.25.127, 15.206.45.168. These may change.
  Source: https://www.cashfree.com/docs/payments/online/webhooks/security-checklist

### 6. Refunds: `POST /orders/{order_id}/refunds`
Source: https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create
- Body:
  - `refund_amount` (required): ≤ the transaction amount, decimals allowed.
  - `refund_id` (required): 3–40 chars, unique, alphanumeric recommended.
  - `refund_note` (optional): 3–100 chars. In sandbox, `SUCCESS`, `FAILED`, `PENDING` or `ACTIVE` simulates that status (case-sensitive).
  - `refund_speed` (optional): `STANDARD` (default) | `INSTANT`.
  - `refund_splits` (optional).
- Idempotency: send `x-idempotency-key` and retry with the same key. The response header `x-idempotency-replayed: true` marks a replay. Same key with a different body returns 422. A duplicate also returns 409.
  - Whether reusing `refund_id` alone returns 409 is likely but **UNVERIFIED**.
- Refunds are only allowed **within six months** of the successful transaction.
- Response fields: `cf_refund_id`, `refund_id`, `cf_payment_id`, `refund_amount`, `refund_charge`, `refund_status`, `status_description`, `refund_arn`, `refund_type`, `refund_speed{requested,accepted,processed,message}`, `created_at`, `processed_at`.
- `refund_status`: `SUCCESS`, `PENDING`, `PENDING_APPROVAL`, `CANCELLED`, `ONHOLD`, `REJECTED`.
- Multiple partial refunds: allowed. "Process multiple partial refunds for a single payment", and "The total of all partial refunds can't exceed the captured amount." No count limit or minimum amount is documented (**UNVERIFIED**).
  - If the balance is 0 and there is no refund wallet, the refund goes on hold.
  - Funds typically reach the customer in 7–10 business days.
  - Source: https://www.cashfree.com/docs/payments/manage/refunds/overview
- Webhooks: `REFUND_STATUS_WEBHOOK` with `data.refund.{cf_refund_id, refund_id, order_id, cf_payment_id, refund_amount, refund_status, ...}`. Auto-refunds come as `AUTO_REFUND_STATUS_WEBHOOK` with `data.auto_refund` and no `refund_id`.
  - The page shows only `SUCCESS`; the cancelled status string is **UNVERIFIED** (the v2022 docs say SUCCESS | CANCELLED).
  - That refund webhooks use the same signature scheme is **UNVERIFIED** on that page; assume the same PG scheme.
  - Source: https://www.cashfree.com/docs/api-reference/payments/latest/refunds/webhooks

### 7. Sandbox test data
Source: https://www.cashfree.com/docs/api-reference/payments/data-to-test-integration
- UPI VPAs:
  - `testsuccess@gocash`: success.
  - `testfailure@gocash`: failed.
  - `testuserdropped@gocash`: user dropped.
  - `testdeclineuser@gocash`: user cancels.
  - `testexpired@gocash`: session timeout.
  - `testinsufficientfunds@gocash`, `testinvalidpin@gocash`, `testbankdeclined@gocash`, plus about 15 more.
- Success cards (OTP `111000`, expiry `03/2028`, CVV `123`, name `Test`):
  - Visa debit `4706131211212123`.
  - Mastercard credit `5105105105105100`.
  - RuPay debit `6074825972083818`.
- No domestic **failure** card is listed. Use the UPI failure VPAs instead.
- Netbanking: "TEST Bank", code `3333` / `TESTR`.

### 8. Minimum amount
- `order_amount` minimum is **1** (INR, up to 2 decimals). (Create Order URL above)

## Gmail SMTP from Supabase Edge Functions

### 9. Outbound SMTP ports on Supabase Edge
- The official limits page says: "Outgoing connections to ports `25` and `587` are not allowed." Port **465 is not listed**, so it is allowed.
  Source: https://supabase.com/docs/guides/functions/limits
- Background: the docs used to say "25, 465, and 587". Issue supabase/supabase#21977 (2024-03-12) reported Gmail on 465 working. Commit `a7c6f3ec9a` (2024-03-19, "fix: edge functions removed port 465 (#22071)") then removed 465 from the blocked list.
  - https://github.com/supabase/supabase/issues/21977
  - https://github.com/supabase/supabase/blob/master/examples/edge-functions/supabase/functions/send-email-smtp/README.md
- Other limits: 256 MB memory, 2 s CPU per request (excluding async I/O), wall clock 150 s (Free) or 400 s (paid). (limits URL)
- Edge Functions have no static egress IP. Source: https://supabase.com/kb/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting

### 10. SMTP library
- Supabase's official example `send-email-smtp` uses **`npm:nodemailer@^9`** through the npm specifier, with `createTransport({host, port, secure, auth:{user, pass}})`. Its README says the port must not be 25 or 587.
  Source: https://github.com/supabase/supabase/tree/master/examples/edge-functions/supabase/functions/send-email-smtp
  - Gotcha in that example: it sets `secure: Boolean(Deno.env.get('SMTP_SECURE'))`, so any non-empty string, including `"false"`, becomes true. Hard-code `secure: true` for port 465.
- denomailer (`deno.land/x/denomailer`) has open issue EC-Nordbund/denomailer#82, "[Regression] Supabase edge functions v1.4.0 works, v1.5.0 and later doesn't". If we use it, pin 1.4.0. Prefer nodemailer.
  Source: https://github.com/EC-Nordbund/denomailer/issues/82
- Claims that "nodemailer does not run on edge" come from non-Supabase (Vercel/edge) contexts. The Supabase official example contradicts them for Deno.
  - Actual nodemailer `^9` behaviour on the current Supabase runtime is **UNVERIFIED** by our own test. Do a sandbox send before relying on it.

### 11. Gmail SMTP specifics
- Host `smtp.gmail.com`. Port **465 for SSL**; 587 for TLS/STARTTLS, which Supabase blocks. Authenticate with the full email address and an **app password**. That page also says "The sending limit is 2,000 messages per day", but that figure is for Google Workspace accounts.
  Source: https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app (was support.google.com/a/answer/176600)
- App passwords:
  - They require 2-Step Verification: "App passwords can only be used with accounts that have 2-Step Verification turned on."
  - The option is unavailable when 2SV uses security keys only, on work/school accounts, or with Advanced Protection.
  - Create one at myaccount.google.com/apppasswords.
  - **Changing the Google Account password revokes all app passwords**, which would silently break email sending.
  - Source: https://support.google.com/accounts/answer/185833
- Limits for a regular (consumer) Gmail account:
  - The "reached a limit for sending mail" error appears after more than **500 emails in a day**, or one email to more than 500 recipients.
  - Sending resumes within 1–24 hours.
  - Source: https://support.google.com/mail/answer/22839
  - Cc/Bcc recipients count toward the daily limit. Source: https://support.google.com/mail/answer/12921167
  - Whether SMTP sends have a separate, lower cap than web sends is **UNVERIFIED** (not stated).
- Bulk-sender rules (SPF/DKIM/DMARC requirements) apply at about 5,000 messages/day to Gmail recipients. That is not relevant at our volume.
  Source: https://support.google.com/mail/answer/81126
