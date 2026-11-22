import { manualStockTake } from "../stockHelpers";

describe("manualStockTake", () => {
  it("takes each manual item's exact quantity, lines summed, and skips inventory lines", () => {
    expect(
      manualStockTake([
        { source: "inventory", variantid: "v1", productid: "BC25001", quantity: 2 },
        { source: "manual", productid: "BCX26001", quantity: 3.5 },
        { source: "manual", productid: "BCX26002", quantity: 1 },
        { source: "manual", productid: "BCX26001", quantity: 0.25 },
      ]),
    ).toEqual([
      ["BCX26001", -3.75],
      ["BCX26002", -1],
    ]);
  });

  it("keeps metre sums to 3 places, as the stock column", () => {
    expect(manualStockTake([
      { source: "manual", productid: "BCX26001", quantity: 0.1 },
      { source: "manual", productid: "BCX26001", quantity: 0.2 },
    ])).toEqual([["BCX26001", -0.3]]);
  });

  it("is empty with no manual lines", () => {
    expect(manualStockTake([{ source: "inventory", variantid: "v1", productid: "BC25001", quantity: 1 }])).toEqual([]);
  });
});
