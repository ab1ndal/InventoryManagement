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
