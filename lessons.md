# Lessons

Engineering lessons learned while working this repo. Newest first. Each entry: what surprised us, why it matters, how to act next time.

## 2026-07-11 — Storefront blank-store debug (Cloudflare cookie + N+1)

### A "works-for-me, broken-for-them" bug: get the USER's Network/Console FIRST
- Spent many turns probing the live site from my own machine (headless Playwright, curl) — everything worked, so I kept concluding "your browser / stale cache." The user had to push repeatedly ("same after hard refresh", "broke after normalization", "cleared cookies helped") before the real cause surfaced. The single most decisive clue — their DevTools Network showing **zero requests to `supabase.co`** — I should have asked for on turn 1.
- **Why it matters:** when a failure reproduces only in the user's environment, my own environment can't diagnose it. Hours went into confirming the site works (which was never in question) instead of capturing the client-side evidence that localizes the fault.
- **Next time:** for any bug that reproduces for the user but not for me, request the user's **Network tab (any requests? status? blocked?) and Console** before running my own probes. "Zero requests in Network" instantly rules out code/CORS/CSP and points at client/network/CDN.

### Don't deflect to "it's your cache/extensions" — prove each layer, in order
- I asserted "stale cache," then "extension," then "service worker" — each plausible, each wrong, stated too confidently. The user disproved them one by one (hard-refresh didn't help; disabling extensions didn't help; no SW ever existed).
- **Why it matters:** confident wrong diagnoses erode trust and send the user on pointless UI hunts.
- **Next time:** enumerate the normal-vs-incognito differences (extensions, localStorage, cookies, cache, service worker) and eliminate them with a **test each**, not an assertion. Incognito-works + extensions-off-still-broken cleanly isolated it to cookies — that comparison should have come early.

### Supabase is Cloudflare-fronted → `__cf_bm` bot cookie can silently block all requests
- Root cause of the blank store: a stale `__cf_bm` (Cloudflare Bot Management) cookie on `supabase.co`. HttpOnly, app can't touch it. When invalid it blocks requests with **no console error and nothing in Network**. Clearing cookies fixed it. The app sets no cookies itself (`createClient` default = localStorage sessions).
- **Why it matters:** a whole class of "blank page, no errors, no requests" bugs on a Supabase/Cloudflare stack trace to this, not to app code.
- **Next time:** `curl -D - <supabase-url>` — if `server: cloudflare` + `set-cookie: __cf_bm`, suspect the CDN cookie for silent-block symptoms. See memory `project_supabase_cloudflare_cookie`.

### N+1 has a second failure mode beyond latency: it looks like a bot
- The ~140-requests-per-load N+1 wasn't just slow — the burst is what tripped Cloudflare's bot protection into the challenge state that set the bad cookie. Fixing the N+1 (140→13) removed both the latency AND the trigger.
- **Next time:** treat request-count blowups as a rate-limit/WAF risk, not only a performance one. Batch aggressively; a burst against a CDN-fronted API can get you challenged/blocked.

### Verify visually (screenshot), not just by DOM node counts
- I reported "filters render" from `locator().count()` while the user's screenshot showed empty panels. The user had to explicitly say "use playwright and verify." A screenshot I actually looked at would have grounded the conversation sooner.
- **Next time:** for any UI-state claim, capture and read a screenshot — counts can be true while the visible result differs (mid-load, off-screen, wrong element).

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
