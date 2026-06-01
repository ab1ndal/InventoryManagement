# Historical Trends Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed "Historical Trends" section to `/admin/dashboard` that stitches `monthly_sales_history` (FY2017–2025) with live `bills` (FY2026+) into 3 chart views: FY Trend, Seasonality, vs History.

**Architecture:** Self-contained `HistoricalTrends` component fetches its own data on mount (no props, no changes to existing DashboardPage fetch). Three pure aggregators added to `dashboardData.js`. TDD throughout — tests written before implementation.

**Tech Stack:** React 19 (CRA), `@supabase/supabase-js`, Plotly (`react-plotly.js/factory` + `plotly.js-basic-dist-min`), Shadcn `<Tabs>` (`src/components/ui/tabs.tsx`), Tailwind, Jest + React Testing Library.

---

## Prerequisite: Apply migration

`schema/migration_monthly_sales_history.sql` must be applied to Supabase before Tasks 1–5. Verify:

```bash
source .env && curl -s \
  -H "apikey: $REACT_APP_SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $REACT_APP_SUPABASE_SERVICE_ROLE_KEY" \
  "$REACT_APP_SUPABASE_URL/rest/v1/monthly_sales_history?limit=1" | head -c 100
```

If the response is `[]` or a JSON array → table exists, proceed.
If `{"code":"42P01",...}` → open Supabase SQL editor, paste and run `schema/migration_monthly_sales_history.sql`, then proceed.

---

## File Map

| File | Change |
|---|---|
| `src/utility/dashboardData.js` | Add 3 pure aggregators at bottom |
| `src/utility/__tests__/dashboardData.test.js` | Add imports + 3 describe blocks at bottom |
| `src/admin/components/dashboard/HistoricalTrends.js` | Create — fetch + tabs + 3 Plotly charts |
| `src/admin/components/dashboard/__tests__/HistoricalTrends.test.js` | Create — smoke render test |
| `src/admin/pages/DashboardPage.js` | Add `<HistoricalTrends />` at bottom |

---

## Task 1: `buildFyTotals` — TDD

**Files:**
- Modify: `src/utility/__tests__/dashboardData.test.js`
- Modify: `src/utility/dashboardData.js`

- [ ] **Step 1: Add failing test**

Append to the import line in `src/utility/__tests__/dashboardData.test.js` — add `buildFyTotals` to the existing import:

```js
import {
  FY_MONTHS,
  getFinancialYearStart,
  monthRangeWithinFy,
  priorYearRange,
  buildFyList,
  fyLabel,
  aggregateKpis,
  pctChange,
  badgeFor,
  aggregateMonthlySeries,
  aggregateCategories,
  aggregateSalespersons,
  aggregateDiscounts,
  buildFyTotals,
} from "../dashboardData";
```

Then append at the bottom of the test file:

```js
// ── shared fixtures for history aggregator tests ──────────────────────────────
const HIST_ROWS = [
  { fy_start_year: 2022, month_idx: 0, net_amount: 100000 },
  { fy_start_year: 2022, month_idx: 1, net_amount: 200000 },
  { fy_start_year: 2022, month_idx: 2, net_amount: null },   // NULL month
  { fy_start_year: 2023, month_idx: 0, net_amount: 150000 },
];
const FY2026_BILLS = [
  { net_amount: 300000, orderdate: "2026-04-15T10:00:00" }, // month_idx 0
  { net_amount: 250000, orderdate: "2026-05-20T10:00:00" }, // month_idx 1
];

describe("buildFyTotals", () => {
  it("sums net_amount per FY, skips NULLs in sum", () => {
    const result = buildFyTotals(HIST_ROWS, FY2026_BILLS);
    const fy22 = result.find((r) => r.label === fyLabel(2022));
    expect(fy22.total).toBe(300000); // 100k + 200k (null skipped)
    expect(fy22.isLive).toBe(false);
  });

  it("returns null total when every month in FY is NULL", () => {
    const rows = [
      { fy_start_year: 2020, month_idx: 0, net_amount: null },
      { fy_start_year: 2020, month_idx: 1, net_amount: null },
    ];
    const result = buildFyTotals(rows, []);
    expect(result.find((r) => r.label === fyLabel(2020)).total).toBeNull();
  });

  it("includes FY2026 from bills marked isLive", () => {
    const result = buildFyTotals(HIST_ROWS, FY2026_BILLS);
    const fy26 = result.find((r) => r.label === fyLabel(2026));
    expect(fy26.total).toBe(550000); // 300k + 250k
    expect(fy26.isLive).toBe(true);
  });

  it("returns results sorted by FY ascending", () => {
    const result = buildFyTotals(HIST_ROWS, FY2026_BILLS);
    const labels = result.map((r) => r.label);
    expect(labels[0]).toBe(fyLabel(2022));
    expect(labels[labels.length - 1]).toBe(fyLabel(2026));
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js 2>&1 | tail -20
```

