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

### Trace the real leak path before fixing
- The audit named only `mockups_view`; the bigger hole was the direct `products` table policy. Fixing only the view would have left cost prices readable via `/rest/v1/products`.
- **Next time:** for a data-exposure finding, probe every path to the sensitive column (direct table, each view, each RPC) as the actual attacker role before designing the fix.
