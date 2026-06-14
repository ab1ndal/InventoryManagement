import { computeLineAmount, computeTaxableAmount, computeBillTotal } from "../supplierBillCalc";

describe("computeLineAmount", () => {
  test("applies percentage discount to qty * unit_price", () => {
    expect(computeLineAmount({ qty: 3, unit_price: 2675, discount_pct: 10 })).toBe(7222.5);
  });

  test("defaults discount_pct to 0 when missing", () => {
    expect(computeLineAmount({ qty: 2, unit_price: 100 })).toBe(200);
  });

  test("treats empty/blank inputs as 0", () => {
    expect(computeLineAmount({ qty: "", unit_price: "", discount_pct: "" })).toBe(0);
  });
});

describe("computeTaxableAmount", () => {
  test("sums line item amounts from the sample invoice", () => {
    const lineItems = [
      { amount: 7222.5 },
      { amount: 7411.5 },
      { amount: 4662 },
      { amount: 2682 },
      { amount: 2565 },
    ];
    expect(computeTaxableAmount(lineItems)).toBe(24543);
  });

  test("returns 0 for an empty list", () => {
    expect(computeTaxableAmount([])).toBe(0);
  });
});

describe("computeBillTotal", () => {
  test("matches the sample invoice total with IGST and negative round-off", () => {
    expect(
      computeBillTotal({
        taxable_amount: 24543,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 1227.16,
        round_off_amount: -0.16,
      })
    ).toBe(25770);
  });

  test("treats missing tax/round-off fields as 0", () => {
    expect(computeBillTotal({ taxable_amount: 100 })).toBe(100);
  });
});
