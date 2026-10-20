import { isSoldOut } from "../lib/stock";

describe("isSoldOut", () => {
  it("is true when every variant has no stock", () => {
    expect(isSoldOut([{ stock: 0 }, { stock: 0 }])).toBe(true);
  });

  it("treats negative and missing stock as none", () => {
    expect(isSoldOut([{ stock: -1 }, { stock: null }, {}])).toBe(true);
  });

  it("is false when any variant still has stock", () => {
    expect(isSoldOut([{ stock: 0 }, { stock: 1 }])).toBe(false);
  });

  it("is false without variant data, so unknown stock never hides the price", () => {
    expect(isSoldOut([])).toBe(false);
    expect(isSoldOut(undefined)).toBe(false);
    expect(isSoldOut(null)).toBe(false);
  });
});
