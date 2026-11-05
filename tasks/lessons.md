# Lessons

## Git

- **Never `git stash pop` without `git stash list` first, and never assume your `stash push` actually created a stash.** Two ways this bites: (1) `git stash -u` on a clean tree is a no-op → a following `git stash pop` pops a *pre-existing, unrelated* stash onto your branch. (2) `git stash push -- <paths>` where the paths are all *untracked* prints "Did you forget to 'git add'?" and stashes **nothing** → the following bare `git stash pop` again pops an unrelated stash. Hit BOTH times with the same old "Added Free-Size" WIP stash: 2026-07-13 (case 1) and **again 2026-07-21** (case 2 — scoped push of new untracked files stashed nothing, then `pop` clobbered `.gitignore`/`package.json`/`package-lock.json`/`ProductEditDialog.js` with conflict markers). **To A/B test a change against baseline, do NOT stash — use `git worktree add` for a clean checkout, or just read the committed file with `git show HEAD:<path>`.** If a stash is unavoidable: run `git stash list` first, verify `stash push` reported creating an entry, and always `pop`/`apply` by explicit `stash@{N}` ref. Recovery when you drop the wrong stash: the drop line prints the commit hash — `git stash store -m "msg" <hash>` puts it back (objects survive until GC).
- After any messy stash/merge, a broken `package.json` (conflict markers) makes CRA report `Error while parsing JSON ... position N` attributed to unrelated source files, and the error can persist from `node_modules/.cache` even after the file is fixed — `rm -rf node_modules/.cache` before re-diagnosing.

## Billing / CRA

- CRA CI build treats `react-hooks/exhaustive-deps` as an error. When threading a new value (e.g. `docType`) into a call inside a `useMemo`/`useEffect`, add it to that hook's dependency array or `npm run build` fails even though `npm test` passes.
- Tests: use `CI=true npx react-scripts test <path> --watchAll=false` (jest via react-scripts), not bare `npx jest`.
- Pre-existing failing suites (baseline, NOT from your change): `App.test.js` (stale CRA "learn react link"), `dashboardData`, `RevenueChart`, `BillTable` — 6 tests. Confirm a failure is yours by diffing against baseline before assuming your change broke something.
- html2canvas serializes an inline `<svg>` with its inline styles, so a margin on the SVG shifts the drawing inside its own image (browser layout looks right, PDF is wrong). Put the margin on a wrapper div. Check bill layout changes in the generated PDF, not just the DOM.
- A running dev server shares `node_modules/.cache/.eslintcache` with `npm run build`, so a mid-edit lint result can fail the build with an error the code no longer has (2026-11-01: "`setSearchInput` never used" while it was used). If a lint error contradicts the file, delete that cache file and rebuild.
- `ProductEditDialog` callers pass new `product`/`variants` objects every render, so its form load must stay guarded to once per opening. Removing the guard wipes edits on any parent re-render, including the failure toast.
- CRA ESLint (`no-undef`) rejects `globalThis` in source. For a fetch wrapper use `(...args) => fetch(...args)`, not `fetch.bind(globalThis)`.

## Tooling: Playwright / Vercel

- **Playwright is installed globally** (`/opt/homebrew/lib/node_modules/playwright`), not as a project dep. ESM `import` ignores `NODE_PATH`, so a scratch `.mjs` must `import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs"` (absolute path). Per user CLAUDE.md: use Playwright CLI/Bash, never the MCP playwright tools.
- **Vercel preview deployments sit behind Deployment Protection (SSO).** Anonymous `curl`/Playwright gets a 302 → `vercel.com/...sso` or a 401/403 login wall — you cannot probe a preview URL without a protection-bypass secret (none set on this project). To integration-test rewrites without risking prod, run `vercel dev` locally (it applies `vercel.json` rewrites) and curl the paths, or deploy to prod and verify with rollback ready.
- `vercel curl /path --deployment <url> -- -sS -D - -o /dev/null` reaches a protected preview, so the "cannot probe a preview" note above no longer holds. With an empty `--deployment` it hits **production** without warning, so check the variable first. `vercel ls` prints its table to stderr: use `2>&1` when parsing.
- A `vercel.json` header overrides an external rewrite's response header (used to replace Storage's `x-robots-tag: none`). Vercel's edge did not cache that rewrite: always `MISS`, even with `x-vercel-enable-rewrite-caching` and `CDN-Cache-Control`.
- CRA's jest has no global `fetch`, even with `@jest-environment node`. To run `src/seoRender` against live data, use a temp test whose `rest` shells out to `curl`, and delete it afterwards.
- The build renames `index.html` to `shell.html`. A local static server for `build/` must fall back to that.
- When rewriting a JS regex literal with `sed`, unescaped `/` inside the pattern breaks it ("Invalid regular expression flags"). Use Python or write the file directly instead of `sed` for anything containing slashes.

## Storefront: Supabase / Cloudflare (see also memory project_supabase_cloudflare_cookie)

