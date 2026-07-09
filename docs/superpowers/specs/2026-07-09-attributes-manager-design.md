# Attributes Manager — Design Spec

Date: 2026-07-09
Status: Approved-pending-review

## Goal

Give superadmins one place to curate the catalog attribute vocabularies —
**Colors**, **Fabrics**, **Sizes** — after codes have been normalized. The
concrete gap that forces this: new colors added through the inline
`AddColorDialog` land with an **empty `families[]`**, so they are invisible to
the storefront family filter until someone buckets them. There is no UI to do
that today. Fabrics and Sizes get parity surfaces in the same build.

## Placement

New **"Attributes"** subtab inside `src/admin/pages/AdminPage.jsx` (the "Admin"
main tab, `/admin/admin-hub`). Reuses the existing shadcn `Tabs`. The subtab is
**superadmin-only** (matches Categories / Salespersons; add-new code dialogs
remain any-admin).

Inside the Attributes subtab, nested tabs: **Colors · Fabrics · Sizes**.

## Core rule: code is immutable in the manager

`code` is the primary key of `colors` / `fabrics` / `sizes` and an FK target
from `productsizecolors` (and, for colors, `mockup_variations` /
`productimages`). The manager therefore **never renames or deletes a code** — it
only edits the metadata around it. Adding a new code stays in the existing
`AddColorDialog` / `AddFabricDialog` / `AddSizeDialog` flows.

## Data model

### Colors — no schema change
Already: `colors(code PK, families text[], hex, sort_order, …)` and
`color_families(family PK, hex, sort_order, …)`. Manager writes `colors.families`
and manages `color_families` (add family, edit hex, reorder).

### Fabrics — schema change
Owner decision: **multiple families per fabric code**, and **no separate
`fabric_families` table** — modify the existing `fabrics` table and derive the
family vocabulary. (Fabric filter is text, not swatches, so a family table would
only add explicit ordering + empty families — not worth it. Colors keep
`color_families` solely because they need per-family hex.)

Migration `schema/migration_fabric_families.sql`:
1. Back up `fabrics` (code, family) → `_backup_fabrics_family_20260709`.
2. `alter table fabrics add column families text[] not null default '{}'`.
3. Backfill `update fabrics set families = array[family]`.
4. **Drop `family` column in the same migration** (owner decision). This is a
   coordinated release: the app build that reads `families[]` must deploy in the
   same window the migration is applied, or the storefront fabric filter breaks
   between apply and deploy. See "Release coordination".
5. Verify: every `products.fabric` still maps to a `fabrics.code` (unchanged);
   abort on gap.

Family vocabulary = `SELECT DISTINCT unnest(families) FROM fabrics`, ordered by
code-count desc then name. Introducing a new family = assigning a new name to a
code (implicit create). `fabrics.sort_order` is retained as a secondary order.

### Sizes — no schema change
`sizes(code PK, label, size_type, numeric_in, sort_order, …)`. Manager edits
`label`, `size_type`, `numeric_in`, `sort_order`. No family concept.

### RLS
Add `authenticated UPDATE` policies (idempotent drop-and-recreate) on:
`colors`, `color_families`, `fabrics`, `sizes`. Insert + read policies already
exist. Bundle these into the fabric migration or a small companion migration.

## UI — per tab

Shared: search box, shadcn `Table`, inline optimistic edits with `toast` on
save (matches existing admin pattern). Family membership is edited with a
**chip-toggle** built from existing `badge` + `button` (no multiselect dep):
each family renders as a chip; click toggles the code in/out of that family,
writing `families[]`.

- **Colors tab**
  - "Families" panel: list `color_families` with hex swatch; add family, edit
    hex, reorder (`sort_order`).
  - Codes table: each row = color code + family chip-toggles.
  - **"Show unassigned only"** toggle + count badge — surfaces colors with empty
    `families[]` (new colors needing buckets). This is the primary workflow.

- **Fabrics tab**
  - Codes table: fabric code + family chip-toggles (families derived from
    distinct values). No hex panel. New family created by typing a new name.

- **Sizes tab**
  - Codes table: code (read-only) + editable `label`, `size_type` (dropdown of
    the 5 fixed types), `numeric_in`, `sort_order`.

## App follow-ups (required by fabric `families[]`)

- `src/storefront/hooks/useShopFilters.js:143` — select `code, families,
  sort_order`; build `familyToCodes` by iterating each fabric's `families[]`;
  expand `family → codes WHERE family = ANY(families)`. Mirror the color path
  already in this file. Family display order by code-count desc.
- `src/admin/components/AddFabricDialog.js` — `family` single-select →
  `families[]` multi (chip-toggle or multi CustomDropdown); write `families`,
  drop the hardcoded `FABRIC_FAMILIES` constant in favor of derived list +
  free-type.
- `src/admin/components/ProductEditDialog.js:111` — no change (combobox still
  selects a single code; reads `code` only).

## Access control

Attributes subtab gated `superadmin`. Follows `AdminPage.jsx`'s existing
`isSuperAdmin` pattern (`TabsTrigger` + `TabsContent` rendered only when true).

## Release coordination (fabric column drop)

Because `fabrics.family` is dropped in the same migration:
1. Merge + build the app that reads `fabrics.families[]`.
2. Apply `migration_fabric_families.sql`.
3. Deploy the app in the same window.
Apply-then-deploy immediately; do not apply the migration against the currently
live (family-reading) build.

## Edge cases

- Concurrent edits: last write wins (single-owner admin tool; acceptable).
- A fabric ending with empty `families[]` after edits → allowed, but it drops
  out of the storefront filter (same semantics as colors). Surface via an
  "unassigned" indicator like colors if cheap; not required for v1.
- Renaming/removing a `color_families` family that codes still reference: block
  or cascade-clean. v1: **block delete of a referenced family**; renames out of
  scope (families are created via assignment, not renamed).
- Size `size_type` is constrained to the 5 known types (dropdown), never free
  text.

## Out of scope

- Per-color hex (`colors.hex`) — family-level hex only, as designed.
- Bulk import / CSV editing.
- Deleting or renaming codes (FK-protected).
- Renaming families.
- Fabric "unassigned only" filter (nice-to-have, not v1).

## Verification

- Migration dry-run (rollback) on live: fabric count unchanged, `families[]`
  backfilled = `array[family]`, `products.fabric` all map, then apply.
- Storefront fabric filter still returns the same product sets post-migration
  (family → codes via `families[]`).
- Add a color via `AddColorDialog` → appears under "Show unassigned only" →
  assign a family → leaves the unassigned list and appears in storefront filter.
- Superadmin sees Attributes subtab; plain admin does not.
- `npm run build` warning-clean; existing storefront filter tests pass.
