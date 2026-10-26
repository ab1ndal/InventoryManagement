import { DELIVERY_ESTIMATE, stockNote } from "../lib/deliveryEstimate";

describe("stockNote", () => {
  it("calls out the last piece, and counts pieces left for 2-3", () => {
    expect(stockNote(1)).toBe("Last piece in this design");
    expect(stockNote(2)).toBe("Only 2 pieces left in this design");
    expect(stockNote(3)).toBe("Only 3 pieces left in this design");
  });
  it("shows nothing for ample stock", () => {
    expect(stockNote(4)).toBeNull();
    expect(stockNote(20)).toBeNull();
  });
  it("shows nothing for zero/invalid stock", () => {
    expect(stockNote(0)).toBeNull();
    expect(stockNote(undefined)).toBeNull();
  });
});

describe("DELIVERY_ESTIMATE", () => {
  it("states dispatch and delivery windows", () => {
    expect(DELIVERY_ESTIMATE).toBe("Dispatches in 2 days · Delivered in 5–7 days");
  });
});
