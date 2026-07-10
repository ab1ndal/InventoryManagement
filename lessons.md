# Lessons

Engineering lessons learned while working this repo. Newest first. Each entry: what surprised us, why it matters, how to act next time.

## 2026-07-09 — Storefront Phase 0 security work

### Supabase RLS is ROW-level, not column-level
- `migration_storefront_public_read.sql` grants anon `for select ... using (true)` on `products`. That exposes **every column** of matching rows — including `products.purchaseprice` (cost/margin) — to the anon key. Confirmed live: `/rest/v1/products?select=purchaseprice` returned cost prices.
- **Why it matters:** an RLS policy that looks like "read access" silently leaks sensitive columns. RLS cannot hide a column.
- **Next time:** to hide a column from a role, use Postgres **column-level grants**: `revoke select on <table> from <role>; grant select (<safe cols>) on <table> to <role>;`. The RLS policy stays; column privileges do the hiding. Then audit client `.select("*")` calls — they break under column grants (PostgREST errors when `*` expands to a denied column). Only `useProduct.js` used `*` in the storefront.

### Postgres views run with definer rights → bypass RLS
- `mockups_view` (definer rights) exposed `purchaseprice` to anon even though a view "should" respect RLS. It doesn't, unless created with `security_invoker = true`.
- **Next time:** for any view reachable by anon, either set `security_invoker = true` or revoke anon SELECT on the view. Don't assume a view inherits the base table's RLS.

### CRA only inlines REACT_APP_* vars actually referenced in compiled src/
- The audit claimed `REACT_APP_SUPABASE_SERVICE_ROLE_KEY` was "inlined into the browser bundle." It was **not** — `grep src/` returned zero refs; the only consumer is `scripts/migrate.js` (a Node build script, not compiled). CRA string-replaces `process.env.REACT_APP_*` **only where the reference appears in compiled source**.
- **Why it matters:** don't report a bundle leak you haven't verified. Wrong severity erodes trust.
- **Next time:** verify with `grep -rn <VAR> src/` and a `grep <value> build/` after `npm run build`. The `REACT_APP_` prefix is still a latent footgun (one future src ref leaks it) — worth renaming, but describe it as latent, not active.

### Resolve conflicting constraints BEFORE building/deploying — not by iterating implementations
- The bill-WhatsApp feature churned: built `wa.me` → reverted for Meta Cloud API → wrote a Meta setup doc + redeployed → reverted back to `wa.me` and deleted everything. Cause: the constraints (free / fully-automated / zero-setup) were surfaced one at a time across messages, and each new one invalidated the last build.
- **Why it matters:** deploying + undeploying an edge function and writing throwaway docs is wasted, and each deploy touched prod.
- **Next time:** for any feature gated on an external service, state the tradeoff triangle up front (here: automated WhatsApp needs a paid/verified API; the only free path is `wa.me` click-to-chat which is semi-manual). Get the decision on that triangle BEFORE writing code — a 30-second "pick a corner" question beats three implementations. Confirmed decision: `wa.me`, ₹0, staff taps send; no backend, no edge function.

### Repo source can drift from what's actually deployed — check the live artifact before redeploying
- Redeployed `supabase/functions/send-bill-sms` from the repo assuming repo == live. The repo file was on **Meta Cloud API** (`WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN/TEMPLATE_NAME`), but the project's set secrets were **MSG91** (`MSG91_WHATSAPP_NUMBER/TEMPLATE/SENDER_ID`). The two never matched — the Meta secrets were never set, so the deployed function returns `500 "WhatsApp not configured"`.
- **Why it matters:** deploying a stale repo version over a live function can regress prod. Even when it doesn't (here the config was already broken), you can't reason about the failure without knowing what was actually running.
- **Next time:** before `supabase functions deploy`, (1) diff the repo function against `git log -- <path>` to see recent provider/API churn, (2) list `supabase secrets list` and confirm the env vars the code reads are actually set, (3) prefer NOT redeploying a function whose only needed change is unrelated (auth/CORS) until the provider/secret mismatch is resolved. The plan HAD a "verify profiles/secrets before deploy" step — I skipped it. Don't skip pre-deploy verification steps.

### Verify external-account/secret assumptions before shipping the security change that depends on them
- The Task 3 plan explicitly said "verify profiles columns / secrets before deploy." I wrote+deployed the function without running that step, so a provider/secret mismatch surfaced only when the user hit it in the UI.
- **Next time:** treat plan verification steps as gates, not suggestions — especially the ones guarding an irreversible/outward action (deploy).

### Trace the real leak path before fixing
- The audit named only `mockups_view`; the bigger hole was the direct `products` table policy. Fixing only the view would have left cost prices readable via `/rest/v1/products`.
- **Next time:** for a data-exposure finding, probe every path to the sensitive column (direct table, each view, each RPC) as the actual attacker role before designing the fix.
