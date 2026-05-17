import { formatStock } from "../formatStock";

describe("formatStock", () => {
  it("formats piece count with Indian grouping", () => {
    expect(formatStock(10)).toBe("10 pcs");
    expect(formatStock(1000)).toBe("1,000 pcs");
  });

  it("formats meter with up to 3 decimals", () => {
    expect(formatStock(5.5, "meter")).toBe("5.5 m");
    expect(formatStock(1000.125, "meter")).toBe("1,000.125 m");
  });

  it("returns zero sentinel for NaN", () => {
    expect(formatStock(NaN)).toBe("0 pcs");
    expect(formatStock(NaN, "meter")).toBe("0 m");
  });

  it("defaults to piece type", () => {
    expect(formatStock(3)).toBe("3 pcs");
  });

  it("strips trailing zeros for meters", () => {
    expect(formatStock(5.0, "meter")).toBe("5 m");
  });
});
