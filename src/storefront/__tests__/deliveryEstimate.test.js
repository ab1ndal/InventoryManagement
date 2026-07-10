import { DELIVERY_ESTIMATE, stockNote } from "../lib/deliveryEstimate";

describe("stockNote", () => {
  it("shows a limited-piece note for low stock (1-3)", () => {
    expect(stockNote(1)).toBe("Limited piece — only 1 in stock");
    expect(stockNote(3)).toBe("Limited piece — only 3 in stock");
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
