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
