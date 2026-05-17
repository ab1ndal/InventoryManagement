import { formatINR } from "../formatCurrency";

describe("formatINR", () => {
  it("formats whole rupee amounts with Indian grouping", () => {
    expect(formatINR(1000)).toBe("₹1,000");
    expect(formatINR(100000)).toBe("₹1,00,000");
    expect(formatINR(1500000)).toBe("₹15,00,000");
  });

  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0");
  });

  it("handles null and undefined as zero", () => {
    expect(formatINR(null)).toBe("₹0");
    expect(formatINR(undefined)).toBe("₹0");
  });

  it("handles NaN as zero", () => {
    expect(formatINR(NaN)).toBe("₹0");
  });

  it("formats with 2 decimal places when decimals=2", () => {
    expect(formatINR(1000, 2)).toBe("₹1,000.00");
    expect(formatINR(1000.5, 2)).toBe("₹1,000.50");
    expect(formatINR(100000, 2)).toBe("₹1,00,000.00");
  });

  it("rounds to specified decimal places", () => {
    expect(formatINR(999.999, 2)).toBe("₹1,000.00");
    expect(formatINR(1.005, 2)).toBe("₹1.01");
  });

  it("formats string numbers", () => {
    expect(formatINR("2500")).toBe("₹2,500");
    expect(formatINR("2500.00", 2)).toBe("₹2,500.00");
  });
});