- `supabase.co` REST is behind Cloudflare, which sets a `__cf_bm` bot cookie. A stale `__cf_bm` makes background `fetch`/XHR hang forever (Cloudflare answers with a managed challenge a non-navigational request can't satisfy) → storefront stuck on skeletons, filters empty. Signature: healthy from curl + instant in a fresh/incognito browser, minutes-long hang in the afflicted browser. Fix shipped 2026-07-21: proxy the PostgREST data plane through a same-origin Vercel rewrite (`/sb-rest/* → supabase.co/rest/v1/*`) via a custom `global.fetch` in `src/lib/supabaseFetch.js`, so the browser never holds `__cf_bm`. Auth/storage left direct (low volume). Same wrapper adds timeout+retry to REST GETs.

## Storefront: PostgREST queries

- **PostgREST caps every response at 1000 rows, silently.** An un-ranged `select` on a big table (e.g. `productsizecolors`, 10.6k rows, open to anon for ALL products not just image-backed ones) returns the first 1000 with no error — Content-Range `0-999/10637`. Never build ID lists client-side from such a query. Filter child rows inside PostgREST with an aliased inner embed (`match:productsizecolors!inner(productid)` + `.in("match.color", ...)`), and do distinct/aggregate work in a SECURITY INVOKER RPC. Paging the rows instead overflows the GET URL (~3.7k IDs → 39k chars → HTTP 400).
- Playwright on the storefront: header promo line is also `aria-live`; target the product count by text (`/\d+ products?$/`).

## Admin UI

- An `sr-only` element inside a `truncate` span escapes the clip because it is absolutely positioned, and widened the page to 854px at a 360px viewport. Put `relative` on the truncating span.
- Returning a supabase query builder from an `async` function runs it, because the builder is thenable. Build shared queries in a plain function.

## DB functions and migrations

- `o.courier in (...)` is NULL when courier is NULL, so inside `not (...)` it lets NULL-courier (Shiprocket) orders through. Use `coalesce(o.courier, '')` in status guards.

- `order_events.to_status = 'paid'` does not mean payment: `sent_back` and `rebooked` write it too, and every same-status event (`availability`) repeats it. Reading when something happened: payment is `kind = 'paid'`, ignore events before the latest `sent_back`/`rebooked`, and delivery is `orders.delivered_at` (staff can backdate it, the event holds the click).

- **plpgsql `RETURNS TABLE (email, ...)` makes `email` an OUT variable.** An unqualified `email` in the body's SQL then errors `42702 ambiguous`, but only on the code path that reaches it, so it hides until a fresh user calls it. Put `#variable_conflict use_column` right after `as $$`, or qualify columns with aliases. Test SECURITY DEFINER customer functions in `begin; insert into auth.users ...; set_config('request.jwt.claims', ...); set local role authenticated; ...; rollback;`.
- `_migrations` was backfilled 2026-10-21, so `npm run migrate` is safe again. Never put `BEGIN`/`COMMIT` in a new migration (`exec_sql` gives `0A000`).
- `FOR UPDATE` blocks the `KEY SHARE` lock a foreign key check takes. A function that locks variants or a customer and then waits for the bill counter deadlocks against `online_order_create_bos`, which holds the counter and then inserts rows referencing them. Use `FOR NO KEY UPDATE` there: it still serializes stock and credit changes. Proven by the counter-holder case in `schema/test_harness/concurrency_test.sh`.
- `supabase db query -f` returns only the last result set of a multi-statement file, and a final `rollback` does not count as one. Put the counts `select` just before the `rollback`.
- Never chain `git stash pop` after `;` when the `git stash` may not have run: it pops an older unrelated stash (this repo keeps `stash@{0}` "Added Free-Size").

## Tests: deferred auth-callback work

- Cart/Wishlist defer auth-callback work with `setTimeout(0)` (never await Supabase inside the callback). Every such timer must be cleared on unmount: CartContext didn't (fixed 2026-10-25), so a timer from one test fired during the next and called the shared `upsertItem` mock, which made "does not write through as a guest" flaky under full-suite load. In tests that assert nothing runs before unmount, fire the auth event with a synchronous `act(() => authCb(...))`: an async `act` can yield long enough for the timer to run.
- `jest.mock` calls are hoisted above imports by babel-jest, so putting imports first (ESLint `import/first`) is behaviour-neutral.

## Testing writes without touching prod

- To test a supabase-js write path with zero prod changes: (1) run the real code with `createClient(..., { global: { fetch: fakeFetch } })` to capture the exact PostgREST requests, then (2) replay the captured row on prod inside `begin; set local role service_role; ...; rollback;` via `supabase db query --linked -f`. Pass explicit ids (`customerid: -1`, `overriding system value` for identity columns) — a rolled-back `nextval` still advances the sequence. Replay with an explicit column list: `json_populate_record` turns omitted keys into NULL instead of column defaults, unlike PostgREST (NOT NULL defaults like `marketing_opt_in` then fail).
- Node ESM can't resolve extensionless imports, so `src/` modules shared with a Node CLI use `./x.js` import paths (CRA/jest accept both). Don't add `"type": "module"` to `src/` — webpack would then demand fully specified imports app-wide.

## Edge functions

- Deploying without `--no-verify-jwt` silently turned the gateway check on for webhooks on 2026-10-31. Callers with no user token then get 401 `UNAUTHORIZED_NO_AUTH_HEADER` before any of our code runs, while `cron.job_run_details` still says `succeeded`, because it only records that the HTTP request was queued. Read `net._http_response` for the real status. `supabase/config.toml` now fixes the setting.

## Database access

- Production rejects `UPDATE` without a `WHERE` ("UPDATE requires a WHERE clause", through `exec_sql`), and the local test database does not. Use `where true` for a deliberate full-table backfill. The migration runs in one transaction, so a refusal leaves nothing behind.
- `authenticated` is both staff and customers, and row security cannot hide a column. Read private columns through a view or definer function guarded by `is_admin()`. After `migration_cost_column_lockdown.sql`, a new `products` column needs its own `grant select` to `authenticated`, or admin and storefront reads of it fail.
- Before removing a column grant, search `pg_proc` for functions that read it without `security definer`: they run as the caller and break too.
