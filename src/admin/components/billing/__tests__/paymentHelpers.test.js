import { sumPayments, tallyPayment, storeCreditDeductionDelta } from "../paymentHelpers";

describe("storeCreditDeductionDelta", () => {
  test("deducts the full amount when the balance covers it", () => {
    expect(storeCreditDeductionDelta(500, 300)).toBe(-300);
  });
  test("floors the balance at 0 like the old Math.max(0, balance - amount) write", () => {
    expect(storeCreditDeductionDelta(200, 300)).toBe(-200);
    expect(storeCreditDeductionDelta(0, 300)).toBe(0);
  });
  test("a negative deduction adds credit back", () => {
    expect(storeCreditDeductionDelta(100, -50)).toBe(50);
  });
  test("has no float noise", () => {
    expect(storeCreditDeductionDelta(100.1, 50.05)).toBe(-50.05);
  });
});

describe("sumPayments", () => {
  test("empty or missing rows total zero", () => {
    expect(sumPayments([])).toBe(0);
    expect(sumPayments(null)).toBe(0);
  });

  test("sums string amounts as they come back from Supabase", () => {
    expect(sumPayments([{ amount: "3000.00" }, { amount: "3500.00" }])).toBe(6500);
  });
});

describe("tallyPayment", () => {
  test("first payment short of the total leaves the bill partial", () => {
    const t = tallyPayment([], 3000, 6500);
    expect(t).toEqual({
      totalPaid: 3000,
      remaining: 3500,
      isFullyPaid: false,
      paymentStatus: "partial",
    });
  });

  test("the payment that closes the balance finalizes the bill", () => {
    // FY26-000267: 3000 on Aug 12, then 3500 on Aug 20
    const t = tallyPayment([{ amount: 3000 }], 3500, 6500);
    expect(t).toEqual({
      totalPaid: 6500,
      remaining: 0,
      isFullyPaid: true,
      paymentStatus: "finalized",
    });
  });

  test("overpayment finalizes and never reports negative remaining", () => {
    const t = tallyPayment([{ amount: 6000 }], 1000, 6500);
    expect(t.totalPaid).toBe(7000);
    expect(t.remaining).toBe(0);
    expect(t.isFullyPaid).toBe(true);
  });

  test("running total accumulates across three installments", () => {
    const paid = [{ amount: 1000 }, { amount: 2000 }];
    expect(tallyPayment(paid, 500, 6500).totalPaid).toBe(3500);
  });

  test("paisa amounts do not drift the total", () => {
    const t = tallyPayment([{ amount: 1000.1 }, { amount: 2000.2 }], 3499.7, 6500);
    expect(t.totalPaid).toBe(6500);
    expect(t.isFullyPaid).toBe(true);
  });
});
