# Superadmin History Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a superadmin-only "History" tab that shows a human-readable audit log of every database-mutating action performed through the app (who did what, with a summary precise enough to identify the exact change).

**Architecture:** App-level logging. A new `activity_log` Postgres table (RLS: insert by admins, select by superadmin only). A `logActivity()` helper writes one row per meaningful action, fire-and-forget. Pure summary/label builders live in a tested utility module. A `HistoryPage` reads the log with filters + pagination. Logging calls are added at each mutation boundary across the admin app.

**Tech Stack:** React 19 (CRA), `@supabase/supabase-js`, Tailwind, Jest + React Testing Library, `date-fns` / `Intl.DateTimeFormat` for IST display.

**Spec:** `docs/superpowers/specs/2026-06-02-superadmin-history-log-design.md`

---

## File Structure

**Create:**
- `schema/migration_activity_log.sql` — table + indexes + RLS policies
- `src/lib/activityLog.js` — `logActivity()` helper (resolves actor, inserts row, never throws)
- `src/utility/activitySummary.js` — pure helpers: `money`, `variantLabel`, `customerName`, `diffFields`
- `src/utility/__tests__/activitySummary.test.js` — unit tests for the pure helpers
- `src/lib/__tests__/activityLog.test.js` — unit test for the helper (mocked supabase)
- `src/admin/pages/HistoryPage.jsx` — the History UI (table + filters + pagination)

**Modify:**
- `src/utility/dateFormat.js` — add `formatDateTimeIST()`
- `src/App.js` — lazy import + superadmin-guarded `/admin/history` route
- `src/admin/components/AdminLayout.js` — add `History` nav item (`superadminOnly`)
- Call sites (logging calls only): `InventoryPage.js`, `ProductTable.js`, `MockupTable.js`, `CustomerForm.js`, `CustomerTable.js`, `SupplierForm.js`, `SupplierTransactionDialog.js`, `SupplierLedgerDialog.js`, `DiscountForm.js`, `DiscountTable.js`, `CategoryForm.js`, `CategoryTable.js`, `SalespersonForm.js`, `SalespersonTable.js`, `AdminPage.jsx`, `billing/BillingForm.js`, `BillTable.js`

**Convention reminders (from CLAUDE.md):**
- New migrations go in `schema/migration_*.sql`. Never edit existing schema table files.
- All IDs may be mixed types — `entity_id` is `text`; always `String(...)` when logging.
- Summaries are **human-readable, never contain UUIDs**.

---

## Phase 1 — Database

### Task 1: Create the `activity_log` migration

**Files:**
- Create: `schema/migration_activity_log.sql`

- [ ] **Step 1: Write the migration SQL**

Create `schema/migration_activity_log.sql`:

```sql
-- Superadmin history / audit log.
-- App-level logging: one row per meaningful action. Append-only.

create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid references public.profiles(id),
  action      text not null,        -- 'create' | 'update' | 'delete'
  entity_type text not null,        -- 'product' | 'variant' | 'stock' | 'mockup' | 'bill' | 'customer' | 'supplier' | 'supplier_bill' | 'discount' | 'category' | 'user' | 'salesperson'
  entity_id   text,                 -- PK of affected row (text: IDs are mixed types)
  summary     text not null         -- human-readable description of the exact change
);

create index if not exists activity_log_created_at_idx  on public.activity_log (created_at desc);
create index if not exists activity_log_actor_id_idx     on public.activity_log (actor_id);
create index if not exists activity_log_entity_type_idx  on public.activity_log (entity_type);
create index if not exists activity_log_action_idx       on public.activity_log (action);

alter table public.activity_log enable row level security;

-- INSERT: any active admin/superadmin, and must stamp their own actor_id.
drop policy if exists activity_log_insert_admins on public.activity_log;
create policy activity_log_insert_admins on public.activity_log
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'superadmin')
        and coalesce(p.is_active, true) = true
    )
  );

-- SELECT: superadmin only. Non-superadmins cannot read the log even via direct API.
drop policy if exists activity_log_select_superadmin on public.activity_log;
create policy activity_log_select_superadmin on public.activity_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'superadmin'
        and coalesce(p.is_active, true) = true
    )
  );

-- No UPDATE/DELETE policies → those operations are denied for everyone (append-only).
```

- [ ] **Step 2: Apply the migration in Supabase**

