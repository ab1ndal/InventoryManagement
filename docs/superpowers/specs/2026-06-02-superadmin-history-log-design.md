# Superadmin History Log — Design

**Date:** 2026-06-02
**Status:** Approved (design)

## Goal

A superadmin-only "History" tab showing an audit log of every database-mutating
action performed through the app. Each entry must clearly answer **who** did
**what**, with a summary descriptive enough to identify the exact change.

## Scope

### In scope (v1)

Log meaningful mutations across:

- **Inventory** — product create / edit / delete; variant add / delete; stock increase / decrease
- **Mockups** — add / edit / delete
- **Bills** — bill create; bill void + delete; bill edit
- **Customers** — add / edit / delete
- **Suppliers** — Supplier - add / edit / delete, Supplier Bill - Add/edit/delete
- **Discounts** — add / edit / delete
- **Categories** — add / edit / delete
- **Users** — role change / active-status change
- Salesperson - Add/edit/delete

### Out of scope (v1)

- Logging of read/select operations
- Retroactive backfill of historical actions (log starts empty)
- DB-level triggers (app-level logging only — see Approach)
- Full before/after JSON snapshots (summary string captures the change instead)
- Edit/delete of log entries (append-only; not user-editable)

## Approach

**App-level logging helper**, not DB triggers.

Rationale: the user wants *semantic, action-level* entries ("Created bill #1042",
"Decreased stock of variant…") rather than raw row diffs. Triggers see only
row-level table changes and cannot easily express "a bill was created" as one unit
or name the variant/product in human terms. App-level logging at action boundaries
gives readable summaries. Trade-off accepted: actions performed outside the app
(direct SQL, other clients) are not captured. RLS still restricts who can read the
log as defense-in-depth.

## Data Model

