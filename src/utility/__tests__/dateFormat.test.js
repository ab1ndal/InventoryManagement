import { formatDateTimeIST, todayIST } from "../dateFormat";

describe("todayIST", () => {
  test("is the next day in India while UTC is still on the previous day", () => {
    // 20:00 UTC on 1 Nov == 01:30 IST on 2 Nov
    expect(todayIST(new Date("2026-11-01T20:00:00Z"))).toBe("2026-11-02");
  });
  test("stays on the same day before midnight IST", () => {
    // 18:29 UTC == 23:59 IST
    expect(todayIST(new Date("2026-11-01T18:29:00Z"))).toBe("2026-11-01");
  });
});

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
