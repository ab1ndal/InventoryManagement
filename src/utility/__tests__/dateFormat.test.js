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
