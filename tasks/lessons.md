# Lessons

## Git

- **Never `git stash pop` without `git stash list` first, and never assume your `stash push` actually created a stash.** Two ways this bites: (1) `git stash -u` on a clean tree is a no-op → a following `git stash pop` pops a *pre-existing, unrelated* stash onto your branch. (2) `git stash push -- <paths>` where the paths are all *untracked* prints "Did you forget to 'git add'?" and stashes **nothing** → the following bare `git stash pop` again pops an unrelated stash. Hit BOTH times with the same old "Added Free-Size" WIP stash: 2026-07-13 (case 1) and **again 2026-07-21** (case 2 — scoped push of new untracked files stashed nothing, then `pop` clobbered `.gitignore`/`package.json`/`package-lock.json`/`ProductEditDialog.js` with conflict markers). **To A/B test a change against baseline, do NOT stash — use `git worktree add` for a clean checkout, or just read the committed file with `git show HEAD:<path>`.** If a stash is unavoidable: run `git stash list` first, verify `stash push` reported creating an entry, and always `pop`/`apply` by explicit `stash@{N}` ref. Recovery when you drop the wrong stash: the drop line prints the commit hash — `git stash store -m "msg" <hash>` puts it back (objects survive until GC).
- After any messy stash/merge, a broken `package.json` (conflict markers) makes CRA report `Error while parsing JSON ... position N` attributed to unrelated source files, and the error can persist from `node_modules/.cache` even after the file is fixed — `rm -rf node_modules/.cache` before re-diagnosing.

## Billing / CRA

- CRA CI build treats `react-hooks/exhaustive-deps` as an error. When threading a new value (e.g. `docType`) into a call inside a `useMemo`/`useEffect`, add it to that hook's dependency array or `npm run build` fails even though `npm test` passes.
- Tests: use `CI=true npx react-scripts test <path> --watchAll=false` (jest via react-scripts), not bare `npx jest`.
- Pre-existing failing suites (baseline, NOT from your change): `App.test.js` (stale CRA "learn react link"), `dashboardData`, `RevenueChart`, `BillTable` — 6 tests. Confirm a failure is yours by diffing against baseline before assuming your change broke something.
- CRA ESLint (`no-undef`) rejects `globalThis` in source. For a fetch wrapper use `(...args) => fetch(...args)`, not `fetch.bind(globalThis)`.

## Tooling: Playwright / Vercel

- **Playwright is installed globally** (`/opt/homebrew/lib/node_modules/playwright`), not as a project dep. ESM `import` ignores `NODE_PATH`, so a scratch `.mjs` must `import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs"` (absolute path). Per user CLAUDE.md: use Playwright CLI/Bash, never the MCP playwright tools.
- **Vercel preview deployments sit behind Deployment Protection (SSO).** Anonymous `curl`/Playwright gets a 302 → `vercel.com/...sso` or a 401/403 login wall — you cannot probe a preview URL without a protection-bypass secret (none set on this project). To integration-test rewrites without risking prod, run `vercel dev` locally (it applies `vercel.json` rewrites) and curl the paths, or deploy to prod and verify with rollback ready.
- When rewriting a JS regex literal with `sed`, unescaped `/` inside the pattern breaks it ("Invalid regular expression flags"). Use Python or write the file directly instead of `sed` for anything containing slashes.

## Storefront: Supabase / Cloudflare (see also memory project_supabase_cloudflare_cookie)

- `supabase.co` REST is behind Cloudflare, which sets a `__cf_bm` bot cookie. A stale `__cf_bm` makes background `fetch`/XHR hang forever (Cloudflare answers with a managed challenge a non-navigational request can't satisfy) → storefront stuck on skeletons, filters empty. Signature: healthy from curl + instant in a fresh/incognito browser, minutes-long hang in the afflicted browser. Fix shipped 2026-07-21: proxy the PostgREST data plane through a same-origin Vercel rewrite (`/sb-rest/* → supabase.co/rest/v1/*`) via a custom `global.fetch` in `src/lib/supabaseFetch.js`, so the browser never holds `__cf_bm`. Auth/storage left direct (low volume). Same wrapper adds timeout+retry to REST GETs.

## Storefront: PostgREST queries

- **PostgREST caps every response at 1000 rows, silently.** An un-ranged `select` on a big table (e.g. `productsizecolors`, 10.6k rows, open to anon for ALL products not just image-backed ones) returns the first 1000 with no error — Content-Range `0-999/10637`. Never build ID lists client-side from such a query. Filter child rows inside PostgREST with an aliased inner embed (`match:productsizecolors!inner(productid)` + `.in("match.color", ...)`), and do distinct/aggregate work in a SECURITY INVOKER RPC. Paging the rows instead overflows the GET URL (~3.7k IDs → 39k chars → HTTP 400).
- Playwright on the storefront: header promo line is also `aria-live`; target the product count by text (`/\d+ products?$/`).

## DB functions and migrations

- **plpgsql `RETURNS TABLE (email, ...)` makes `email` an OUT variable.** An unqualified `email` in the body's SQL then errors `42702 ambiguous`, but only on the code path that reaches it, so it hides until a fresh user calls it. Put `#variable_conflict use_column` right after `as $$`, or qualify columns with aliases. Test SECURITY DEFINER customer functions in `begin; insert into auth.users ...; set_config('request.jwt.claims', ...); set local role authenticated; ...; rollback;`.
- `_migrations` was backfilled 2026-10-21, so `npm run migrate` is safe again. Never put `BEGIN`/`COMMIT` in a new migration (`exec_sql` gives `0A000`).
- Never chain `git stash pop` after `;` when the `git stash` may not have run: it pops an older unrelated stash (this repo keeps `stash@{0}` "Added Free-Size").

## Tests: deferred auth-callback work

- Cart/Wishlist defer auth-callback work with `setTimeout(0)` (never await Supabase inside the callback). Every such timer must be cleared on unmount: CartContext didn't (fixed 2026-10-25), so a timer from one test fired during the next and called the shared `upsertItem` mock, which made "does not write through as a guest" flaky under full-suite load. In tests that assert nothing runs before unmount, fire the auth event with a synchronous `act(() => authCb(...))`: an async `act` can yield long enough for the timer to run.
- `jest.mock` calls are hoisted above imports by babel-jest, so putting imports first (ESLint `import/first`) is behaviour-neutral.
