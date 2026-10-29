# Customer login email (Supabase Auth) — plan

Status 2026-10-29. Owner goal: customers who sign in by email link get a branded email that
lands in the inbox, sent from bindalscreations@gmail.com.

## Where we are (verified 2026-10-29)

- Custom SMTP ON in Supabase Auth: smtp.gmail.com:465, user + sender bindalscreations@gmail.com,
  sender name "Bindal's Creation", password = Gmail app password "Supabase Auth" (owner entered).
  Auth email limit rose 2/h → 30/h (auth log 10:41:42 PT).
- Delivery works: test emails to abindal295@gmail.com arrive from "Bindal's Creation", but in Spam
  ("similar to messages identified as spam").
- Templates "Confirm sign up" and "Magic link or OTP" saved with branded subject/body; dashboard
  reloads the new text; auth logged "reloading api with new configuration" at 10:47:31 and 10:48:21.
- **Problem:** emails sent 10:50 and 10:53 still carry Supabase's default subject and body
  ("Confirm Your Signup" / "Confirm your mail"). No Auth Hooks configured. Cause unknown
  (guess: auth server's template cache not refreshed by the config reload).
- Note: a brand-new or unconfirmed address gets the "Confirm sign up" template even from
  signInWithOtp (supabase discussion #28947); returning customers get "Magic link or OTP".
- Redirect: site sends emailRedirectTo `https://www.bindalscreations.com/account`; allow-list has
  only bare domains (no `/**`). Unverified whether the link lands on /account.

## Step 1 — retest after waiting (cheap)

- [ ] ~11:10 PT: send one test (`POST /auth/v1/otp`, create_user true, redirect_to /account) to
  abindal295@gmail.com. Pass = subject "Your sign-in link for Bindal's Creation".
- [ ] Owner clicks the link: pass = lands on /account signed in. If it lands on the homepage, add
  `https://www.bindalscreations.com/**` and `https://bindalscreations.com/**` to Redirect URLs.
- [ ] Owner marks the email "Not spam".
- If templates now apply → done; skip to "Deliverability" below.

## Step 2 — Supabase support ticket (if Step 1 still shows the default template)

Draft (owner sends from the dashboard, Pro plan support):
> Project epotsxdugwfhyeiudjox. Custom SMTP enabled (Gmail). We saved custom "Confirm sign up" and
> "Magic link or OTP" templates on 2026-10-29 ~10:47 PT; the dashboard shows them and auth logged a
> config reload, but every auth email since (10:50, 10:53, …) uses the default subject and body.
> No auth hooks. Please check why the saved templates are not used.

Wait up to 2 working days. Do Step 3 only if support can't fix it or the owner doesn't want to wait.

## Step 3 — fallback: our own Send Email hook (code change)

Supabase "Send Email" auth hook: when enabled, Auth calls our HTTPS endpoint instead of SMTP; we
render and send the email. Reuses the Gmail mailer the order emails already use.

**Spec**
- New Edge Function `auth-send-email` (`--no-verify-jwt`; authenticity via the hook signature).
- Verify every request with standardwebhooks 1.0.0: secret `SEND_EMAIL_HOOK_SECRET` (format
  `v1,whsec_<base64>`; strip the prefix), `wh.verify(rawBody, headers)`. Bad signature → 401.
- Payload: `user.email`, `email_data.{token, token_hash, redirect_to, email_action_type, site_url}`.
- Link: `https://epotsxdugwfhyeiudjox.supabase.co/auth/v1/verify?token=<token_hash>&type=<email_action_type>&redirect_to=<redirect_to>`
  (all URL-encoded).
- Handle `signup` and `magiclink` (and `email` for OTP) with one branded "sign in" email; also
  `recovery` (admin reset-password flow uses it) with a "reset your password" email. Any other
  action type → send a plain generic email rather than fail, and log it.
- Send through `_shared/mailer.ts` (GMAIL_USER / GMAIL_APP_PASSWORD), from "Bindal's Creation".
  Subject + text + simple HTML; include shop address and WhatsApp (same copy as the saved templates).
- Response: 200 `{}` on success; on mailer failure 500 with `{error:{http_code,message}}` so Auth
  reports the failure to the caller (no silent success).
- Structured logs: event, action type, user id (no email address, no token).

**Plan**
1. Read `_shared/mailer.ts`, `_shared/http.ts`, an existing `--no-verify-jwt` function for patterns.
2. TDD in `supabase/functions/auth-send-email/handler_test.ts`: bad/missing signature → 401;
   signup, magiclink, recovery build the right verify URL and subject; mailer error → 500;
   unknown action → generic email, 200.
3. Implement `handler.ts` + `index.ts`; `deno test -A` green.
4. Owner: Auth → Hooks → Add "Send Email" hook → HTTPS → function URL; copy the generated secret
   into Supabase secrets as `SEND_EMAIL_HOOK_SECRET` (owner's terminal, never chat).
5. Deploy function, then enable the hook; test email to abindal295@gmail.com; click-through to /account.
6. PR, merge; record in tasks/todo.md.

Out of scope: SMS/phone OTP, MFA notifications, i18n.

## Deliverability (whichever path)

Gmail-to-Gmail from a personal Gmail account with link-only content scores as spam-like. If
"Not spam" + branded copy doesn't move it to the inbox after a few sends:
- Move auth (and order) email to a transactional sender on our own domain (Resend or Brevo, free at
  this volume): add SPF/DKIM/DMARC DNS records on bindalscreations.com, sender e.g.
  `orders@bindalscreations.com`. Then point Supabase SMTP (or the hook's mailer) at it.
- Decide after Step 1/2; needs DNS access for the domain.
