import { sumPayments, tallyPayment, storeCreditDeductionDelta, isWebsiteMethod, firstPaymentMethodFields, paymentStatusAfterEdit } from "../paymentHelpers";

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

describe("isWebsiteMethod", () => {
  it("matches the online-order method by name, any case", () => {
    expect(isWebsiteMethod({ methodname: "Website" })).toBe(true);
    expect(isWebsiteMethod({ methodname: " website " })).toBe(true);
  });
  it("is false for in-store methods and missing values", () => {
    expect(isWebsiteMethod({ methodname: "UPI" })).toBe(false);
    expect(isWebsiteMethod(null)).toBe(false);
    expect(isWebsiteMethod({})).toBe(false);
  });
});

describe("firstPaymentMethodFields", () => {
  test("first payment on a bill finalized unpaid sets the bill's method", () => {
    expect(firstPaymentMethodFields([], 3)).toEqual({ salesmethodid: 3 });
  });

  test("later payments leave the bill's method alone", () => {
    expect(firstPaymentMethodFields([{ amount: 100 }], 3)).toEqual({});
  });
});

describe("paymentStatusAfterEdit", () => {
  test("a draft stays a draft", () => {
    expect(paymentStatusAfterEdit({ finalized: false, paymentStatus: "draft", payments: [], netAmount: 500 })).toBe("draft");
  });

  test("a bill paid in one go stays finalized", () => {
    expect(paymentStatusAfterEdit({ finalized: true, paymentStatus: "finalized", payments: [], netAmount: 900 })).toBe("finalized");
  });

  test("a partial bill whose payments now cover the total becomes finalized", () => {
    expect(paymentStatusAfterEdit({ finalized: true, paymentStatus: "partial", payments: [{ amount: 300 }], netAmount: 300 })).toBe("finalized");
  });

  test("a partial bill still short stays partial", () => {
    expect(paymentStatusAfterEdit({ finalized: true, paymentStatus: "partial", payments: [{ amount: 300 }], netAmount: 800 })).toBe("partial");
  });

  test("a partial bill with nothing paid yet stays partial", () => {
    expect(paymentStatusAfterEdit({ finalized: true, paymentStatus: "partial", payments: [], netAmount: 800 })).toBe("partial");
  });

  test("a bill paid in installments goes back to partial when items are added", () => {
    expect(paymentStatusAfterEdit({ finalized: true, paymentStatus: "finalized", payments: [{ amount: 300 }, { amount: 500 }], netAmount: 1200 })).toBe("partial");
  });
});

describe("paise left over from rounding", () => {
  // As on FY26-000272: ₹1500.00 received against a net of ₹1500.08.
  test("an edit does not reopen a bill short only by paise", () => {
    expect(paymentStatusAfterEdit({ finalized: true, paymentStatus: "finalized", payments: [{ amount: 1000 }, { amount: 500 }], netAmount: 1500.08 })).toBe("finalized");
  });

  test("a payment short only by paise settles the bill", () => {
    const t = tallyPayment([{ amount: 1000 }], 500, 1500.08);
    expect(t.isFullyPaid).toBe(true);
    expect(t.paymentStatus).toBe("finalized");
    expect(t.remaining).toBe(0);
  });

  test("a rupee or more short still leaves the bill partial", () => {
    expect(tallyPayment([{ amount: 1000 }], 499, 1500).paymentStatus).toBe("partial");
  });
});
