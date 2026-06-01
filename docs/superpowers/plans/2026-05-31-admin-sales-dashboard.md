# Admin Sales Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a strategic `/admin/dashboard` sales review page with date-filtered KPI cards, a revenue bar chart (current vs prior FY), category breakdown, salesperson ranking, and discount impact.

**Architecture:** All revenue/margin/discount math lives in **one pure, fully-tested utility module** (`src/utility/dashboardData.js`). `DashboardPage.js` fetches raw rows from Supabase **once** (current period + prior-FY period + salespersons, in parallel, paginated), then passes plain datasets to presentational child components that call the pure aggregators. This makes the math unit-testable without mocking Supabase and avoids re-fetching the same `bills`/`bill_items` five times.

**Tech Stack:** React 19 (CRA), `@supabase/supabase-js`, Plotly (`react-plotly.js/factory` + `plotly.js-basic-dist-min`), Shadcn/ui (`Tabs`, `Select`, `Table`, `Card`), Tailwind, Jest + React Testing Library (CRA default).

---

## Deviations from the spec (read first)

These are intentional and approved during planning. Implement as written here, not as in the spec where they differ:

1. **Single fetch, not per-component fetch.** The spec says each child component fetches its own data. Instead, `DashboardPage` fetches once and passes datasets down. Reason: the widgets share the exact same `bills`/`bill_items` rows; five independent fetches would 5× the DB load and the 1000-row pagination cost. Children stay presentational and trivially testable.

2. **Discount table simplified to totals.** The spec's per-discount-code rows are dropped (the `discount_usage` table stores no amount, so per-code ₹ isn't derivable, and the owner confirmed per-code ₹ isn't wanted). The Discount Impact widget instead shows **total discount given**, split into **Code-driven** vs **Manual** (bill count + ₹ each).

3. **Pagination + embedded filter.** Supabase caps responses at 1000 rows and long `.in()` URLs break. `bill_items` is filtered by date via an embedded inner join on `bills`, and every fetch uses a paginated `fetchAllRows` helper.

---

## Verified schema (ground truth — do not assume other columns)

```
bills:       billid int4 PK, orderdate timestamp, net_amount numeric,
             finalized bool, applied_codes _text (text[]), salesperson_ids _int4
bill_items:  bill_item_id int4 PK, billid int4 NOT NULL, category text,
             total numeric NOT NULL, cost_price numeric (nullable),
             quantity numeric NOT NULL, discount_total numeric DEFAULT 0,
             salesperson_id int4 (nullable)
salespersons: salesperson_id int4 PK, name text NOT NULL, active bool
```