Expected: `SyntaxError` or `buildFyTotals is not a function`.

- [ ] **Step 3: Implement `buildFyTotals`**

Append to the bottom of `src/utility/dashboardData.js`:

```js
export function buildFyTotals(histRows, fy2026Bills) {
  const byFy = {};
  for (const { fy_start_year, net_amount } of histRows) {
    if (!byFy[fy_start_year]) byFy[fy_start_year] = [];
    byFy[fy_start_year].push(net_amount);
  }

  const result = Object.entries(byFy).map(([fy, amounts]) => {
    const fyNum = Number(fy);
    const valid = amounts.filter((a) => a !== null);
    return {
      label: fyLabel(fyNum),
      total: valid.length > 0 ? valid.reduce((s, a) => s + a, 0) : null,
      isLive: false,
      _fy: fyNum,
    };
  });

  const fy2026Total = fy2026Bills.reduce((s, b) => s + (b.net_amount ?? 0), 0);
  result.push({ label: fyLabel(2026), total: fy2026Total, isLive: true, _fy: 2026 });

  result.sort((a, b) => a._fy - b._fy);
  result.forEach((r) => delete r._fy);
  return result;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js 2>&1 | grep -E "PASS|FAIL|buildFyTotals"
```

Expected: `PASS` with all `buildFyTotals` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): buildFyTotals aggregator with tests"
```

---

## Task 2: `buildSeasonalSeries` — TDD

**Files:**
- Modify: `src/utility/__tests__/dashboardData.test.js`
- Modify: `src/utility/dashboardData.js`

- [ ] **Step 1: Add import + failing test**

Add `buildSeasonalSeries` to the import in `src/utility/__tests__/dashboardData.test.js`:

```js
import {
  // ... existing imports ...
  buildFyTotals,
  buildSeasonalSeries,
} from "../dashboardData";
```

Append at the bottom of the test file:

```js
describe("buildSeasonalSeries", () => {
  it("returns one entry per FY with 12-slot values array", () => {
    const result = buildSeasonalSeries(HIST_ROWS, FY2026_BILLS);
    const fy22 = result.find((r) => r.label === fyLabel(2022));
    expect(fy22.values).toHaveLength(12);
    expect(fy22.values[0]).toBe(100000);  // month_idx 0
    expect(fy22.values[1]).toBe(200000);  // month_idx 1
    expect(fy22.values[2]).toBeNull();    // explicit NULL
    expect(fy22.values[3]).toBeNull();    // no row → null
  });

  it("places FY2026 bills in correct month_idx slots", () => {
    const result = buildSeasonalSeries(HIST_ROWS, FY2026_BILLS);
    const fy26 = result.find((r) => r.label === fyLabel(2026));
    expect(fy26.values[0]).toBe(300000); // Apr 2026
    expect(fy26.values[1]).toBe(250000); // May 2026
    expect(fy26.values[2]).toBeNull();   // Jun — no bills
  });

  it("aggregates multiple bills in same month", () => {
    const bills = [
      { net_amount: 100000, orderdate: "2026-04-01T00:00:00" },
      { net_amount: 50000,  orderdate: "2026-04-28T00:00:00" },
    ];
    const result = buildSeasonalSeries([], bills);
    const fy26 = result.find((r) => r.label === fyLabel(2026));
    expect(fy26.values[0]).toBe(150000);
  });

  it("sorts results by FY ascending, FY2026 last", () => {
    const result = buildSeasonalSeries(HIST_ROWS, FY2026_BILLS);
    const labels = result.map((r) => r.label);
    expect(labels[0]).toBe(fyLabel(2022));
    expect(labels[labels.length - 1]).toBe(fyLabel(2026));
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js 2>&1 | tail -10
```

Expected: `buildSeasonalSeries is not a function`.

- [ ] **Step 3: Implement `buildSeasonalSeries`**

Append to the bottom of `src/utility/dashboardData.js` (after `buildFyTotals`):

```js
export function buildSeasonalSeries(histRows, fy2026Bills) {
  const byFy = {};
  for (const { fy_start_year, month_idx, net_amount } of histRows) {
    if (!byFy[fy_start_year]) byFy[fy_start_year] = new Array(12).fill(null);
    byFy[fy_start_year][month_idx] = net_amount; // null stays null
  }

  const result = Object.entries(byFy)
    .map(([fy, values]) => ({ label: fyLabel(Number(fy)), values, _fy: Number(fy) }))
    .sort((a, b) => a._fy - b._fy);

  const fy2026Values = new Array(12).fill(null);
  for (const { net_amount, orderdate } of fy2026Bills) {
    const idx = (new Date(orderdate).getMonth() - 3 + 12) % 12;
    fy2026Values[idx] = (fy2026Values[idx] ?? 0) + net_amount;
  }
  result.push({ label: fyLabel(2026), values: fy2026Values, _fy: 2026 });

  return result.map(({ _fy, ...rest }) => rest);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js 2>&1 | grep -E "PASS|FAIL|buildSeasonalSeries"
```

Expected: `PASS` with all `buildSeasonalSeries` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): buildSeasonalSeries aggregator with tests"
```

---

## Task 3: `buildVsHistoryComparison` — TDD

**Files:**
- Modify: `src/utility/__tests__/dashboardData.test.js`
- Modify: `src/utility/dashboardData.js`

- [ ] **Step 1: Add import + failing test**

Add `buildVsHistoryComparison` to the import in `src/utility/__tests__/dashboardData.test.js`:

```js
import {
  // ... existing imports ...
  buildFyTotals,
  buildSeasonalSeries,
  buildVsHistoryComparison,
} from "../dashboardData";
```

Append at the bottom of the test file:

```js
describe("buildVsHistoryComparison", () => {
  it("returns months, currentFy, historicalAvg each with length 12", () => {
    const result = buildVsHistoryComparison(HIST_ROWS, FY2026_BILLS);
    expect(result.months).toHaveLength(12);
    expect(result.currentFy).toHaveLength(12);
    expect(result.historicalAvg).toHaveLength(12);
  });

  it("months[0] is Apr, months[11] is Mar", () => {
    const { months } = buildVsHistoryComparison(HIST_ROWS, FY2026_BILLS);
    expect(months[0]).toBe("Apr");
    expect(months[11]).toBe("Mar");
  });

  it("historicalAvg averages non-NULL values across FYs per month_idx", () => {
    // month_idx 0: FY2022=100000, FY2023=150000 → avg 125000
    const { historicalAvg } = buildVsHistoryComparison(HIST_ROWS, FY2026_BILLS);
    expect(historicalAvg[0]).toBe(125000);
  });

  it("historicalAvg is null when all values for that month are NULL", () => {
    // month_idx 2: only FY2022 row present, net_amount=null → no valid values
    const { historicalAvg } = buildVsHistoryComparison(HIST_ROWS, FY2026_BILLS);
    expect(historicalAvg[2]).toBeNull();
  });

  it("currentFy has FY2026 actuals from bills, null for months with no bills", () => {
    const { currentFy } = buildVsHistoryComparison(HIST_ROWS, FY2026_BILLS);
    expect(currentFy[0]).toBe(300000); // Apr 2026
    expect(currentFy[1]).toBe(250000); // May 2026
    expect(currentFy[2]).toBeNull();   // Jun — no bills
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js 2>&1 | tail -10
```

Expected: `buildVsHistoryComparison is not a function`.

- [ ] **Step 3: Implement `buildVsHistoryComparison`**

Append to the bottom of `src/utility/dashboardData.js` (after `buildSeasonalSeries`):

```js
export function buildVsHistoryComparison(histRows, fy2026Bills) {
  const months = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

  const buckets = Array.from({ length: 12 }, () => []);
  for (const { month_idx, net_amount } of histRows) {
    if (net_amount !== null) buckets[month_idx].push(net_amount);
  }
  const historicalAvg = buckets.map((vals) =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  );

  const currentFy = new Array(12).fill(null);
  for (const { net_amount, orderdate } of fy2026Bills) {
    const idx = (new Date(orderdate).getMonth() - 3 + 12) % 12;
    currentFy[idx] = (currentFy[idx] ?? 0) + net_amount;
  }

  return { months, currentFy, historicalAvg };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
CI=true npm test -- --watchAll=false src/utility/__tests__/dashboardData.test.js 2>&1 | grep -E "PASS|FAIL|buildVsHistoryComparison"
```

Expected: `PASS` — all suites in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/utility/dashboardData.js src/utility/__tests__/dashboardData.test.js
git commit -m "feat(dashboard): buildVsHistoryComparison aggregator with tests"
```

---

## Task 4: `HistoricalTrends` component + smoke test

**Files:**
- Create: `src/admin/components/dashboard/__tests__/HistoricalTrends.test.js`
- Create: `src/admin/components/dashboard/HistoricalTrends.js`

- [ ] **Step 1: Write smoke test (will FAIL — component doesn't exist yet)**

Create `src/admin/components/dashboard/__tests__/HistoricalTrends.test.js`:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import HistoricalTrends from "../HistoricalTrends";

// Supabase mock — supports direct await and .range() for paginated fetch
const createMockQuery = (data = []) => {
  const q = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    range: () => Promise.resolve({ data, error: null }),
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
    catch: (rej) => Promise.resolve({ data, error: null }).catch(rej),
  };
  return q;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: { from: () => createMockQuery() },
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

jest.mock("react-plotly.js/factory", () => () => () => <div data-testid="plotly-chart" />);
jest.mock("plotly.js-basic-dist-min", () => ({}));

describe("HistoricalTrends", () => {
  it("renders loading state on initial mount", () => {
    render(<HistoricalTrends />);
    expect(screen.getByText(/loading historical trends/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
CI=true npm test -- --watchAll=false "src/admin/components/dashboard/__tests__/HistoricalTrends.test.js" 2>&1 | tail -10
```

Expected: `Cannot find module '../HistoricalTrends'`.

- [ ] **Step 3: Create `HistoricalTrends.js`**

Create `src/admin/components/dashboard/HistoricalTrends.js`:

```jsx
import React, { useEffect, useMemo, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "../../../lib/supabaseClient";
import { toast } from "sonner";
import {
  buildFyTotals,
  buildSeasonalSeries,
  buildVsHistoryComparison,
  fyLabel,
} from "../../../utility/dashboardData";

const Plot = createPlotlyComponent(Plotly);
const toLakhs = (v) => v / 100000;
const PAGE = 1000;
const MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

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

const BASE_LAYOUT = {
  height: 260,
  margin: { t: 10, r: 20, b: 30, l: 44 },
  yaxis: { title: "₹ (lakhs)", zeroline: true },
  xaxis: { fixedrange: true },
  legend: { orientation: "h", y: 1.15 },
  paper_bgcolor: "white",
  plot_bgcolor: "white",
};

export default function HistoricalTrends() {
  const [tab, setTab] = useState("trend");
  const [histRows, setHistRows] = useState([]);
  const [fy2026Bills, setFy2026Bills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [histRes, billsData] = await Promise.all([
          supabase.from("monthly_sales_history").select("fy_start_year, month_idx, net_amount"),
          fetchAllRows(() =>
            supabase
              .from("bills")
              .select("net_amount, orderdate")
              .eq("finalized", true)
              .gte("orderdate", "2026-04-01T00:00:00")
          ),
        ]);
        if (histRes.error) throw histRes.error;
        setHistRows(histRes.data || []);
        setFy2026Bills(billsData);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load historical data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fyTotals = useMemo(
    () => buildFyTotals(histRows, fy2026Bills),
    [histRows, fy2026Bills]
  );
  const seasonalSeries = useMemo(
    () => buildSeasonalSeries(histRows, fy2026Bills),
    [histRows, fy2026Bills]
  );
  const vsHistory = useMemo(
    () => buildVsHistoryComparison(histRows, fy2026Bills),
    [histRows, fy2026Bills]
  );

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">
        Loading historical trends…
      </div>
    );
  }

  const histFys = fyTotals.filter((f) => !f.isLive);
  const liveFy = fyTotals.filter((f) => f.isLive);

  const trendData = [
    {
      type: "bar",
      name: "Historical FYs",
      x: histFys.map((f) => f.label),
      y: histFys.map((f) => (f.total !== null ? toLakhs(f.total) : null)),
      marker: { color: "#93c5fd" },
    },
    {
      type: "bar",
      name: "FY 26-27 (YTD)",
      x: liveFy.map((f) => f.label),
      y: liveFy.map((f) => (f.total !== null ? toLakhs(f.total) : null)),
      marker: { color: "#0066cc", opacity: 0.75 },
    },
  ];

  const seasonalData = seasonalSeries.map((s) => {
    const isCurrentFy = s.label === fyLabel(2026);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: s.label,
      x: MONTH_LABELS,
      y: s.values.map((v) => (v !== null ? toLakhs(v) : null)),
      connectgaps: false,
      line: { color: isCurrentFy ? "#0066cc" : "#d1d5db", width: isCurrentFy ? 2.5 : 1 },
      marker: { color: isCurrentFy ? "#0066cc" : "#d1d5db", size: isCurrentFy ? 5 : 3 },
      opacity: isCurrentFy ? 1 : 0.6,
    };
  });

  const vsData = [
    {
      type: "bar",
      name: "FY26 Actual",
      x: MONTH_LABELS,
      y: vsHistory.currentFy.map((v) => (v !== null ? toLakhs(v) : null)),
      marker: { color: "#0066cc" },
    },
    {
      type: "scatter",
      mode: "lines",
      name: "Historical Avg",
      x: MONTH_LABELS,
      y: vsHistory.historicalAvg.map((v) => (v !== null ? toLakhs(v) : null)),
      line: { color: "#f59e0b", dash: "dash", width: 2 },
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Historical Trends</h3>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="trend">FY Trend</TabsTrigger>
          <TabsTrigger value="seasonal">Seasonality</TabsTrigger>
          <TabsTrigger value="vs-history">vs History</TabsTrigger>
        </TabsList>
        <TabsContent value="trend">
          <Plot
            data={trendData}
            layout={{ ...BASE_LAYOUT, barmode: "overlay" }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </TabsContent>
        <TabsContent value="seasonal">
          <Plot
            data={seasonalData}
            layout={BASE_LAYOUT}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </TabsContent>
        <TabsContent value="vs-history">
          <Plot
            data={vsData}
            layout={BASE_LAYOUT}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: Run smoke test — expect PASS**

```bash
CI=true npm test -- --watchAll=false "src/admin/components/dashboard/__tests__/HistoricalTrends.test.js" 2>&1 | grep -E "PASS|FAIL"
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/dashboard/HistoricalTrends.js src/admin/components/dashboard/__tests__/HistoricalTrends.test.js
git commit -m "feat(dashboard): HistoricalTrends component — tabbed FY Trend / Seasonality / vs History"
```

---

## Task 5: Wire into DashboardPage

**Files:**
- Modify: `src/admin/pages/DashboardPage.js`

- [ ] **Step 1: Add import**

In `src/admin/pages/DashboardPage.js`, add to the existing import block:

```js
import HistoricalTrends from "../components/dashboard/HistoricalTrends";
```

- [ ] **Step 2: Render at bottom of page**

In `DashboardPage`'s return, append `<HistoricalTrends />` after the last grid:

```jsx
      <div className="grid grid-cols-2 gap-4">
        <SalespersonTable current={current} salespersonsById={salespersonsById} loading={loading} />
        <DiscountTable current={current} loading={loading} />
      </div>

      <HistoricalTrends />
    </div>
```

- [ ] **Step 3: Start dev server and verify**

```bash
npm start
```

Open `http://localhost:3000/admin/dashboard`. Verify:
- "Historical Trends" card appears below the existing grid
- "FY Trend" tab shows bars for FY2017–FY2026
- "Seasonality" tab shows multi-line chart with FY2026 highlighted
- "vs History" tab shows FY2026 bars vs dashed avg line
- NULL months render as gaps (no bar/line segment), not zeros

- [ ] **Step 4: Commit**

```bash
git add src/admin/pages/DashboardPage.js
git commit -m "feat(dashboard): wire HistoricalTrends into DashboardPage"
```
