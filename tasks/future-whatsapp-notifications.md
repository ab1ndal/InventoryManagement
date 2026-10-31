# Future phase: WhatsApp notifications (shop + customers)

Written 2026-10-30. Status: roadmap, not scheduled.

## Why

- **Shop:** staff only use WhatsApp. Today a paid online order sends one email (`email_shop` job → `GMAIL_USER`
  inbox) and nothing else; admin has no alert. Orders can sit unseen.
- **Customers:** email is optional at checkout (`CheckoutPage.jsx`). A phone-only customer gets no confirmation,
  no shipped/tracking, no delivered message, and can't log in (magic link is email). Only the Track order page
  (order ref + phone) and Shiprocket's own buyer messages (if enabled on the plan, unchecked) reach them.

## Recommended approach: WhatsApp Business Platform (Meta Cloud API), direct

- Official, reliable; ~₹0.12–0.15 per utility message in India.
- Needs: Meta Business account (verified), a **dedicated number not active on the WhatsApp app**, approved
  message templates (utility), a permanent system-user access token stored as a Supabase secret.
- Rejected: unofficial free gateways (CallMeBot etc.) — no reliability guarantee and order PII (name, phone,
  address) passes through a third party. BSPs (Interakt, Gupshup) work too but add a monthly fee over Meta's rate.

## Build (small; slots into the existing order_jobs pattern)

1. Shop alert: new job kind `whatsapp_shop`, enqueued next to `email_shop` on payment; sends a template with
   order ref, customer, items, amount, fulfilment, admin link to one or more shop numbers (secret).
2. Customer messages at the same milestones as the emails: confirmed, shipped (tracking link), delivered,
   ready for pickup. Send to `contact_phone` for every order, so phone-only customers are covered.
3. Same rules as email jobs: missing config resolves `{sent:false}` (no retry storm), real failure retries with
   backoff, at-least-once accepted.
4. Opt-in wording at checkout for customer WhatsApp (Meta policy).

## Owner steps before build

- Create/verify Meta Business, add the WhatsApp number, submit templates (Claude drafts the wording).

## Interim (no code)

- Gmail app on the shop phone with a filter on subject "New online order" → notifications on for that label.
