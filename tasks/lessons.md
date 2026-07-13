# Lessons

## Git

- **Never `git stash` to free the tree for a `git checkout` when the tree is already clean.** `git stash -u` on a clean tree is a no-op (creates no stash), so a following `git stash pop` pops a *pre-existing, unrelated* stash from the stash list onto your branch — leaving conflict markers in files it never should have touched (hit 2026-07-13: popped an old "Added Free-Size" WIP into a billing branch, breaking package.json). If the tree is committed-clean, just `git checkout <ref>` directly. If you must stash, check `git stash list` first and pop by explicit ref.
- After any messy stash/merge, a broken `package.json` (conflict markers) makes CRA report `Error while parsing JSON ... position N` attributed to unrelated source files, and the error can persist from `node_modules/.cache` even after the file is fixed — `rm -rf node_modules/.cache` before re-diagnosing.

## Billing / CRA

- CRA CI build treats `react-hooks/exhaustive-deps` as an error. When threading a new value (e.g. `docType`) into a call inside a `useMemo`/`useEffect`, add it to that hook's dependency array or `npm run build` fails even though `npm test` passes.
- Tests: use `CI=true npx react-scripts test <path> --watchAll=false` (jest via react-scripts), not bare `npx jest`.
