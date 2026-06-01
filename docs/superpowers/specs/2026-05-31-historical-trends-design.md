# Historical Trends Chart — Design Spec

**Date:** 2026-05-31  
**Feature:** `HistoricalTrends` — tabbed chart wiring `monthly_sales_history` + live `bills`

---

## Goal

Add a "Historical Trends" section to `/admin/dashboard` (below existing widgets) that answers three questions from long-run revenue data:

1. **FY Trend** — How has annual revenue grown or declined each financial year since FY2017?
2. **Seasonality** — Which months are consistently peak or weak across all years?
3. **vs History** — How is the current FY (FY2026) tracking against historical monthly averages?

---

## Data Sources

| Source | Covers | Columns used |
|---|---|---|
| `monthly_sales_history` | FY2017–FY2025 (up to Mar 2026) | `fy_start_year`, `month_idx`, `net_amount` |
| `bills` (finalized, `orderdate >= 2026-04-01`) | FY2026 onward | `net_amount`, `orderdate` |

**NULL handling:** NULL `net_amount` in `monthly_sales_history` = gap in chart (`connectgaps: false`). Never treated as zero.

---

## Architecture

### Approach: Self-contained component

`HistoricalTrends` owns its own fetch. `DashboardPage` renders it at the bottom with no props — no changes to existing fetch logic or filter state.

### Fetch (parallel on mount)

```js
const [histRows, fy2026Bills] = await Promise.all([
  supabase.from("monthly_sales_history").select("fy_start_year, month_idx, net_amount"),
  fetchAllRows(() =>
    supabase.from("bills")
      .select("net_amount, orderdate")
      .eq("finalized", true)
      .gte("orderdate", "2026-04-01T00:00:00")
  )
]);
```

`fetchAllRows` is the existing paginated helper in `DashboardPage.js` — duplicate it locally inside `HistoricalTrends.js` (same implementation, no shared module needed).

---

## Pure Aggregators (add to `src/utility/dashboardData.js`)

### `buildFyTotals(histRows, fy2026Bills)`

Returns `[{ label: "FY 17-18", total: number|null, isLive: false }, ...]` sorted by FY.

- FY2017–FY2025: sum `net_amount` per `fy_start_year` (skip NULLs in sum; if all months NULL, `total: null`).
- FY2026: sum `net_amount` from bills, mark `isLive: true` (YTD).

### `buildSeasonalSeries(histRows, fy2026Bills)`

Returns `[{ label: "FY 17-18", values: [null|number, ...×12] }, ...]` — one entry per FY.

- Each `values` array has 12 slots (index = `month_idx`, i.e. 0=Apr … 11=Mar).
- NULL months → `null` in the array.
- FY2026: group bills by `month_idx` derived from `orderdate` via `(new Date(orderdate).getMonth() - 3 + 12) % 12` (Apr=0, May=1, … Mar=11); months not yet occurred → `null`.

### `buildVsHistoryComparison(histRows, fy2026Bills)`

Returns `{ months: string[12], currentFy: (number|null)[12], historicalAvg: (number|null)[12] }`.

- `months`: `["Apr", "May", …, "Mar"]`
- `currentFy[i]`: FY2026 revenue for `month_idx === i` (null if not yet occurred).
- `historicalAvg[i]`: mean of all non-NULL `net_amount` values for `month_idx === i` across FY2017–FY2025.

---

## Component: `HistoricalTrends`

**File:** `src/admin/components/dashboard/HistoricalTrends.js`

**State:**
```js
const [tab, setTab] = useState("trend");      // "trend" | "seasonal" | "vs-history"
const [histRows, setHistRows] = useState([]);
const [fy2026Bills, setFy2026Bills] = useState([]);
const [loading, setLoading] = useState(true);
```

**Tab UI:** Shadcn `<Tabs>` with 3 `<TabsTrigger>` values. Wrapped in a white rounded card (`bg-white rounded-xl border border-gray-200 p-5`).

**Loading state:** Gray placeholder card matching existing widget pattern.

**Error state:** `toast.error("Failed to load historical data")` on fetch failure.

---

## Chart Specs (Plotly — reuse existing `Plot` factory)

### Tab 1 — FY Trend

- **Type:** `bar`
- **x:** FY labels (e.g. `"FY 17-18"`)
- **y:** revenue in ₹ lakhs
- **FY2026 bar:** `marker.color: "#0066cc"`, `opacity: 0.75`, legend name `"FY 26-27 (YTD)"` to signal partial year
- **Prior FYs:** `marker.color: "#93c5fd"`
- **Hover:** `"₹X.X L (+Y% vs prior FY)"`
- **Height:** 260px

### Tab 2 — Seasonality

- **Type:** `scatter`, `mode: "lines+markers"`, one trace per FY
- **x:** `["Apr", "May", …, "Mar"]`
- **y:** monthly revenue in ₹ lakhs (null = gap)
- **`connectgaps: false`** on every trace
- **FY2026 trace:** `line.color: "#0066cc"`, `line.width: 2.5`, rendered last (on top)
- **Prior FY traces:** `line.color: "#d1d5db"`, `line.width: 1`, `opacity: 0.6`
- **Height:** 260px

### Tab 3 — vs History

- **Trace 1 (bars):** FY2026 actual — `type: "bar"`, `marker.color: "#0066cc"`, null for future months
- **Trace 2 (line):** historical avg — `type: "scatter"`, `mode: "lines"`, `line.color: "#f59e0b"`, `line.dash: "dash"`, spans all 12 months
- **x:** `["Apr", "May", …, "Mar"]`
- **y:** ₹ lakhs
- **Hover on bars:** `"FY26: ₹X.X L | Avg: ₹Y.Y L | Δ +Z%"`
- **Height:** 260px

---

## File Changes

| File | Change |
|---|---|
| `src/admin/components/dashboard/HistoricalTrends.js` | **Create** — component with fetch + tabs + Plotly |
| `src/utility/dashboardData.js` | **Modify** — add 3 aggregators |
| `src/utility/__tests__/dashboardData.test.js` | **Modify** — unit tests for 3 aggregators |
| `src/admin/components/dashboard/__tests__/HistoricalTrends.test.js` | **Create** — smoke render test |
| `src/admin/pages/DashboardPage.js` | **Modify** — add `<HistoricalTrends />` at bottom |

---

## Tests

**Unit (aggregators):**
- `buildFyTotals`: correct FY totals, FY2026 marked `isLive`, NULLs skipped in sum
- `buildSeasonalSeries`: 12-slot arrays, NULLs in correct positions, FY2026 from bills
- `buildVsHistoryComparison`: avg excludes NULLs, future months are null in `currentFy`

**Smoke (component):**
- Renders without crashing with empty arrays (loading state)
- Renders without crashing with mock data (all 3 tabs)

**Run:**
```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js
CI=true npm test -- --watchAll=false src/admin/components/dashboard/__tests__/HistoricalTrends.test.js
```