New table `activity_log` (new migration `schema/migration_activity_log.sql`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` generated always as identity, PK | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | event time; stored UTC, **always displayed in IST (Asia/Kolkata)** in the UI |
| `actor_id` | `uuid` | auth user id; FK → `profiles(id)`. Email is **not** denormalized — derived by joining `profiles` on `actor_id` at read time |
| `action` | `text NOT NULL` | `create` \| `update` \| `delete` |
| `entity_type` | `text NOT NULL` | `product` \| `variant` \| `stock` \| `mockup` \| `bill` \| `customer` \| `supplier` \| `supplier_bill` \| `discount` \| `category` \| `user` \| `salesperson`. Free text — extensible for future entity kinds |
| `entity_id` | `text` | primary key of affected row (variant id, productid, billid, …); text because IDs are mixed types |
| `summary` | `text NOT NULL` | human-readable description of the exact change |

No `actor_email` column — the email is joined from `profiles` via `actor_id` for
display. (Trade-off: if a profile row is ever hard-deleted the email is lost; the
FK + soft-delete (`is_active`) pattern in use makes this acceptable.)

Index: `(created_at desc)`; secondary indexes on `actor_id`, `entity_type`, `action`
to support filters.

### RLS

- Enable RLS on `activity_log`.
- **INSERT**: allowed for any authenticated user whose `profiles.role` is `admin`
  or `superadmin`. Enforce `actor_id = auth.uid()` in the policy `WITH CHECK`.
- **SELECT**: allowed **only** when `profiles.role = 'superadmin'`. Non-superadmins
  cannot read the log even via direct API calls.
- **UPDATE / DELETE**: no policy → denied for everyone (append-only).

## Logging Helper

`src/lib/activityLog.js`

```js
logActivity({ action, entityType, entityId, summary })
```

Behavior:

- Resolves current user from the active Supabase session
  (`supabase.auth.getUser()`), sets `actor_id` only (email derived at read time).
- Inserts one row into `activity_log`.
- **Fire-and-forget, never blocks**: wrapped in try/catch; on failure logs to
  `console.error` only. Never throws, never surfaces a toast, never affects the
  user's action outcome. Audit gaps are tolerated in exchange for UX safety.
- Called **after** the underlying mutation succeeds.

### Granularity rule

One log entry per *meaningful* change, **not** per DB statement.

- Multi-step actions that are conceptually one unit (e.g. bill creation writing to
  `bills` + `bill_items` + `bill_salespersons`) → **one** entry.
- An action that changes multiple distinct things the superadmin cares about emits
  **multiple** entries — e.g. a product save that adds one variant and changes
  stock on another → one `variant`/create entry + one `stock`/update entry.
- An edit changing several scalar fields at once → **one** entry listing the
  changed fields. Applies to **bills, products, customers, and mockups** (and any
  other record-edit): summary lists only fields that actually changed, each as
  `field old→new`.
- Trivial intermediate writes (join/link rows, refetch, denormalization updates)
  are not logged.

**Human-readable rule:** the `summary` must always be plain English a person can
read at a glance. **Never put UUIDs (or other opaque machine ids) in the summary.**
Refer to entities by human labels: product code (`BC25001`) + name, variant
size/color, customer/supplier/salesperson name, bill number, discount code,
category name, user email. The raw machine id of the affected row goes in the
`entity_id` column only — never in `summary`.

### Summary templates

- `Added variant Red / M to product BC25001 — Cotton Kurta`
- `Deleted variant Red / M from product BC25001 — Cotton Kurta`
- `Decreased stock of Red / M, product BC25001 — Cotton Kurta: 10 → 7 (-3)`
- `Increased stock of Red / M, product BC25001 — Cotton Kurta: 7 → 12 (+5)`
- `Created product BC25001 — Cotton Kurta`
- `Edited product BC25001 — name "Kurta"→"Cotton Kurta", retailprice 1200→1400`
- `Deleted product BC25001 — Cotton Kurta`
- `Added mockup "Summer Tee" for product BC25001` / `Edited mockup "Summer Tee" — status Pending→Approved` / `Deleted mockup "Summer Tee"`
- `Created bill #1042 for customer Ravi Kumar — ₹3,200, 4 items`
- `Edited bill #1042 — total ₹3,200→₹2,900, items 4→3`
- `Voided & deleted bill #1042`
- `Added customer Ravi Kumar (+91…)` / `Edited customer Ravi Kumar …` / `Deleted customer Ravi Kumar`
- `Added supplier Acme Textiles` / `Edited supplier Acme Textiles …` / `Deleted supplier Acme Textiles`
- `Added supplier bill #SB-77 for supplier Acme Textiles — ₹12,000` / `Edited supplier bill #SB-77 …` / `Deleted supplier bill #SB-77`
- `Added discount code SAVE20 (20%)` / `Edited discount code SAVE20 …` / `Deleted discount code SAVE20`
- `Added category Sarees` / `Edited category Sarees …` / `Deleted category Sarees`
- `Added salesperson Priya` / `Edited salesperson Priya …` / `Deleted salesperson Priya`
- `Changed role of user a@b.com: admin → superadmin`
- `Deactivated user a@b.com` / `Activated user a@b.com`

For scalar edits to bills, products, customers, and mockups, the summary lists only
fields that actually changed, each as `field old→new`.

Building these summaries means each call site must have the human labels in scope
before/after the mutation (variant size/color, product name, customer/supplier
name, etc.). Where a name is not already loaded, the call site fetches or reuses it
to avoid an id-only summary.

## Call Sites

Add a single `logActivity(...)` call after the successful mutation in each of
these existing components (identified by current `insert`/`update`/`delete` usage):

- Inventory / products / variants / stock: `src/admin/pages/InventoryPage.js`,
  `src/admin/components/ProductTable.js`
- Mockups: `src/admin/components/MockupTable.js`, `src/admin/pages/MockupPage.js`
- Bills (create / edit / void+delete): `src/admin/components/billing/BillingForm.js`,
  `src/admin/components/billing/ManualItemForm.js`, `src/admin/components/BillTable.js`
- Customers: `src/admin/components/CustomerForm.js`,
  `src/admin/components/CustomerTable.js`
- Suppliers: `src/admin/components/SupplierForm.js`,
  `src/admin/components/SupplierTable.js`
- Supplier bills: `src/admin/components/SupplierTransactionDialog.js`,
  `src/admin/components/SupplierLedgerDialog.js`
- Discounts: `src/admin/components/DiscountForm.js`,
  `src/admin/components/DiscountTable.js`
- Categories: `src/admin/components/CategoryForm.js`,
  `src/admin/components/CategoryTable.js`
- Salespersons: `src/admin/components/SalespersonForm.js`,
  `src/admin/components/SalespersonTable.js`
- Users: `src/admin/pages/AdminPage.jsx`, `src/admin/components/UserRegistration.jsx`

Exact placement and the data available to build each summary (old values for diffs,
variant labels, stock deltas) will be determined per-site during implementation. To
log `old→new` diffs, the relevant pre-mutation values must be captured before the
update call where not already in scope.

## UI

`src/admin/pages/HistoryPage.jsx`

- Route `/admin/history`, nested under a
  `<RequireAdminAuth allowedRoles={["superadmin"]}>` wrapper in `src/App.js`
  (mirrors the existing Dashboard route).
- Nav item added to `navItems` in `src/admin/components/AdminLayout.js`:
  `{ label: "History", path: "/admin/history", superadminOnly: true }`
  (the existing `superadminOnly` filter already hides it from non-superadmins).
- Lazy-loaded in `App.js` like the other admin pages.

Page contents:

- Paginated table, **newest first**. Columns: time (`created_at`, formatted in IST
  via `src/utility/dateFormat.js`), user (email joined from `profiles` on
  `actor_id`), action, entity type, summary. Query selects the embedded profile,
  e.g. `select('*, profiles(email)')`.
- Filters: by user, action type, entity type, date range, and free-text search on
  `summary`. Filtering done server-side via Supabase query params with range
  pagination (`.range()`), or client-side if result volume is small — decided in
  plan. Follow existing table/pagination patterns in the codebase.

Styling follows existing admin pages (Tailwind + shadcn/ui table components).

## Error Handling

- Logging failures: swallowed (console only), never block the user action.
- Page load failures: standard toast + empty state, consistent with other admin
  pages.
- RLS denial for non-superadmin reaching the route directly: route guard already
  redirects to `/unauthorized`; the RLS SELECT policy is the second layer.

## Testing

- Manual verification per action type: perform each mutation, confirm exactly one
  (or the expected number of) log rows appear with correct actor + descriptive
  summary.
- Verify a non-superadmin cannot see the History nav item, cannot load
  `/admin/history`, and cannot read `activity_log` via direct API call (RLS).
- Verify a logging failure (simulated) does not break the underlying action.
- Verify multi-step bill creation produces one entry, and a multi-variant product
  save produces the expected per-variant entries.

## Open Implementation Details (resolved during planning)

- Server-side vs client-side filtering/pagination threshold.
- Exact pre-mutation value capture needed at each call site for `old→new` diffs.
- Variant human label format (size/color) source columns in `productsizecolors`.