Open the Supabase SQL editor and run the file contents (or apply via the project's normal migration path). This plan does not auto-apply DDL.

- [ ] **Step 3: Verify the table + RLS exist**

Run (from repo root; uses the service-role key already in `.env`):

```bash
source .env && curl -s \
  -H "apikey: $REACT_APP_SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $REACT_APP_SUPABASE_SERVICE_ROLE_KEY" \
  "$REACT_APP_SUPABASE_URL/rest/v1/activity_log?select=id&limit=1"
```

Expected: `[]` (empty array — table exists, query succeeds). A 404/relation-error means the migration was not applied.

- [ ] **Step 4: Commit**

```bash
git add schema/migration_activity_log.sql
git commit -m "feat(history): add activity_log table with RLS"
```

---

## Phase 2 — Pure utilities (TDD)

### Task 2: Summary/label helpers

**Files:**
- Create: `src/utility/activitySummary.js`
- Test: `src/utility/__tests__/activitySummary.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/utility/__tests__/activitySummary.test.js`:

```javascript
import {
  money,
  variantLabel,
  customerName,
  diffFields,
} from "../activitySummary";

describe("money", () => {
  test("formats with ₹ and Indian grouping", () => {
    expect(money(3200)).toBe("₹3,200");
    expect(money(120000)).toBe("₹1,20,000");
  });
  test("handles nullish as ₹0", () => {
    expect(money(null)).toBe("₹0");
    expect(money(undefined)).toBe("₹0");
  });
});

describe("variantLabel", () => {
  test("color / size", () => {
    expect(variantLabel("M", "Red")).toBe("Red / M");
  });
  test("missing parts collapse cleanly", () => {
    expect(variantLabel("M", null)).toBe("M");
    expect(variantLabel(null, "Red")).toBe("Red");
    expect(variantLabel(null, null)).toBe("variant");
  });
});

describe("customerName", () => {
  test("joins first + last", () => {
    expect(customerName({ first_name: "Ravi", last_name: "Kumar" })).toBe("Ravi Kumar");
  });
  test("first only", () => {
    expect(customerName({ first_name: "Ravi", last_name: null })).toBe("Ravi");
  });
  test("nullish customer", () => {
    expect(customerName(null)).toBe("walk-in");
  });
});

describe("diffFields", () => {
  const oldObj = { name: "Kurta", retailprice: 1200, fabric: "Cotton" };
  const newObj = { name: "Cotton Kurta", retailprice: 1400, fabric: "Cotton" };

  test("lists only changed fields, quotes strings, bare numbers", () => {
    expect(diffFields(oldObj, newObj, ["name", "retailprice", "fabric"])).toBe(
      'name "Kurta"→"Cotton Kurta", retailprice 1200→1400'
    );
  });
  test("returns empty string when nothing changed", () => {
    expect(diffFields(oldObj, oldObj, ["name", "retailprice"])).toBe("");
  });
  test("ignores fields not in the list", () => {
    expect(diffFields(oldObj, newObj, ["fabric"])).toBe("");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `CI=true npx react-scripts test src/utility/__tests__/activitySummary.test.js --watchAll=false`
Expected: FAIL — `Cannot find module '../activitySummary'`.

- [ ] **Step 3: Implement the helpers**

Create `src/utility/activitySummary.js`:

```javascript
// Pure helpers for building human-readable activity-log summaries.
// Summaries must never contain UUIDs — use these labels instead.

export const money = (n) => {
  const value = Number(n) || 0;
  return "₹" + value.toLocaleString("en-IN");
};

// productsizecolors stores size + color. Display as "Color / Size".
export const variantLabel = (size, color) => {
  const parts = [color, size].filter((p) => p != null && String(p).trim() !== "");
  return parts.length ? parts.join(" / ") : "variant";
};

export const customerName = (c) => {
  if (!c) return "walk-in";
  const name = [c.first_name, c.last_name]
    .filter((p) => p != null && String(p).trim() !== "")
    .join(" ");
  return name || "walk-in";
};

// Returns "field old→new, field2 old2→new2" for changed fields only.
// Strings are quoted; numbers/other are bare. Empty string if nothing changed.
export const diffFields = (oldObj, newObj, fields) => {
  const fmt = (v) => (typeof v === "string" ? `"${v}"` : String(v));
  return fields
    .filter((f) => oldObj?.[f] !== newObj?.[f])
    .map((f) => `${f} ${fmt(oldObj?.[f])}→${fmt(newObj?.[f])}`)
    .join(", ");
};
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `CI=true npx react-scripts test src/utility/__tests__/activitySummary.test.js --watchAll=false`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/utility/activitySummary.js src/utility/__tests__/activitySummary.test.js
git commit -m "feat(history): add activity summary/label helpers"
```

---

### Task 3: IST datetime formatter

**Files:**
- Modify: `src/utility/dateFormat.js`
- Test: `src/utility/__tests__/dateFormat.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `src/utility/__tests__/dateFormat.test.js`:

```javascript
import { formatDateTimeIST } from "../dateFormat";

describe("formatDateTimeIST", () => {
  test("renders a UTC instant in IST (Asia/Kolkata)", () => {
    // 2026-06-02T00:00:00Z == 2026-06-02 05:30 AM IST
    const out = formatDateTimeIST("2026-06-02T00:00:00Z");
    expect(out).toMatch(/02\/06\/2026/);
    expect(out).toMatch(/05:30/);
  });
  test("nullish renders dash", () => {
    expect(formatDateTimeIST(null)).toBe("-");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `CI=true npx react-scripts test src/utility/__tests__/dateFormat.test.js --watchAll=false`
Expected: FAIL — `formatDateTimeIST is not a function`.

- [ ] **Step 3: Add the formatter**

In `src/utility/dateFormat.js`, append after the existing `formatDate` export:

```javascript
// Always render activity-log timestamps in Indian Standard Time.
export const formatDateTimeIST = (value) => {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");
};
```

- [ ] **Step 4: Run test, verify it passes**

Run: `CI=true npx react-scripts test src/utility/__tests__/dateFormat.test.js --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dateFormat.js src/utility/__tests__/dateFormat.test.js
git commit -m "feat(history): add IST datetime formatter"
```

---

## Phase 3 — Logging helper

### Task 4: `logActivity()` helper

**Files:**
- Create: `src/lib/activityLog.js`
- Test: `src/lib/__tests__/activityLog.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/activityLog.test.js`:

```javascript
import { logActivity } from "../activityLog";
import { supabase } from "../supabaseClient";

jest.mock("../supabaseClient", () => {
  const insert = jest.fn().mockResolvedValue({ error: null });
  const from = jest.fn(() => ({ insert }));
  return {
    supabase: {
      from,
      auth: {
        getSession: jest
          .fn()
          .mockResolvedValue({ data: { session: { user: { id: "u-1" } } } }),
      },
      __insert: insert,
      __from: from,
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

test("inserts a row stamped with the current user id and string entity_id", async () => {
  await logActivity({
    action: "create",
    entityType: "product",
    entityId: 12345,
    summary: "Created product BC25001 — Cotton Kurta",
  });

  expect(supabase.from).toHaveBeenCalledWith("activity_log");
  expect(supabase.__insert).toHaveBeenCalledWith({
    actor_id: "u-1",
    action: "create",
    entity_type: "product",
    entity_id: "12345",
    summary: "Created product BC25001 — Cotton Kurta",
  });
});

test("never throws when the insert fails", async () => {
  supabase.__insert.mockResolvedValueOnce({ error: { message: "boom" } });
  await expect(
    logActivity({ action: "delete", entityType: "bill", entityId: "1042", summary: "x" })
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `CI=true npx react-scripts test src/lib/__tests__/activityLog.test.js --watchAll=false`
Expected: FAIL — `Cannot find module '../activityLog'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/activityLog.js`:

```javascript
import { supabase } from "./supabaseClient";

/**
 * Write one audit-log entry. Fire-and-forget: never throws, never blocks the
 * caller's action. On failure it logs to console only.
 *
 * @param {Object} p
 * @param {"create"|"update"|"delete"} p.action
 * @param {string} p.entityType  e.g. "product" | "variant" | "bill" | ...
 * @param {string|number|null} p.entityId  PK of affected row (coerced to text)
 * @param {string} p.summary  human-readable description (NEVER contains UUIDs)
 */
export async function logActivity({ action, entityType, entityId, summary }) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { error } = await supabase.from("activity_log").insert({
      actor_id: session?.user?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId != null ? String(entityId) : null,
      summary,
    });
    if (error) console.error("[activityLog] insert failed:", error.message);
  } catch (err) {
    console.error("[activityLog] unexpected error:", err);
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `CI=true npx react-scripts test src/lib/__tests__/activityLog.test.js --watchAll=false`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activityLog.js src/lib/__tests__/activityLog.test.js
git commit -m "feat(history): add fire-and-forget logActivity helper"
```

**Call-site convention (used by every wiring task below):** import with
`import { logActivity } from "../../lib/activityLog";` (adjust depth: pages use
`../../lib/...`, components use `../../lib/...`, `billing/` sub-components use
`../../../lib/...`). Helpers import as `import { money, variantLabel, customerName, diffFields } from "../../utility/activitySummary";` (same depth rules). Call **after** the
mutation's error guard, fire-and-forget (do NOT `await`).

---

## Phase 4 — History page + route + nav

### Task 5: HistoryPage UI

**Files:**
- Create: `src/admin/pages/HistoryPage.jsx`

- [ ] **Step 1: Implement the page**

Create `src/admin/pages/HistoryPage.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { formatDateTimeIST } from "../../utility/dateFormat";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const ACTIONS = ["create", "update", "delete"];
const ENTITY_TYPES = [
  "product", "variant", "stock", "mockup", "bill", "customer",
  "supplier", "supplier_bill", "discount", "category", "user", "salesperson",
];

const actionBadge = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
};

export default function HistoryPage() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);

  // filters
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, email")
        .order("email");
      setUsers(data || []);
    })();
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("activity_log")
      .select(
        "id, created_at, actor_id, action, entity_type, entity_id, summary, profiles(email)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (actor) query = query.eq("actor_id", actor);
    if (action) query = query.eq("action", action);
    if (entityType) query = query.eq("entity_type", entityType);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+05:30`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59+05:30`);
    if (search.trim()) query = query.ilike("summary", `%${search.trim()}%`);

    const { data, error, count: total } = await query;
    if (error) {
      toast.error("Failed to load history");
      setRows([]);
      setCount(0);
    } else {
      setRows(data || []);
      setCount(total || 0);
    }
    setLoading(false);
  }, [page, actor, action, entityType, dateFrom, dateTo, search]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Any filter change resets to first page.
  useEffect(() => {
    setPage(0);
  }, [actor, action, entityType, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const inputCls =
    "border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">History Log</h1>

      <div className="flex flex-wrap gap-2 items-center">
        <select className={inputCls} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className={inputCls} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">All types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" className={inputCls} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className={inputCls} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <input
          type="text"
          placeholder="Search summary…"
          className={`${inputCls} flex-1 min-w-[180px]`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 whitespace-nowrap">Time (IST)</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">User</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No entries</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeIST(r.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.profiles?.email || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionBadge[r.action] || "bg-gray-100 text-gray-700"}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.entity_type}</td>
                  <td className="px-3 py-2">{r.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{count} entries</span>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >Prev</button>
          <span>Page {page + 1} / {totalPages}</span>
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >Next</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `CI=true npx react-scripts build 2>&1 | tail -20`
Expected: build succeeds (no module-resolution or syntax errors referencing HistoryPage). (Route is not wired yet; that's Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/admin/pages/HistoryPage.jsx
git commit -m "feat(history): add HistoryPage UI (table, filters, pagination)"
```

---

### Task 6: Route + nav wiring

**Files:**
- Modify: `src/App.js`
- Modify: `src/admin/components/AdminLayout.js`

- [ ] **Step 1: Add the lazy import in `src/App.js`**

After the `DashboardPage` lazy import line:

```javascript
const DashboardPage = lazy(() => import("./admin/pages/DashboardPage"));
const HistoryPage = lazy(() => import("./admin/pages/HistoryPage"));
```

- [ ] **Step 2: Add the superadmin-guarded route in `src/App.js`**

Inside the existing superadmin guard block, alongside the dashboard route:

```jsx
              <Route element={<RequireAdminAuth allowedRoles={["superadmin"]} />}>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="history" element={<HistoryPage />} />
              </Route>
```

- [ ] **Step 3: Add the nav item in `src/admin/components/AdminLayout.js`**

In the `navItems` array, add after the Dashboard entry:

```javascript
const navItems = [
  { label: "Dashboard", path: "/admin/dashboard", superadminOnly: true },
  { label: "History", path: "/admin/history", superadminOnly: true },
  { label: "Admin", path: "/admin/admin-hub" },
```

- [ ] **Step 4: Verify build + manual check**

Run: `CI=true npx react-scripts build 2>&1 | tail -20`
Expected: build succeeds.

Manual: `npm start`, log in as **superadmin** → "History" tab visible, `/admin/history` loads the (empty) table. Log in as **admin** → no "History" tab; visiting `/admin/history` redirects to `/unauthorized`.

- [ ] **Step 5: Commit**

```bash
git add src/App.js src/admin/components/AdminLayout.js
git commit -m "feat(history): wire superadmin-only /admin/history route and nav"
```

---

## Phase 5 — Wire call sites

> Each task below adds logging only. After the mutation's existing error guard, call `logActivity(...)` fire-and-forget (no `await`). Add the imports noted in Task 4. **All summaries must be human-readable (no UUIDs).** Where an old value is needed for a diff, capture it from existing component state (named per task) before the mutation.

### Task 7: Inventory — products & variants

**Files:**
- Modify: `src/admin/pages/InventoryPage.js` (`handleAddProduct`)
- Modify: `src/admin/components/ProductTable.js` (`handleProductSave`)

- [ ] **Step 1: Log product creation in `InventoryPage.js`**

Add imports at top:
```javascript
import { logActivity } from "../../lib/activityLog";
```
In `handleAddProduct`, after both the product insert and variant insert succeed (after the variant-error guard, before the success `toast`):
```javascript
logActivity({
  action: "create",
  entityType: "product",
  entityId: fullProduct.productid,
  summary: `Created product ${fullProduct.productid} — ${fullProduct.name}`,
});
variants
  .filter((v) => v.size || v.color)
  .forEach((v) =>
    logActivity({
      action: "create",
      entityType: "variant",
      entityId: fullProduct.productid,
      summary: `Added variant ${variantLabel(v.size, v.color)} to product ${fullProduct.productid} — ${fullProduct.name} (stock ${Number(v.stock) || 0})`,
    })
  );
```
Add to imports:
```javascript
import { variantLabel } from "../../utility/activitySummary";
```

- [ ] **Step 2: Log product edit, variant upsert, variant delete in `ProductTable.js`**

Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { variantLabel, diffFields } from "../../utility/activitySummary";
```
In `handleProductSave`, capture the old product BEFORE the update call:
```javascript
const oldProduct = products.find((p) => p.productid === productData.productid);
```
After the product-update error guard (line ~265):
```javascript
const productFields = ["name", "categoryid", "fabric", "purchaseprice", "retailprice", "description", "producturl", "unit_type"];
const changed = diffFields(oldProduct || {}, productData, productFields);
if (changed) {
  logActivity({
    action: "update",
    entityType: "product",
    entityId: productData.productid,
    summary: `Edited product ${productData.productid} — ${changed}`,
  });
}
```
After the variant upsert error guard (line ~280), for each upserted variant distinguish add vs stock/edit using `variants` state for old values:
```javascript
upserts.forEach((u) => {
  const old = variants.find((v) => v.variantid === u.variantid);
  if (!u.variantid || !old) {
    logActivity({
      action: "create",
      entityType: "variant",
      entityId: productData.productid,
      summary: `Added variant ${variantLabel(u.size, u.color)} to product ${productData.productid} — ${productData.name} (stock ${Number(u.stock) || 0})`,
    });
  } else if (Number(old.stock) !== Number(u.stock)) {
    const delta = Number(u.stock) - Number(old.stock);
    const dir = delta >= 0 ? "Increased" : "Decreased";
    logActivity({
      action: "update",
      entityType: "stock",
      entityId: productData.productid,
      summary: `${dir} stock of ${variantLabel(u.size, u.color)}, product ${productData.productid} — ${productData.name}: ${Number(old.stock)} → ${Number(u.stock)} (${delta >= 0 ? "+" : ""}${delta})`,
    });
  }
});
```
After the variant delete completes (after the `Promise.all`, line ~291):
```javascript
deletedVariants
  .filter((d) => d.variantid)
  .forEach((d) => {
    const old = variants.find((v) => v.variantid === d.variantid);
    logActivity({
      action: "delete",
      entityType: "variant",
      entityId: productData.productid,
      summary: `Deleted variant ${variantLabel(old?.size, old?.color)} from product ${productData.productid} — ${productData.name}`,
    });
  });
```

- [ ] **Step 3: Manual verification**

`npm start` as superadmin. Add a product with 2 variants → History shows 1 `create product` + 2 `create variant`. Edit the product name + price → 1 `update product` listing both fields. Change one variant's stock → 1 `update stock` with `old → new (±delta)`. Delete a variant → 1 `delete variant` naming color/size. Confirm no UUIDs appear in any summary.

- [ ] **Step 4: Commit**

```bash
git add src/admin/pages/InventoryPage.js src/admin/components/ProductTable.js
git commit -m "feat(history): log product create/edit and variant add/stock/delete"
```

---

### Task 8: Mockups

**Files:**
- Modify: `src/admin/components/MockupTable.js` (`onToggle`)

- [ ] **Step 1: Log mockup field toggles**

Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
```
In `onToggle`, after the update error guard (line ~196), using the old row from `rows` state and the product label already shown in the row:
```javascript
const oldRow = rows.find((r) => r.productid === productid);
const label = oldRow?.product_name ? `${productid} — ${oldRow.product_name}` : productid;
logActivity({
  action: "update",
  entityType: "mockup",
  entityId: productid,
  summary: `Edited mockup for product ${label} — ${field} ${!value}→${value}`,
});
```
> If the mockup row object uses a different key for the product display name, use that key (or just `productid`). Never log a UUID.

- [ ] **Step 2: Manual verification**

As superadmin, toggle a mockup field (e.g. ig_post) → History shows `update mockup` naming the product code + which field flipped `false→true`.

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/MockupTable.js
git commit -m "feat(history): log mockup field changes"
```

---

### Task 9: Customers

**Files:**
- Modify: `src/admin/components/CustomerForm.js` (`handleSubmit`)
- Modify: `src/admin/components/CustomerTable.js` (`handleDelete`)

- [ ] **Step 1: Log add/edit in `CustomerForm.js`**

Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { customerName, diffFields } from "../../utility/activitySummary";
```
Determine create vs edit (the form already keys off `stableDefaults.customer_ulid`). After the upsert succeeds (`data[0]` available, before `onSubmit?.(data[0])`):
```javascript
const isEdit = Boolean(stableDefaults?.customer_ulid);
const saved = data[0];
if (isEdit) {
  const fields = ["first_name", "last_name", "phone", "email", "gender", "store_credit", "address", "loyalty_tier", "customer_notes"];
  const changed = diffFields(stableDefaults, values, fields);
  logActivity({
    action: "update",
    entityType: "customer",
    entityId: saved.customerid,
    summary: `Edited customer ${customerName(saved)}${changed ? ` — ${changed}` : ""}`,
  });
} else {
  logActivity({
    action: "create",
    entityType: "customer",
    entityId: saved.customerid,
    summary: `Added customer ${customerName(saved)} (${saved.phone || "no phone"})`,
  });
}
```

- [ ] **Step 2: Log delete in `CustomerTable.js`**

The handler currently receives only `customer_ulid`. Capture the human label from the in-scope `customers` state list before delete. Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { customerName } from "../../utility/activitySummary";
```
In `handleDelete`, after the successful delete (before `toast.success`):
```javascript
const deleted = customers.find((c) => c.customer_ulid === customer_ulid);
logActivity({
  action: "delete",
  entityType: "customer",
  entityId: deleted?.customerid ?? customer_ulid,
  summary: `Deleted customer ${customerName(deleted)}${deleted?.phone ? ` (${deleted.phone})` : ""}`,
});
```
> If the state array holding loaded customers is named differently, use that name. (It is the array the table maps over to render rows.)

- [ ] **Step 3: Manual verification**

Add a customer → `create customer` with name + phone. Edit name → `update customer` listing the field diff. Delete → `delete customer` naming them (no UUID).

- [ ] **Step 4: Commit**

```bash
git add src/admin/components/CustomerForm.js src/admin/components/CustomerTable.js
git commit -m "feat(history): log customer add/edit/delete"
```

---

### Task 10: Suppliers & supplier bills

**Files:**
- Modify: `src/admin/components/SupplierForm.js` (`handleSubmit`)
- Modify: `src/admin/components/SupplierTransactionDialog.js` (`handleSubmit`)
- Modify: `src/admin/components/SupplierLedgerDialog.js` (`LineItemProductLink.save`)

(`SupplierTable.js` has no mutations — skip.)

- [ ] **Step 1: Supplier add/edit in `SupplierForm.js`**

The current insert does not `.select()`. To get the new id, change the insert path to return the row. Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";
```
For the **edit** path (`isEditing` true), `defaultValues` holds the old row. After success:
```javascript
const fields = ["name", "phone", "email", "gstin", "pan", "address", "opening_balance", "opening_balance_date", "notes"];
const changed = diffFields(defaultValues, values, fields);
logActivity({
  action: "update",
  entityType: "supplier",
  entityId: defaultValues.supplierid,
  summary: `Edited supplier ${values.name}${changed ? ` — ${changed}` : ""}`,
});
```
For the **add** path, capture the inserted id by appending `.select("supplierid").single()` to the insert and using its result (`insertedSupplier.supplierid`):
```javascript
logActivity({
  action: "create",
  entityType: "supplier",
  entityId: insertedSupplier?.supplierid,
  summary: `Added supplier ${values.name}`,
});
```

- [ ] **Step 2: Supplier bill/payment/advance in `SupplierTransactionDialog.js`**

Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { money } from "../../utility/activitySummary";
```
After all sub-operations succeed (before `onSuccess?.()`), using `txnData.transaction_id`, `selectedSupplier.name`, `values.type`, `values.amount`:
```javascript
const typeLabel = { bill: "supplier bill", payment: "supplier payment", advance: "supplier advance" }[values.type] || "supplier transaction";
logActivity({
  action: "create",
  entityType: values.type === "bill" ? "supplier_bill" : "supplier",
  entityId: txnData.transaction_id,
  summary: `Added ${typeLabel} for supplier ${selectedSupplier.name} — ${money(values.amount)}`,
});
```

- [ ] **Step 3: Line-item product link in `SupplierLedgerDialog.js`**

Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
```
In `LineItemProductLink.save`, after the update succeeds (before `setEditing(false)`), using `lineItem` (old) + `productId` (new):
```javascript
logActivity({
  action: "update",
  entityType: "supplier_bill",
  entityId: lineItem.transaction_id,
  summary: productId
    ? `Linked product ${productId} to supplier bill line item "${lineItem.description || lineItem.line_item_id}"`
    : `Unlinked product from supplier bill line item "${lineItem.description || lineItem.line_item_id}"`,
});
```

- [ ] **Step 4: Manual verification**

Edit a supplier → `update supplier` with field diff. Add a supplier (new) → `create supplier`. Add a supplier bill → `create supplier_bill` with supplier name + amount. Link a product on a ledger line item → `update supplier_bill`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/SupplierForm.js src/admin/components/SupplierTransactionDialog.js src/admin/components/SupplierLedgerDialog.js
git commit -m "feat(history): log supplier and supplier-bill changes"
```

---

### Task 11: Discounts, categories, salespersons

**Files:**
- Modify: `src/admin/components/DiscountForm.js`, `src/admin/components/DiscountTable.js`
- Modify: `src/admin/components/CategoryForm.js`, `src/admin/components/CategoryTable.js`
- Modify: `src/admin/components/SalespersonForm.js`, `src/admin/components/SalespersonTable.js`

- [ ] **Step 1: Discounts**

`DiscountForm.js` — add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";
```
In `onFormSubmit`, capture the insert result by ensuring the insert uses `.select("id").single()` (so `insertedDiscount.id` is available). After success:
```javascript
if (defaultValues?.id) {
  const changed = diffFields(defaultValues, data, ["code", "type", "value", "active"]);
  logActivity({
    action: "update",
    entityType: "discount",
    entityId: defaultValues.id,
    summary: `Edited discount code ${data.code || "(none)"}${changed ? ` — ${changed}` : ""}`,
  });
} else {
  logActivity({
    action: "create",
    entityType: "discount",
    entityId: insertedDiscount?.id,
    summary: `Added discount code ${data.code || "(none)"} (${data.type} ${data.value})`,
  });
}
```
`DiscountTable.js` — `handleDelete(id)`, capture old from the `discounts` state array. Add imports + after delete:
```javascript
import { logActivity } from "../../lib/activityLog";
// ...
const old = discounts.find((d) => d.id === id);
logActivity({
  action: "delete",
  entityType: "discount",
  entityId: id,
  summary: `Deleted discount code ${old?.code || id}`,
});
```

- [ ] **Step 2: Categories**

`CategoryForm.js` — add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";
```
In `onFormSubmit`, after success:
```javascript
if (defaultValues?.categoryid) {
  const changed = diffFields(defaultValues, data, ["name", "description"]);
  logActivity({
    action: "update",
    entityType: "category",
    entityId: data.categoryid,
    summary: `Edited category ${data.name}${changed ? ` — ${changed}` : ""}`,
  });
} else {
  logActivity({
    action: "create",
    entityType: "category",
    entityId: data.categoryid,
    summary: `Added category ${data.name}`,
  });
}
```
`CategoryTable.js` — `saveEdit(categoryid)`, old from `categories` state. After success:
```javascript
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";
// ...
const old = categories.find((c) => c.categoryid === categoryid);
const changed = diffFields(old || {}, editValues, ["name", "description"]);
logActivity({
  action: "update",
  entityType: "category",
  entityId: categoryid,
  summary: `Edited category ${editValues.name || old?.name || categoryid}${changed ? ` — ${changed}` : ""}`,
});
```

- [ ] **Step 3: Salespersons**

`SalespersonForm.js` — add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";
```
In `onFormSubmit`, after success (capture inserted id via `.select("salesperson_id").single()` on the insert path → `insertedSalesperson`):
```javascript
if (defaultValues?.salesperson_id) {
  const changed = diffFields(defaultValues, data, ["name", "date_hired", "active", "salary"]);
  logActivity({
    action: "update",
    entityType: "salesperson",
    entityId: defaultValues.salesperson_id,
    summary: `Edited salesperson ${data.name}${changed ? ` — ${changed}` : ""}`,
  });
} else {
  logActivity({
    action: "create",
    entityType: "salesperson",
    entityId: insertedSalesperson?.salesperson_id,
    summary: `Added salesperson ${data.name}`,
  });
}
```
`SalespersonTable.js` — `saveEdit(salesperson_id)`, old from `salespersons` state. After success:
```javascript
import { logActivity } from "../../lib/activityLog";
import { diffFields } from "../../utility/activitySummary";
// ...
const old = salespersons.find((s) => s.salesperson_id === salesperson_id);
const changed = diffFields(old || {}, editValues, ["name", "date_hired", "active", "salary"]);
logActivity({
  action: "update",
  entityType: "salesperson",
  entityId: salesperson_id,
  summary: `Edited salesperson ${editValues.name || old?.name || salesperson_id}${changed ? ` — ${changed}` : ""}`,
});
```

- [ ] **Step 4: Manual verification**

Add/edit/delete one discount, one category, one salesperson. Confirm each produces a readable entry with the correct entity type, code/name, and field diffs on edits.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/DiscountForm.js src/admin/components/DiscountTable.js src/admin/components/CategoryForm.js src/admin/components/CategoryTable.js src/admin/components/SalespersonForm.js src/admin/components/SalespersonTable.js
git commit -m "feat(history): log discount/category/salesperson changes"
```

---

### Task 12: Users (roles & active status)

**Files:**
- Modify: `src/admin/pages/AdminPage.jsx` (`updateRole`, `toggleActive`)

> Profile auto-creation in `UserRegistration.jsx` is a system trigger (role always `user`), not an operator action — out of scope; do not log it.

- [ ] **Step 1: Log role change + active toggle**

Add imports at top of `AdminPage.jsx`:
```javascript
import { logActivity } from "../../lib/activityLog";
```
In `updateRole(userId, newRole)`, capture old role from `users` state before the update; after success:
```javascript
const target = users.find((u) => u.id === userId);
logActivity({
  action: "update",
  entityType: "user",
  entityId: userId,
  summary: `Changed role of user ${target?.email || userId}: ${target?.role || "?"} → ${newRole}`,
});
```
In `toggleActive(userId, currentActive)`, after success:
```javascript
const target = users.find((u) => u.id === userId);
logActivity({
  action: "update",
  entityType: "user",
  entityId: userId,
  summary: `${currentActive ? "Deactivated" : "Activated"} user ${target?.email || userId}`,
});
```

- [ ] **Step 2: Manual verification**

As superadmin, change another user's role → `update user` with `oldRole → newRole` and the user's email (not UUID). Toggle active → `Deactivated/Activated user <email>`.

- [ ] **Step 3: Commit**

```bash
git add src/admin/pages/AdminPage.jsx
git commit -m "feat(history): log user role and active-status changes"
```

---

### Task 13: Bills

**Files:**
- Modify: `src/admin/components/billing/BillingForm.js` (create / edit / finalize / partial / payment boundaries)
- Modify: `src/admin/components/BillTable.js` (cancel / delete handlers)

> BillingForm has multiple save/finalize paths; log **one** entry per path at the action boundary identified below. `selectedCustomerId` is in scope but not the customer name — fetch the name once at the log point. Use a tiny local helper inside each handler:
> ```javascript
> const custName = selectedCustomerId
>   ? (await supabase.from("customers").select("first_name,last_name").eq("customerid", selectedCustomerId).single()).data
>   : null;
> ```
> then `customerName(custName)`. In `BillTable.js` the bill row already carries `bill.customers`, so use `customerName(bill.customers)` directly (no fetch).

- [ ] **Step 1: BillingForm imports**

Add at top of `BillingForm.js`:
```javascript
import { logActivity } from "../../../lib/activityLog";
import { money, customerName } from "../../../utility/activitySummary";
```

- [ ] **Step 2: Create / edit draft (`handleSaveDraft`)**

New-bill path (after inserts succeed, before `onOpenChange(false)`), using `bill.billid`, `bill.bill_number`, `computed.grandTotal`, `items.length`:
```javascript
const custName = selectedCustomerId
  ? (await supabase.from("customers").select("first_name,last_name").eq("customerid", selectedCustomerId).single()).data
  : null;
logActivity({
  action: "create",
  entityType: "bill",
  entityId: bill.bill_number || bill.billid,
  summary: `Created draft bill #${bill.bill_number || bill.billid} for ${customerName(custName)} — ${money(computed.grandTotal)}, ${items.length} items`,
});
```
Edit-bill path (after `bills` UPDATE + child reconcile succeed), using `billId`, `effectiveBillNumber`, `totalsToUse.grandTotal`, `items.length`:
```javascript
const custName = selectedCustomerId
  ? (await supabase.from("customers").select("first_name,last_name").eq("customerid", selectedCustomerId).single()).data
  : null;
logActivity({
  action: "update",
  entityType: "bill",
  entityId: effectiveBillNumber || billId,
  summary: `Edited draft bill #${effectiveBillNumber || billId} for ${customerName(custName)} — ${money(totalsToUse.grandTotal)}, ${items.length} items`,
});
```

- [ ] **Step 3: Finalize (`handleConfirmFinalize`) and partial (`handleConfirmPartialFinalize`)**

At the end of each path (after all writes + stock updates complete), add ONE entry. Use `action: "create"` for new bills and `action: "update"` for existing-bill re-finalize. New finalize (`activeBillId`, `pdfBillNumber`, `balanceAdjustedComputed.grandTotal`):
```javascript
const custName = selectedCustomerId
  ? (await supabase.from("customers").select("first_name,last_name").eq("customerid", selectedCustomerId).single()).data
  : null;
logActivity({
  action: "create",
  entityType: "bill",
  entityId: pdfBillNumber || activeBillId,
  summary: `Finalized bill #${pdfBillNumber || activeBillId} for ${customerName(custName)} — ${money(balanceAdjustedComputed.grandTotal)}, ${items.length} items`,
});
```
Existing-bill re-finalize path: same call but `action: "update"`, `entityId: effectiveBillNumber || billId`, and summary prefix `Re-finalized bill #…`. Partial paths: same shape, summary prefix `Finalized bill (partial) #…`, amount `money(billComputed.grandTotal)`.

> Keep it to one `logActivity` per path. Do not log inside the bill_items/bill_salespersons/stock loops.

- [ ] **Step 4: Record payment (`handleAddPayment`)**

After the payment write succeeds, using `billId`, `Number(addPaymentAmount)`, and computed `bill_status_now`:
```javascript
logActivity({
  action: "update",
  entityType: "bill",
  entityId: billId,
  summary: `Recorded payment of ${money(Number(addPaymentAmount))} on bill #${billId}${bill_status_now === "finalized" ? " (now fully paid)" : ""}`,
});
```

- [ ] **Step 5: BillTable cancel/delete handlers**

Add imports:
```javascript
import { logActivity } from "../../lib/activityLog";
import { money, customerName } from "../../utility/activitySummary";
```
`handleCancelDraft(bill)` — after refund/cancel succeeds, before `toast.success`:
```javascript
logActivity({
  action: "update",
  entityType: "bill",
  entityId: bill.bill_number || bill.billid,
  summary: `Cancelled draft bill #${bill.bill_number || bill.billid} for ${customerName(bill.customers)} — ${money(bill.totalamount)}`,
});
```
`handleCancelFinalizedNoCustomer(bill)`:
```javascript
logActivity({
  action: "update",
  entityType: "bill",
  entityId: bill.bill_number || bill.billid,
  summary: `Voided bill #${bill.bill_number || bill.billid} — ${money(bill.totalamount)}`,
});
```
`handleResolveReturnPayment(cancelBill)`:
```javascript
logActivity({
  action: "update",
  entityType: "bill",
  entityId: cancelBill.bill_number || cancelBill.billid,
  summary: `Voided bill #${cancelBill.bill_number || cancelBill.billid} for ${customerName(cancelBill.customers)} (cash refund) — ${money(cancelBill.totalamount)}`,
});
```
`handleResolveIssueStoreCredit(cancelBill)` — `refundAmount` is in scope:
```javascript
logActivity({
  action: "update",
  entityType: "bill",
  entityId: cancelBill.bill_number || cancelBill.billid,
  summary: `Voided bill #${cancelBill.bill_number || cancelBill.billid} for ${customerName(cancelBill.customers)} (store credit ${money(refundAmount)})`,
});
```
`handleDelete(bill)` — after `bills` delete succeeds, before `toast.success`:
```javascript
logActivity({
  action: "delete",
  entityType: "bill",
  entityId: bill.bill_number || bill.billid,
  summary: `Deleted bill #${bill.bill_number || bill.billid} for ${customerName(bill.customers)} — ${money(bill.totalamount)}`,
});
```

- [ ] **Step 6: Manual verification**

Create a draft bill → `create bill`. Edit it → `update bill`. Finalize → `Finalized bill`. Record a partial payment → `Recorded payment`. Cancel and delete bills via each BillTable path → one entry each, naming bill # + customer + amount. Confirm a multi-item bill produces exactly ONE entry per action (not per item) and no UUIDs appear.

- [ ] **Step 7: Commit**

```bash
git add src/admin/components/billing/BillingForm.js src/admin/components/BillTable.js
git commit -m "feat(history): log bill create/edit/finalize/payment/cancel/delete"
```

---

## Phase 6 — Final verification

### Task 14: Full build + test + RLS check

- [ ] **Step 1: Run the full test suite**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: all tests pass (including new `activitySummary`, `dateFormat`, `activityLog` tests).

- [ ] **Step 2: Production build**

Run: `CI=true npx react-scripts build 2>&1 | tail -20`
Expected: build succeeds, no errors.

- [ ] **Step 3: RLS / role gate verification (manual)**

- As **superadmin**: History tab visible, entries load, filters + pagination work, timestamps shown in IST.
- As **admin**: no History tab; `/admin/history` → `/unauthorized`. Direct API read denied:
  ```bash
  # Using an admin (non-superadmin) anon session token, a select on activity_log returns [] (RLS blocks rows).
  ```
- Perform one mutation as admin → confirm the row appears for superadmin (insert policy allows admins to write).

- [ ] **Step 4: Logging-failure resilience (manual)**

Temporarily simulate a failing insert (e.g. rename the table reference in `activityLog.js` locally) → confirm a product add still succeeds and only a `console.error` is emitted. Revert the simulation.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(history): final verification cleanup"
```

---

## Notes for the implementer

- **Variable-name drift:** the call-site variable names (e.g. `products`, `variants`, `customers`, `discounts`, `salespersons`, `users` state arrays; `defaultValues`; `stableDefaults`) were extracted from the current code. If a name differs, use the equivalent in-scope array/object — the one the component maps over to render rows or the one holding form defaults. Never substitute a UUID into a summary to work around a missing label; capture the label from state/props or a small fetch.
- **`.select()` after insert:** several insert paths (`SupplierForm`, `DiscountForm`, `SalespersonForm`) currently discard the inserted row. Where the new id is needed for `entity_id`, append `.select("<pk>").single()` to the insert and read the returned row. This is the only behavioral change to existing mutations; it does not alter user-facing flow.
- **Fire-and-forget:** never `await logActivity` in a way that gates the UI. In `async` handlers it's fine to call it without `await`; the helper swallows its own errors.
- **One entry per action:** never place `logActivity` inside per-item loops for bills; place it once at the action boundary.
