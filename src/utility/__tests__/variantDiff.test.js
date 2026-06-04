import { variantChanges } from "../variantDiff";

describe("variantChanges", () => {
  it("flags a size edit (stock unchanged) — the unlogged case", () => {
    const c = variantChanges(
      { size: "S", color: "Red", stock: 5 },
      { size: "M", color: "Red", stock: 5 }
    );
    expect(c.sizeOrColorChanged).toBe(true);
    expect(c.stockChanged).toBe(false);
  });

  it("flags a color edit", () => {
    const c = variantChanges(
      { size: "S", color: "Red", stock: 5 },
      { size: "S", color: "Blue", stock: 5 }
    );
    expect(c.sizeOrColorChanged).toBe(true);
  });

  it("reports stock delta independently of size/color", () => {
    const c = variantChanges(
      { size: "S", color: "Red", stock: 5 },
      { size: "M", color: "Red", stock: 8 }
    );
    expect(c.sizeOrColorChanged).toBe(true);
    expect(c.stockChanged).toBe(true);
    expect(c.stockDelta).toBe(3);
  });

  it("no changes when identical (string vs number stock)", () => {
    const c = variantChanges(
      { size: "S", color: "Red", stock: "5" },
      { size: "S", color: "Red", stock: 5 }
    );
    expect(c.sizeOrColorChanged).toBe(false);
    expect(c.stockChanged).toBe(false);
    expect(c.stockDelta).toBe(0);
  });
});