- **Revenue** = `SUM(bills.net_amount)` over finalized bills in range.
- **Cost** = `SUM(bill_items.cost_price * quantity)` (treat null `cost_price` as 0).
- **Discount given** = `SUM(bill_items.discount_total)`.
- Financial year: Apr 1 of year Y (inclusive) → Apr 1 of Y+1 (exclusive). Month for FY purposes is 0-indexed; April = 3 (matches `getFinancialYear` in `AdminPage.jsx:40`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/utility/dashboardData.js` | **Pure** date/FY helpers + all aggregators. No React, no Supabase. |
| `src/utility/__tests__/dashboardData.test.js` | Unit tests for every pure function. |
| `src/admin/pages/DashboardPage.js` | Page shell: filter state, one-shot paginated fetch, passes datasets to children. |
| `src/admin/components/dashboard/DashboardFilters.js` | FY tabs + From/To month `<Select>`s. |
| `src/admin/components/dashboard/KpiCards.js` | 6 KPI cards with prior-FY badges. |
| `src/admin/components/dashboard/RevenueChart.js` | Plotly grouped bar chart, current vs prior FY. |
| `src/admin/components/dashboard/CategoryBreakdown.js` | Custom HTML horizontal bar list. |
| `src/admin/components/dashboard/SalespersonTable.js` | Ranked salesperson table. |
| `src/admin/components/dashboard/DiscountTable.js` | Total / Code / Manual discount summary. |
| `src/admin/components/dashboard/__tests__/*.test.js` | Smoke-render tests with mock props. |
| `src/admin/components/AdminLayout.js` (modify) | Add Dashboard nav item. |
| `src/App.js` (modify) | Add `dashboard` route. |

**Data contract passed from `DashboardPage` to children:**

```js
// `period` shape (one for current, one for prior):
{ bills: [{ billid, net_amount, applied_codes }], items: [{ billid, category, total, cost_price, quantity, discount_total, salesperson_id }] }

// Props every widget receives:
{ current: period, prior: period, range: { startYear, fromIdx, toIdx },
  salespersonsById: { [salesperson_id]: name }, loading: boolean }
```

`fromIdx`/`toIdx` are positions (0–11) into the FY month sequence Apr→Mar.

---

## Test command

CRA / react-scripts + Jest. Run a single file non-interactively:

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js
```

Run a whole directory: `CI=true npm test -- --watchAll=false src/admin/components/dashboard`.

---

## Task 1: FY date helpers (pure)

**Files:**
- Create: `src/utility/dashboardData.js`
- Test: `src/utility/__tests__/dashboardData.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/utility/__tests__/dashboardData.test.js
import {
  FY_MONTHS,
  getFinancialYearStart,
  monthRangeWithinFy,
  priorYearRange,
  buildFyList,
  fyLabel,
} from "../dashboardData";

describe("FY_MONTHS", () => {
  test("is Apr..Mar, 12 entries", () => {
    expect(FY_MONTHS.map((m) => m.label)).toEqual([
      "Apr", "May", "Jun", "Jul", "Aug", "Sep",
      "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
    ]);
  });
});

describe("getFinancialYearStart", () => {
  test("a March date belongs to prior FY start year", () => {
    expect(getFinancialYearStart(new Date(2026, 2, 15))).toBe(2025); // Mar 2026 -> FY25-26
  });
  test("an April date starts a new FY", () => {
    expect(getFinancialYearStart(new Date(2026, 3, 1))).toBe(2026); // Apr 2026 -> FY26-27
  });
});

describe("fyLabel", () => {
  test("formats two-digit FY label", () => {
    expect(fyLabel(2025)).toBe("FY 25–26");
  });
});

describe("monthRangeWithinFy", () => {
  test("full FY26-27 is Apr 1 2026 -> Apr 1 2027", () => {
    const { start, end } = monthRangeWithinFy(2026, 0, 11);
    expect(start).toEqual(new Date(2026, 3, 1));
    expect(end).toEqual(new Date(2027, 3, 1)); // exclusive
  });
  test("Jun..Aug of FY26-27", () => {
    const { start, end } = monthRangeWithinFy(2026, 2, 4);
    expect(start).toEqual(new Date(2026, 5, 1)); // Jun 1
    expect(end).toEqual(new Date(2026, 8, 1)); // Sep 1 exclusive
  });
  test("Mar (last month) ends in next April", () => {
    const { end } = monthRangeWithinFy(2026, 11, 11);
    expect(end).toEqual(new Date(2027, 3, 1));
  });
});

describe("priorYearRange", () => {
  test("shifts both bounds back exactly one year", () => {
    const cur = monthRangeWithinFy(2026, 2, 4);
    const prior = priorYearRange(cur);
    expect(prior.start).toEqual(new Date(2025, 5, 1));
    expect(prior.end).toEqual(new Date(2026, 8, 1));
  });
});

describe("buildFyList", () => {
  test("lists every FY start year between min and max, newest first", () => {
    const list = buildFyList(new Date(2024, 5, 1), new Date(2026, 1, 1));
    expect(list.map((f) => f.startYear)).toEqual([2025, 2024, 2023]);
    expect(list[0].label).toBe("FY 25–26");
    expect(list[2].fyStart).toEqual(new Date(2023, 3, 1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: FAIL — `Cannot find module '../dashboardData'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/utility/dashboardData.js
// Pure helpers for the admin sales dashboard. No React, no Supabase imports.

// FY runs Apr(3) -> Mar(2). `off` is the calendar-year offset from the FY start year.
export const FY_MONTHS = [
  { label: "Apr", m: 3, off: 0 },
  { label: "May", m: 4, off: 0 },
  { label: "Jun", m: 5, off: 0 },
  { label: "Jul", m: 6, off: 0 },
  { label: "Aug", m: 7, off: 0 },
  { label: "Sep", m: 8, off: 0 },
  { label: "Oct", m: 9, off: 0 },
  { label: "Nov", m: 10, off: 0 },
  { label: "Dec", m: 11, off: 0 },
  { label: "Jan", m: 0, off: 1 },
  { label: "Feb", m: 1, off: 1 },
  { label: "Mar", m: 2, off: 1 },
];

export function getFinancialYearStart(date) {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-indexed; April = 3
  return m >= 3 ? y : y - 1;
}

export function fyLabel(startYear) {
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return `FY ${a}–${b}`;
}

export function monthRangeWithinFy(startYear, fromIdx, toIdx) {
  const from = FY_MONTHS[fromIdx];
  const to = FY_MONTHS[toIdx];
  const start = new Date(startYear + from.off, from.m, 1);
  // First day of the month AFTER `to` (exclusive upper bound). JS rolls Dec+1 -> Jan.
  const end = new Date(startYear + to.off, to.m + 1, 1);
  return { start, end };
}

export function priorYearRange({ start, end }) {
  return {
    start: new Date(start.getFullYear() - 1, start.getMonth(), start.getDate()),
    end: new Date(end.getFullYear() - 1, end.getMonth(), end.getDate()),
  };
}

export function buildFyList(minDate, maxDate) {
  const minY = getFinancialYearStart(minDate);
  const maxY = getFinancialYearStart(maxDate);
  const list = [];
  for (let y = maxY; y >= minY; y--) {
    list.push({
      startYear: y,
      label: fyLabel(y),
      fyStart: new Date(y, 3, 1),
      fyEnd: new Date(y + 1, 3, 1),
    });
  }
  return list;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: PASS (all FY/date describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): FY date-range helpers with tests"
```

---

## Task 2: KPI aggregator + badge logic (pure)

**Files:**
- Modify: `src/utility/dashboardData.js` (append)
- Test: `src/utility/__tests__/dashboardData.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { aggregateKpis, pctChange, badgeFor } from "../dashboardData";

describe("pctChange", () => {
  test("returns null when prior is 0 (no baseline)", () => {
    expect(pctChange(100, 0)).toBeNull();
  });
  test("computes percentage change", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(80, 100)).toBe(-20);
  });
});

describe("badgeFor", () => {
  test("null change -> neutral dash", () => {
    expect(badgeFor(null)).toEqual({ symbol: "—", tone: "neutral" });
  });
  test("under 2% magnitude -> neutral", () => {
    expect(badgeFor(1.5)).toEqual({ symbol: "—", tone: "neutral" });
  });
  test("positive -> green up by default", () => {
    expect(badgeFor(10)).toEqual({ symbol: "↑", tone: "good" });
  });
  test("negative -> red down by default", () => {
    expect(badgeFor(-10)).toEqual({ symbol: "↓", tone: "bad" });
  });
  test("inverse metric (discount): increase is bad", () => {
    expect(badgeFor(10, { inverse: true })).toEqual({ symbol: "↑", tone: "bad" });
    expect(badgeFor(-10, { inverse: true })).toEqual({ symbol: "↓", tone: "good" });
  });
});

describe("aggregateKpis", () => {
  const bills = [
    { billid: 1, net_amount: 1000 },
    { billid: 2, net_amount: 500 },
  ];
  const items = [
    { billid: 1, total: 600, cost_price: 200, quantity: 2, discount_total: 50 },
    { billid: 1, total: 400, cost_price: 100, quantity: 1, discount_total: 0 },
    { billid: 2, total: 500, cost_price: null, quantity: 3, discount_total: 25 },
  ];
  test("computes revenue/cost/profit/aov/margin/discount", () => {
    const k = aggregateKpis(bills, items);
    expect(k.revenue).toBe(1500);
    expect(k.billsCount).toBe(2);
    expect(k.cost).toBe(500); // 200*2 + 100*1 + 0 (null)*3
    expect(k.profit).toBe(1000);
    expect(k.aov).toBe(750);
    expect(k.grossMargin).toBeCloseTo(66.6667, 3); // (1500-500)/1500*100
    expect(k.discountGiven).toBe(75);
    expect(k.discountPctOfGross).toBeCloseTo((75 / 1575) * 100, 3);
  });
  test("handles empty period without NaN", () => {
    const k = aggregateKpis([], []);
    expect(k).toMatchObject({ revenue: 0, billsCount: 0, aov: 0, grossMargin: 0, profit: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: FAIL — `aggregateKpis`/`pctChange`/`badgeFor` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utility/dashboardData.js`:

```js
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function aggregateKpis(bills, items) {
  const revenue = bills.reduce((s, b) => s + num(b.net_amount), 0);
  const billsCount = bills.length;
  const cost = items.reduce((s, i) => s + num(i.cost_price) * num(i.quantity), 0);
  const discountGiven = items.reduce((s, i) => s + num(i.discount_total), 0);
  const profit = revenue - cost;
  const aov = billsCount ? revenue / billsCount : 0;
  const grossMargin = revenue ? ((revenue - cost) / revenue) * 100 : 0;
  const gross = revenue + discountGiven; // gross sales before discount
  const discountPctOfGross = gross ? (discountGiven / gross) * 100 : 0;
  return { revenue, billsCount, cost, profit, aov, grossMargin, discountGiven, discountPctOfGross };
}

export function pctChange(curr, prior) {
  if (!prior) return null; // no baseline -> caller shows neutral
  return ((curr - prior) / prior) * 100;
}

export function badgeFor(change, { inverse = false } = {}) {
  if (change === null || Math.abs(change) < 2) return { symbol: "—", tone: "neutral" };
  const up = change > 0;
  const good = inverse ? !up : up;
  return { symbol: up ? "↑" : "↓", tone: good ? "good" : "bad" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): KPI aggregator and badge logic with tests"
```

---

## Task 3: Monthly series aggregator — revenue + margin (pure)

Returns a 12-entry Apr→Mar series with per-month `revenue`, `cost`, and `margin` %. Margin per month powers the trend line overlaid on the revenue chart (Task 8). `cost` needs per-month attribution of `bill_items`, which carry no date — so we map each item to its bill's month via a `billid → slot` lookup built from `bills`.

**Files:**
- Modify: `src/utility/dashboardData.js` (append)
- Test: `src/utility/__tests__/dashboardData.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
import { aggregateMonthlySeries } from "../dashboardData";

describe("aggregateMonthlySeries", () => {
  const bills = [
    { billid: 1, orderdate: "2026-04-10T00:00:00Z", net_amount: 100 }, // Apr
    { billid: 2, orderdate: "2026-04-20T00:00:00Z", net_amount: 50 },  // Apr
    { billid: 3, orderdate: "2027-01-05T00:00:00Z", net_amount: 300 }, // Jan (same FY)
  ];
  const items = [
    { billid: 1, total: 100, cost_price: 30, quantity: 1 }, // Apr cost 30
    { billid: 2, total: 50, cost_price: 10, quantity: 2 },  // Apr cost 20
    { billid: 3, total: 300, cost_price: 90, quantity: 1 }, // Jan cost 90
  ];
  test("buckets revenue + cost into Apr..Mar order and computes margin", () => {
    const series = aggregateMonthlySeries(bills, items, 2026);
    expect(series).toHaveLength(12);
    expect(series[0]).toMatchObject({ label: "Apr", revenue: 150, cost: 50 });
    expect(series[0].margin).toBeCloseTo(((150 - 50) / 150) * 100, 3);
    expect(series[9]).toMatchObject({ label: "Jan", revenue: 300, cost: 90 });
    expect(series[1]).toMatchObject({ label: "May", revenue: 0, cost: 0, margin: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: FAIL — `aggregateMonthlySeries` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utility/dashboardData.js`:

```js
export function aggregateMonthlySeries(bills, items, fyStartYear) {
  const revenue = FY_MONTHS.map(() => 0);
  const cost = FY_MONTHS.map(() => 0);
  // Map a calendar month (0-11) to its slot in the Apr..Mar sequence.
  const slotOf = (m) => (m >= 3 ? m - 3 : m + 9);
  const billSlot = new Map(); // billid -> slot index
  for (const b of bills) {
    const slot = slotOf(new Date(b.orderdate).getMonth());
    billSlot.set(b.billid, slot);
    revenue[slot] += num(b.net_amount);
  }
  for (const i of items) {
    const slot = billSlot.get(i.billid);
    if (slot == null) continue; // item whose bill isn't in this period
    cost[slot] += num(i.cost_price) * num(i.quantity);
  }
  return FY_MONTHS.map((mo, idx) => ({
    label: mo.label,
    revenue: revenue[idx],
    cost: cost[idx],
    margin: revenue[idx] ? ((revenue[idx] - cost[idx]) / revenue[idx]) * 100 : 0,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): monthly revenue+margin series aggregator with tests"
```

---

## Task 4: Category breakdown aggregator (pure)

**Files:**
- Modify: `src/utility/dashboardData.js` (append)
- Test: `src/utility/__tests__/dashboardData.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
import { aggregateCategories } from "../dashboardData";

describe("aggregateCategories", () => {
  const items = [
    { category: "Saree", total: 1000, cost_price: 300, quantity: 2 }, // cost 600
    { category: "Saree", total: 500, cost_price: 100, quantity: 1 },  // cost 100
    { category: "Kurti", total: 800, cost_price: 200, quantity: 1 },  // cost 200
    { category: null, total: 200, cost_price: null, quantity: 1 },    // Uncategorized
  ];
  test("groups, computes margin, sorts by revenue desc", () => {
    const rows = aggregateCategories(items);
    expect(rows.map((r) => r.category)).toEqual(["Saree", "Kurti", "Uncategorized"]);
    expect(rows[0]).toMatchObject({ category: "Saree", revenue: 1500, cost: 700 });
    expect(rows[0].margin).toBeCloseTo(((1500 - 700) / 1500) * 100, 3);
    expect(rows[2]).toMatchObject({ category: "Uncategorized", revenue: 200, cost: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: FAIL — `aggregateCategories` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utility/dashboardData.js`:

```js
export function aggregateCategories(items) {
  const map = new Map();
  for (const i of items) {
    const key = i.category && String(i.category).trim() ? i.category : "Uncategorized";
    const row = map.get(key) || { category: key, revenue: 0, cost: 0 };
    row.revenue += num(i.total);
    row.cost += num(i.cost_price) * num(i.quantity);
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): category breakdown aggregator with tests"
```

---

## Task 5: Salesperson aggregator (pure)

**Files:**
- Modify: `src/utility/dashboardData.js` (append)
- Test: `src/utility/__tests__/dashboardData.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
import { aggregateSalespersons } from "../dashboardData";

describe("aggregateSalespersons", () => {
  const items = [
    { billid: 1, salesperson_id: 10, total: 600 },
    { billid: 1, salesperson_id: 10, total: 400 }, // same bill, same person
    { billid: 2, salesperson_id: 10, total: 1000 },
    { billid: 3, salesperson_id: 20, total: 300 },
    { billid: 4, salesperson_id: null, total: 999 }, // unattributed -> skipped
  ];
  const byId = { 10: "Asha", 20: "Bina" };
  test("sums revenue, counts distinct bills, computes AOV, ranks desc", () => {
    const rows = aggregateSalespersons(items, byId);
    expect(rows[0]).toEqual({ rank: 1, salespersonId: 10, name: "Asha", bills: 2, revenue: 2000, aov: 1000 });
    expect(rows[1]).toEqual({ rank: 2, salespersonId: 20, name: "Bina", bills: 1, revenue: 300, aov: 300 });
    expect(rows).toHaveLength(2); // null salesperson excluded
  });
  test("falls back to #id when name missing", () => {
    const rows = aggregateSalespersons([{ billid: 9, salesperson_id: 77, total: 5 }], {});
    expect(rows[0].name).toBe("#77");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: FAIL — `aggregateSalespersons` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utility/dashboardData.js`:

```js
export function aggregateSalespersons(items, salespersonsById = {}) {
  const map = new Map();
  for (const i of items) {
    if (i.salesperson_id == null) continue;
    const id = i.salesperson_id;
    const row = map.get(id) || { salespersonId: id, revenue: 0, billIds: new Set() };
    row.revenue += num(i.total);
    row.billIds.add(i.billid);
    map.set(id, row);
  }
  return [...map.values()]
    .map((r) => {
      const bills = r.billIds.size;
      return {
        salespersonId: r.salespersonId,
        name: salespersonsById[r.salespersonId] || `#${r.salespersonId}`,
        bills,
        revenue: r.revenue,
        aov: bills ? r.revenue / bills : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .map((r, idx) => ({ rank: idx + 1, ...r }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): salesperson performance aggregator with tests"
```

---

## Task 6: Discount totals aggregator (pure)

**Files:**
- Modify: `src/utility/dashboardData.js` (append)
- Test: `src/utility/__tests__/dashboardData.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
import { aggregateDiscounts } from "../dashboardData";

describe("aggregateDiscounts", () => {
  const bills = [
    { billid: 1, applied_codes: ["DIWALI10"] }, // code-driven
    { billid: 2, applied_codes: [] },           // manual
    { billid: 3, applied_codes: null },         // manual (null treated as none)
  ];
  const items = [
    { billid: 1, discount_total: 100 },
    { billid: 1, discount_total: 50 },
    { billid: 2, discount_total: 30 },
    { billid: 3, discount_total: 20 },
  ];
  test("splits total discount into code vs manual with bill counts", () => {
    const d = aggregateDiscounts(bills, items);
    expect(d.total).toBe(200);
    expect(d.code).toEqual({ bills: 1, amount: 150 });
    expect(d.manual).toEqual({ bills: 2, amount: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: FAIL — `aggregateDiscounts` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utility/dashboardData.js`:

```js
export function aggregateDiscounts(bills, items) {
  const hasCode = new Map(); // billid -> bool
  for (const b of bills) {
    hasCode.set(b.billid, Array.isArray(b.applied_codes) && b.applied_codes.length > 0);
  }
  let codeAmount = 0;
  let manualAmount = 0;
  const codeBills = new Set();
  const manualBills = new Set();
  for (const i of items) {
    const amt = num(i.discount_total);
    if (hasCode.get(i.billid)) {
      codeAmount += amt;
      if (amt > 0) codeBills.add(i.billid);
    } else {
      manualAmount += amt;
      if (amt > 0) manualBills.add(i.billid);
    }
  }
  return {
    total: codeAmount + manualAmount,
    code: { bills: codeBills.size, amount: codeAmount },
    manual: { bills: manualBills.size, amount: manualAmount },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js`
Expected: PASS (entire pure module green).

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): discount totals aggregator with tests"
```

---

## Task 7: KpiCards component

**Files:**
- Create: `src/admin/components/dashboard/KpiCards.js`
- Test: `src/admin/components/dashboard/__tests__/KpiCards.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/admin/components/dashboard/__tests__/KpiCards.test.js
import { render, screen } from "@testing-library/react";
import KpiCards from "../KpiCards";

const current = {
  bills: [{ billid: 1, net_amount: 1500 }, { billid: 2, net_amount: 500 }],
  items: [{ billid: 1, total: 2000, cost_price: 500, quantity: 1, discount_total: 100 }],
};
const prior = {
  bills: [{ billid: 9, net_amount: 1000 }],
  items: [{ billid: 9, total: 1000, cost_price: 400, quantity: 1, discount_total: 50 }],
};

test("renders six KPI cards with revenue figure", () => {
  render(<KpiCards current={current} prior={prior} loading={false} />);
  expect(screen.getByText("Revenue")).toBeInTheDocument();
  expect(screen.getByText("Gross Margin %")).toBeInTheDocument();
  expect(screen.getByText("Profit")).toBeInTheDocument();
  // revenue 2000 -> ₹2,000 (en-IN grouping)
  expect(screen.getByText("₹2,000")).toBeInTheDocument();
});

test("shows skeleton text while loading", () => {
  render(<KpiCards current={current} prior={prior} loading={true} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/KpiCards.test.js`
Expected: FAIL — `Cannot find module '../KpiCards'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/admin/components/dashboard/KpiCards.js
import React from "react";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateKpis, pctChange, badgeFor } from "../../../utility/dashboardData";

const toneClass = {
  good: "text-green-600 bg-green-50",
  bad: "text-red-600 bg-red-50",
  neutral: "text-gray-500 bg-gray-100",
};

function Badge({ change, inverse }) {
  const b = badgeFor(change, { inverse });
  const pct = change === null ? "" : ` ${Math.abs(change).toFixed(0)}%`;
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${toneClass[b.tone]}`}>
      {b.symbol}{pct}
    </span>
  );
}

function Card({ title, value, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">{title}</span>
        {children}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-gray-400">{subtitle}</div>}
    </div>
  );
}

export default function KpiCards({ current, prior, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading KPIs…</div>;
  }
  const cur = aggregateKpis(current.bills, current.items);
  const pri = aggregateKpis(prior.bills, prior.items);

  return (
    <div className="grid grid-cols-6 gap-3">
      <Card title="Revenue" value={formatINR(cur.revenue)} subtitle="vs prior FY">
        <Badge change={pctChange(cur.revenue, pri.revenue)} />
      </Card>
      <Card title="Gross Margin %" value={`${cur.grossMargin.toFixed(1)}%`} subtitle="target 50–65%" />
      <Card title="Bills" value={cur.billsCount.toLocaleString("en-IN")} subtitle="vs prior FY">
        <Badge change={pctChange(cur.billsCount, pri.billsCount)} />
      </Card>
      <Card title="Avg Order Value" value={formatINR(cur.aov)} subtitle="revenue / bills" />
      <Card
        title="Discount Given"
        value={formatINR(cur.discountGiven)}
        subtitle={`${cur.discountPctOfGross.toFixed(1)}% of gross`}
      >
        <Badge change={pctChange(cur.discountGiven, pri.discountGiven)} inverse />
      </Card>
      <Card title="Profit" value={formatINR(cur.profit)} subtitle="vs prior FY">
        <Badge change={pctChange(cur.profit, pri.profit)} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/KpiCards.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/KpiCards.js src/admin/components/dashboard/__tests__/KpiCards.test.js
git commit -m "feat(dashboard): KpiCards component"
```

---

## Task 8: RevenueChart component

**Files:**
- Create: `src/admin/components/dashboard/RevenueChart.js`
- Test: `src/admin/components/dashboard/__tests__/RevenueChart.test.js`

Note: Plotly is heavy and renders to canvas/SVG; the test mocks the factory so it stays a fast unit test. This mirrors the import style in `src/admin/pages/MockupGraphsPage.js:3-7`.

- [ ] **Step 1: Write the failing test**

```js
// src/admin/components/dashboard/__tests__/RevenueChart.test.js
import { render, screen } from "@testing-library/react";

// Mock the Plotly factory so we don't render a real chart in jsdom.
jest.mock("react-plotly.js/factory", () => () => (props) => (
  <div data-testid="plot" data-traces={props.data.length} />
));
jest.mock("plotly.js-basic-dist-min", () => ({}));

import RevenueChart from "../RevenueChart";

const period = (rev) => ({
  bills: [{ billid: 1, orderdate: "2026-04-10T00:00:00Z", net_amount: rev }],
  items: [{ billid: 1, total: rev, cost_price: rev * 0.4, quantity: 1 }],
});

test("renders three traces: prior bars, current bars, margin line", () => {
  render(
    <RevenueChart
      current={period(1000)}
      prior={period(800)}
      range={{ startYear: 2026, fromIdx: 0, toIdx: 11 }}
      loading={false}
    />
  );
  expect(screen.getByTestId("plot").getAttribute("data-traces")).toBe("3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/RevenueChart.test.js`
Expected: FAIL — `Cannot find module '../RevenueChart'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/admin/components/dashboard/RevenueChart.js
import React from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";
import { aggregateMonthlySeries, fyLabel } from "../../../utility/dashboardData";

const Plot = createPlotlyComponent(Plotly);
const toLakhs = (v) => v / 100000;

export default function RevenueChart({ current, prior, range, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading chart…</div>;
  }
  const curSeries = aggregateMonthlySeries(current.bills, current.items, range.startYear);
  const priSeries = aggregateMonthlySeries(prior.bills, prior.items, range.startYear - 1);
  const months = curSeries.map((s) => s.label);

  const data = [
    {
      type: "bar",
      name: fyLabel(range.startYear - 1),
      x: months,
      y: priSeries.map((s) => toLakhs(s.revenue)),
      marker: { color: "#bfdbfe" },
    },
    {
      type: "bar",
      name: fyLabel(range.startYear),
      x: months,
      y: curSeries.map((s) => toLakhs(s.revenue)),
      marker: { color: "#0066cc" },
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Margin %",
      x: months,
      y: curSeries.map((s) => s.margin),
      yaxis: "y2", // secondary axis
      line: { color: "#f59e0b", width: 2 },
      marker: { color: "#f59e0b", size: 5 },
    },
  ];

  const layout = {
    barmode: "group",
    height: 240,
    margin: { t: 10, r: 44, b: 30, l: 40 },
    yaxis: { title: "₹ (lakhs)", zeroline: true },
    yaxis2: {
      title: "Margin %",
      overlaying: "y",
      side: "right",
      range: [0, 100],
      showgrid: false,
      ticksuffix: "%",
    },
    xaxis: { fixedrange: true },
    legend: { orientation: "h", y: 1.15 },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Monthly Revenue &amp; Margin</h3>
      <Plot data={data} layout={layout} config={{ displayModeBar: false, responsive: true }} style={{ width: "100%" }} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/RevenueChart.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/RevenueChart.js src/admin/components/dashboard/__tests__/RevenueChart.test.js
git commit -m "feat(dashboard): RevenueChart component (current vs prior FY)"
```

---

## Task 9: CategoryBreakdown component

**Files:**
- Create: `src/admin/components/dashboard/CategoryBreakdown.js`
- Test: `src/admin/components/dashboard/__tests__/CategoryBreakdown.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/admin/components/dashboard/__tests__/CategoryBreakdown.test.js
import { render, screen } from "@testing-library/react";
import CategoryBreakdown from "../CategoryBreakdown";

const current = {
  bills: [],
  items: [
    { category: "Saree", total: 1000, cost_price: 300, quantity: 1 },
    { category: "Kurti", total: 400, cost_price: 100, quantity: 1 },
  ],
};

test("lists categories sorted by revenue with margin", () => {
  render(<CategoryBreakdown current={current} loading={false} />);
  const rows = screen.getAllByTestId("category-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Saree");
  expect(screen.getByText("₹1,000")).toBeInTheDocument();
});

test("empty state when no items", () => {
  render(<CategoryBreakdown current={{ bills: [], items: [] }} loading={false} />);
  expect(screen.getByText(/no category data/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/CategoryBreakdown.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/admin/components/dashboard/CategoryBreakdown.js
import React from "react";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateCategories } from "../../../utility/dashboardData";

const HUES = ["#0066cc", "#7c3aed", "#06b6d4", "#f59e0b", "#64748b"];

export default function CategoryBreakdown({ current, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const rows = aggregateCategories(current.items);
  const max = rows.length ? rows[0].revenue : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Category Breakdown</h3>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">No category data</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.category} data-testid="category-row" className="text-xs">
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-medium text-gray-700">{r.category}</span>
                <span className="text-gray-500">
                  {formatINR(r.revenue)} · {r.margin.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${max ? (r.revenue / max) * 100 : 0}%`,
                    backgroundColor: HUES[i % HUES.length],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/CategoryBreakdown.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/CategoryBreakdown.js src/admin/components/dashboard/__tests__/CategoryBreakdown.test.js
git commit -m "feat(dashboard): CategoryBreakdown component"
```

---

## Task 10: SalespersonTable component

**Files:**
- Create: `src/admin/components/dashboard/SalespersonTable.js`
- Test: `src/admin/components/dashboard/__tests__/SalespersonTable.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/admin/components/dashboard/__tests__/SalespersonTable.test.js
import { render, screen } from "@testing-library/react";
import SalespersonTable from "../SalespersonTable";

const current = {
  bills: [],
  items: [
    { billid: 1, salesperson_id: 10, total: 1000 },
    { billid: 2, salesperson_id: 20, total: 400 },
  ],
};

test("renders ranked rows with salesperson names", () => {
  render(<SalespersonTable current={current} salespersonsById={{ 10: "Asha", 20: "Bina" }} loading={false} />);
  expect(screen.getByText("Asha")).toBeInTheDocument();
  expect(screen.getByText("Bina")).toBeInTheDocument();
  const rows = screen.getAllByTestId("salesperson-row");
  expect(rows[0]).toHaveTextContent("Asha"); // highest revenue first
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/SalespersonTable.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/admin/components/dashboard/SalespersonTable.js
import React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateSalespersons } from "../../../utility/dashboardData";

export default function SalespersonTable({ current, salespersonsById, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const rows = aggregateSalespersons(current.items, salespersonsById);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Salesperson Performance</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Bills</TableHead>
            <TableHead className="text-right">AOV</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center text-gray-400">No sales</TableCell></TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.salespersonId} data-testid="salesperson-row">
                <TableCell>{r.rank}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{r.bills}</TableCell>
                <TableCell className="text-right">{formatINR(r.aov)}</TableCell>
                <TableCell className="text-right">{formatINR(r.revenue)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/SalespersonTable.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/SalespersonTable.js src/admin/components/dashboard/__tests__/SalespersonTable.test.js
git commit -m "feat(dashboard): SalespersonTable component"
```

---

## Task 11: DiscountTable component

**Files:**
- Create: `src/admin/components/dashboard/DiscountTable.js`
- Test: `src/admin/components/dashboard/__tests__/DiscountTable.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/admin/components/dashboard/__tests__/DiscountTable.test.js
import { render, screen } from "@testing-library/react";
import DiscountTable from "../DiscountTable";

const current = {
  bills: [{ billid: 1, applied_codes: ["X"] }, { billid: 2, applied_codes: [] }],
  items: [
    { billid: 1, discount_total: 150 },
    { billid: 2, discount_total: 50 },
  ],
};

test("shows total, code, and manual discount rows", () => {
  render(<DiscountTable current={current} loading={false} />);
  expect(screen.getByText("Total Discount")).toBeInTheDocument();
  expect(screen.getByText("Code-driven")).toBeInTheDocument();
  expect(screen.getByText("Manual")).toBeInTheDocument();
  expect(screen.getByText("₹200")).toBeInTheDocument(); // total
  expect(screen.getByText("₹150")).toBeInTheDocument(); // code
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/DiscountTable.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/admin/components/dashboard/DiscountTable.js
import React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateDiscounts } from "../../../utility/dashboardData";

export default function DiscountTable({ current, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const d = aggregateDiscounts(current.bills, current.items);
  const rows = [
    { label: "Code-driven", bills: d.code.bills, amount: d.code.amount },
    { label: "Manual", bills: d.manual.bills, amount: d.manual.amount },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Discount Impact</h3>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs text-gray-500">Total Discount</span>
        <span className="text-xl font-semibold text-gray-900">{formatINR(d.total)}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Bills</TableHead>
            <TableHead className="text-right">₹ Given</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right">{r.bills}</TableCell>
              <TableCell className="text-right">{formatINR(r.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/DiscountTable.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/DiscountTable.js src/admin/components/dashboard/__tests__/DiscountTable.test.js
git commit -m "feat(dashboard): DiscountTable component"
```

---

## Task 12: DashboardFilters component

**Files:**
- Create: `src/admin/components/dashboard/DashboardFilters.js`
- Test: `src/admin/components/dashboard/__tests__/DashboardFilters.test.js`

The filter is **controlled**: parent owns `{ startYear, fromIdx, toIdx }` and `fyList`, passes `value` + `onChange`. This keeps fetch-triggering state in the page.

- [ ] **Step 1: Write the failing test**

```js
// src/admin/components/dashboard/__tests__/DashboardFilters.test.js
import { render, screen } from "@testing-library/react";
import DashboardFilters from "../DashboardFilters";

const fyList = [
  { startYear: 2026, label: "FY 26–27" },
  { startYear: 2025, label: "FY 25–26" },
];

test("renders a tab per FY and month selects", () => {
  render(
    <DashboardFilters
      fyList={fyList}
      value={{ startYear: 2026, fromIdx: 0, toIdx: 11 }}
      onChange={() => {}}
    />
  );
  expect(screen.getByText("FY 26–27")).toBeInTheDocument();
  expect(screen.getByText("FY 25–26")).toBeInTheDocument();
  expect(screen.getByText(/from month/i)).toBeInTheDocument();
  expect(screen.getByText(/to month/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/DashboardFilters.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/admin/components/dashboard/DashboardFilters.js
import React from "react";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../components/ui/select";
import { FY_MONTHS } from "../../../utility/dashboardData";

export default function DashboardFilters({ fyList, value, onChange }) {
  const { startYear, fromIdx, toIdx } = value;

  const setFy = (sy) => {
    const y = Number(sy);
    onChange({ startYear: y, fromIdx: 0, toIdx: 11 }); // reset to full FY on year switch
  };
  const setFrom = (i) => {
    const f = Number(i);
    onChange({ ...value, fromIdx: f, toIdx: Math.max(f, toIdx) });
  };
  const setTo = (i) => {
    const t = Number(i);
    onChange({ ...value, toIdx: t, fromIdx: Math.min(fromIdx, t) });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={String(startYear)} onValueChange={setFy}>
        <TabsList>
          {fyList.map((fy) => (
            <TabsTrigger key={fy.startYear} value={String(fy.startYear)}>
              {fy.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2">
        <Select value={String(fromIdx)} onValueChange={setFrom}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="From month" /></SelectTrigger>
          <SelectContent>
            {FY_MONTHS.map((m, i) => (
              <SelectItem key={m.label} value={String(i)}>From: {m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-gray-400">→</span>
        <Select value={String(toIdx)} onValueChange={setTo}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="To month" /></SelectTrigger>
          <SelectContent>
            {FY_MONTHS.map((m, i) => (
              <SelectItem key={m.label} value={String(i)}>To: {m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

> Note: the test asserts the strings "from month"/"to month" appear — they come from the `SelectValue placeholder`. If the Shadcn `SelectValue` does not render the placeholder text in jsdom when a value is set, change the assertion to check for `From: Apr` / `To: Mar` instead. Verify by running the test; adjust the assertion (not the component) if needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/DashboardFilters.test.js`
Expected: PASS. If the placeholder assertion fails (see note), switch it to `screen.getByText("From: Apr")` / `screen.getByText("To: Mar")` and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/DashboardFilters.js src/admin/components/dashboard/__tests__/DashboardFilters.test.js
git commit -m "feat(dashboard): DashboardFilters (FY tabs + month range)"
```

---

## Task 13: DashboardPage shell + paginated fetch

**Files:**
- Create: `src/admin/pages/DashboardPage.js`

This page owns filter state, builds the FY list from min/max `orderdate`, fetches current + prior periods + salespersons in parallel (paginated), and passes datasets to children. No test file — covered by manual verification in Task 15; the math is already unit-tested.

- [ ] **Step 1: Write the implementation**

```js
// src/admin/pages/DashboardPage.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import {
  buildFyList,
  getFinancialYearStart,
  monthRangeWithinFy,
  priorYearRange,
} from "../../utility/dashboardData";
import DashboardFilters from "../components/dashboard/DashboardFilters";
import KpiCards from "../components/dashboard/KpiCards";
import RevenueChart from "../components/dashboard/RevenueChart";
import CategoryBreakdown from "../components/dashboard/CategoryBreakdown";
import SalespersonTable from "../components/dashboard/SalespersonTable";
import DiscountTable from "../components/dashboard/DiscountTable";

const PAGE = 1000;
const EMPTY = { bills: [], items: [] };

// Supabase caps each response at 1000 rows. Loop with .range until a short page.
async function fetchAllRows(makeQuery) {
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const iso = (d) => d.toISOString();

async function fetchPeriod({ start, end }) {
  const [bills, items] = await Promise.all([
    fetchAllRows(() =>
      supabase
        .from("bills")
        .select("billid, net_amount, orderdate, applied_codes")
        .gte("orderdate", iso(start))
        .lt("orderdate", iso(end))
        .eq("finalized", true)
    ),
    // bill_items has no date column -> filter via embedded inner join on bills.
    fetchAllRows(() =>
      supabase
        .from("bill_items")
        .select(
          "billid, category, total, cost_price, quantity, discount_total, salesperson_id, bills!inner(orderdate, finalized)"
        )
        .gte("bills.orderdate", iso(start))
        .lt("bills.orderdate", iso(end))
        .eq("bills.finalized", true)
    ),
  ]);
  return { bills, items };
}

export default function DashboardPage() {
  const [fyList, setFyList] = useState([]);
  const [filter, setFilter] = useState(null); // { startYear, fromIdx, toIdx }
  const [current, setCurrent] = useState(EMPTY);
  const [prior, setPrior] = useState(EMPTY);
  const [salespersonsById, setSalespersonsById] = useState({});
  const [loading, setLoading] = useState(true);

  // Build FY tabs from earliest/latest finalized bill, and load salespersons (once).
  useEffect(() => {
    (async () => {
      try {
        const [minRes, maxRes, spRes] = await Promise.all([
          supabase.from("bills").select("orderdate").eq("finalized", true).order("orderdate", { ascending: true }).limit(1),
          supabase.from("bills").select("orderdate").eq("finalized", true).order("orderdate", { ascending: false }).limit(1),
          supabase.from("salespersons").select("salesperson_id, name"),
        ]);
        if (spRes.error) throw spRes.error;
        const map = {};
        (spRes.data || []).forEach((s) => { map[s.salesperson_id] = s.name; });
        setSalespersonsById(map);

        const minDate = minRes.data?.[0] ? new Date(minRes.data[0].orderdate) : new Date();
        const maxDate = maxRes.data?.[0] ? new Date(maxRes.data[0].orderdate) : new Date();
        const list = buildFyList(minDate, maxDate);
        setFyList(list);

        const currentFyStart = getFinancialYearStart(new Date());
        const defaultYear = list.some((f) => f.startYear === currentFyStart)
          ? currentFyStart
          : (list[0]?.startYear ?? currentFyStart);
        setFilter({ startYear: defaultYear, fromIdx: 0, toIdx: 11 });
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard setup");
        setLoading(false);
      }
    })();
  }, []);

  const ranges = useMemo(() => {
    if (!filter) return null;
    const cur = monthRangeWithinFy(filter.startYear, filter.fromIdx, filter.toIdx);
    return { cur, prior: priorYearRange(cur) };
  }, [filter]);

  // Fetch both periods whenever the range changes.
  useEffect(() => {
    if (!ranges) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [cur, pri] = await Promise.all([fetchPeriod(ranges.cur), fetchPeriod(ranges.prior)]);
        if (cancelled) return;
        setCurrent(cur);
        setPrior(pri);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load dashboard data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ranges]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Sales Dashboard</h1>
        {filter && <DashboardFilters fyList={fyList} value={filter} onChange={setFilter} />}
      </div>

      <KpiCards current={current} prior={prior} loading={loading} />

      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <RevenueChart current={current} prior={prior} range={filter ?? { startYear: 0, fromIdx: 0, toIdx: 11 }} loading={loading} />
        <CategoryBreakdown current={current} loading={loading} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SalespersonTable current={current} salespersonsById={salespersonsById} loading={loading} />
        <DiscountTable current={current} loading={loading} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles (build, no test)**

Run: `CI=true npm test -- --watchAll=false src/admin/components/dashboard`
Expected: all child component tests still PASS (no import regressions).

- [ ] **Step 3: Commit**

```bash
git add src/admin/pages/DashboardPage.js
git commit -m "feat(dashboard): DashboardPage shell with paginated parallel fetch"
```

---

## Task 14: Wire route + navigation + default redirect

**Files:**
- Modify: `src/App.js` (add `Navigate` to the react-router-dom import at lines 2–6; add lazy import near line 17–30; add index redirect + `dashboard` route inside the `AdminLayout` block ~line 57–65)
- Modify: `src/admin/components/AdminLayout.js:6-16` (add nav item)

- [ ] **Step 1: Add `Navigate` to the react-router-dom import in `src/App.js`**

Change the import block (lines 2–6) to include `Navigate`:

```js
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
```

- [ ] **Step 2: Add the lazy import in `src/App.js`**

Add alongside the other admin page lazy imports (after the `InventoryPage` import, ~line 17):

```js
const DashboardPage = lazy(() => import("./admin/pages/DashboardPage"));
```

- [ ] **Step 3: Add the index redirect + dashboard route in `src/App.js`**

Inside `<Route element={<AdminLayout />}>`, add these as the first two child routes (before `inventory`). The `index` route makes bare `/admin` land on the dashboard:

```jsx
<Route index element={<Navigate to="/admin/dashboard" replace />} />
<Route path="dashboard" element={<DashboardPage />} />
```

- [ ] **Step 4: Add the nav item in `src/admin/components/AdminLayout.js`**

Change the `navItems` array (lines 6–16) to include Dashboard first:

```js
const navItems = [
  { label: "Dashboard", path: "/admin/dashboard" },
  { label: "Admin", path: "/admin/admin-hub" },
  { label: "Inventory", path: "/admin/inventory" },
  { label: "Mockups", path: "/admin/mockups" },
  { label: "Bills", path: "/admin/bills" },
  { label: "Vouchers", path: "/admin/vouchers" },
  { label: "Discounts", path: "/admin/discounts" },
  { label: "Exchanges", path: "/admin/exchanges" },
  { label: "Customers", path: "/admin/customers" },
  { label: "Suppliers", path: "/admin/suppliers" },
];
```

- [ ] **Step 5: Verify the full suite still passes**

Run: `CI=true npm test -- --watchAll=false`
Expected: PASS (no regressions across the repo).

- [ ] **Step 6: Verify the redirect manually**

Run: `npm start`, then visit `http://localhost:3000/admin` (logged in). Expected: URL replaces to `/admin/dashboard` and the dashboard renders.

- [ ] **Step 7: Commit**

```bash
git add src/App.js src/admin/components/AdminLayout.js
git commit -m "feat(dashboard): add /admin/dashboard route, nav link, and /admin redirect"
```

---

## Task 15: Manual verification in the running app

**Files:** none (manual QA).

- [ ] **Step 1: Start the dev server**

Run: `npm start`
Expected: compiles with no errors; opens `http://localhost:3000`.

- [ ] **Step 2: Log in and open the dashboard**

Navigate to `/admin/dashboard` (or click the new **Dashboard** nav link). Confirm:
- Six KPI cards render in one row with real ₹ figures and prior-FY badges.
- Revenue chart shows grouped bars (solid `#0066cc` current, faded `#bfdbfe` prior).
- Category list is sorted descending with bars + margin %.
- Salesperson table is ranked by revenue.
- Discount Impact shows Total + Code-driven + Manual.

- [ ] **Step 3: Exercise the filters**

- Switch FY tabs → all widgets refetch and update.
- Narrow the From/To month range → figures shrink accordingly; From never exceeds To.

- [ ] **Step 4: Sanity-check a number against a known source**

Pick the active FY, compare the Revenue KPI against the `AdminPage.jsx` MonthlySales total for the same period (both sum `bills.net_amount` over finalized bills). They should match.

- [ ] **Step 5: Update the knowledge graph**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
Expected: graph rebuilds without error (per `CLAUDE.md` graphify rule).

---

## Task 16: Legacy monthly sales table (migration scaffold only)

Creates an **empty** table to hold pre-`bills` monthly revenue history (~8 prior years). No real data is loaded here — the store owner will populate it later via a separate data migration. No chart consumes it yet; this task only lands the schema so the data has a home. Shape is **FY-based** (`fy_start_year` + `month_idx` where 0 = April … 11 = March) to mirror how the source sheet is laid out.

**Files:**
- Create: `schema/migration_monthly_sales_history.sql`

> Per project convention (`CLAUDE.md`): new schema goes in a `schema/migration_*.sql` file; never edit existing table files. Apply migrations via the Supabase SQL editor.

- [ ] **Step 1: Write the migration**

```sql
-- schema/migration_monthly_sales_history.sql
-- Pre-bills monthly revenue history (legacy, manually entered).
-- FY-based: fy_start_year is the April-year of the financial year
-- (e.g. 2018 => FY 2018-19), month_idx 0 = April ... 11 = March.
-- Revenue only: no cost / category / salesperson / discount detail available,
-- so this feeds revenue-level views only.

CREATE TABLE IF NOT EXISTS monthly_sales_history (
  fy_start_year integer NOT NULL,
  month_idx     integer NOT NULL CHECK (month_idx BETWEEN 0 AND 11),
  net_amount    numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (fy_start_year, month_idx)
);

COMMENT ON TABLE monthly_sales_history IS
  'Legacy monthly revenue prior to the bills table. Revenue totals only.';

-- Data is loaded separately by the owner. Example row (do not rely on this):
-- INSERT INTO monthly_sales_history (fy_start_year, month_idx, net_amount)
-- VALUES (2018, 0, 567021)  -- FY2018-19, April
-- ON CONFLICT (fy_start_year, month_idx) DO UPDATE SET net_amount = EXCLUDED.net_amount;
```

- [ ] **Step 2: Verify the SQL parses (no apply required)**

This task does not run the migration. Confirm the file exists and the SQL is syntactically complete (balanced statements, valid `CHECK`). Applying it to Supabase and loading data is deferred to the owner.

Run: `test -f schema/migration_monthly_sales_history.sql && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add schema/migration_monthly_sales_history.sql
git commit -m "feat(dashboard): migration scaffold for legacy monthly_sales_history table"
```

> **Deferred (not in this plan):** loading the 8-year data, resolving the 25-26 overlap with live `bills` (recommended cutover: legacy ≤ FY24-25, live owns FY25-26+), and any long-range trend chart that reads this table. Decide those when the data is entered.

---

## Self-Review (completed during planning)

**Spec coverage:**
- Route/nav → Task 14. Date filter (FY tabs + month range, default current FY full) → Tasks 1, 12, 13. KPI cards (all 6 + badge rules) → Tasks 2, 7. Revenue chart (Plotly, current+prior, lakhs, grouped) + margin% trend line on secondary axis → Tasks 3, 8. Category breakdown (HTML bars, margin, from `bill_items.category`) → Tasks 4, 9. Salesperson table (per-line-item credit, distinct-bill count) → Tasks 5, 10. Discount impact → Tasks 6, 11 (**simplified to totals per approved deviation #2**). Styling tokens (`grid-cols-6`, card classes, 240px chart, `formatINR`) → Tasks 7–11. "No new RPC, parallel fetch, prior-FY shift, finalized filter" → Task 13.
- Out-of-scope items (CSV/PDF, auto-refresh, alerts, customer/payment/top-product widgets) → not built. ✓

**Placeholder scan:** every code step contains complete code; commands have expected output. No TBD/TODO.

**Type consistency:** child props match the `DashboardPage` contract (`current`/`prior` = `{bills, items}`, `range = {startYear, fromIdx, toIdx}`, `salespersonsById`). Aggregator names are identical across tasks and consumers (`aggregateKpis`, `aggregateMonthlySeries`, `aggregateCategories`, `aggregateSalespersons`, `aggregateDiscounts`, `pctChange`, `badgeFor`, `FY_MONTHS`, `monthRangeWithinFy`, `priorYearRange`, `buildFyList`, `getFinancialYearStart`, `fyLabel`).
