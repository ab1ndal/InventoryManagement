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
  buildSeasonalSeries,
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
    expect(prior.end).toEqual(new Date(2025, 8, 1));
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
