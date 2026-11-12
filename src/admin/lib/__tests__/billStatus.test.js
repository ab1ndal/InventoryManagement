import { BILL_STATUS, billStatusFields, isDraft, isCancelled, isLiveSale, onlyLiveSales } from "../billStatus";

describe("billStatusFields", () => {
  test("a draft is not finalized", () => {
    expect(billStatusFields(BILL_STATUS.DRAFT)).toEqual({ paymentstatus: "draft", finalized: false });
  });

  test.each([BILL_STATUS.PARTIAL, BILL_STATUS.FINALIZED])("%s is finalized", (status) => {
    expect(billStatusFields(status)).toEqual({ paymentstatus: status, finalized: true });
  });

  // Only bill_cancel cancels, since only it knows whether the bill was finalized.
  test.each([BILL_STATUS.CANCELLED, undefined, null, "paid", "Finalized"])("refuses %s", (status) => {
    expect(() => billStatusFields(status)).toThrow(/cannot be written directly/);
  });
});

describe("isDraft and isCancelled", () => {
  test.each([
    [{ paymentstatus: "draft", finalized: false }, true, false],
    [{ paymentstatus: "partial", finalized: true }, false, false],
    [{ paymentstatus: "finalized", finalized: true }, false, false],
    [{ paymentstatus: "cancelled", finalized: false }, false, true],
    [{ paymentstatus: "cancelled", finalized: true }, false, true],
  ])("%o", (bill, draft, cancelled) => {
    expect(isDraft(bill)).toBe(draft);
    expect(isCancelled(bill)).toBe(cancelled);
  });
});

describe("isLiveSale", () => {
  test.each([
    [{ paymentstatus: "draft", finalized: false }, false],
    [{ paymentstatus: "partial", finalized: true }, true],
    [{ paymentstatus: "finalized", finalized: true }, true],
    // Cancelling keeps finalized and the amounts, so finalized alone would count these.
    [{ paymentstatus: "cancelled", finalized: true }, false],
    [{ paymentstatus: "cancelled", finalized: false }, false],
    [{ paymentstatus: null, finalized: true }, true],
    [{ paymentstatus: null, finalized: false }, false],
  ])("%o", (bill, live) => {
    expect(isLiveSale(bill)).toBe(live);
  });
});

describe("onlyLiveSales", () => {
  // Evaluates the filters the way PostgREST does, including SQL NULL comparisons.
  const sqlEq = (a, b) => (a == null || b == null ? null : String(a) === String(b));
  const parseOr = (expr) =>
    expr.split(",").map((part) => {
      const [col, op, val] = part.split(".");
      return (row) =>
        op === "is" ? (val === "null" ? row[col] == null : null)
        : op === "neq" ? (sqlEq(row[col], val) === null ? null : !sqlEq(row[col], val))
        : sqlEq(row[col], val);
    });
  const runOn = (rows) => {
    const preds = [];
    const builder = {
      eq: (col, val) => { preds.push((r) => sqlEq(r[col], val)); return builder; },
      or: (expr) => { const ps = parseOr(expr); preds.push((r) => ps.some((p) => p(r) === true)); return builder; },
    };
    expect(onlyLiveSales(builder)).toBe(builder);
    return rows.filter((r) => preds.every((p) => p(r) === true));
  };

  test("keeps exactly the bills isLiveSale keeps", () => {
    const rows = [
      { billid: 1, paymentstatus: "draft", finalized: false },
      { billid: 2, paymentstatus: "partial", finalized: true },
      { billid: 3, paymentstatus: "finalized", finalized: true },
      { billid: 4, paymentstatus: "cancelled", finalized: true },
      { billid: 5, paymentstatus: "cancelled", finalized: false },
      { billid: 6, paymentstatus: null, finalized: true },
    ];
    const kept = runOn(rows).map((r) => r.billid);
    expect(kept).toEqual([2, 3, 6]);
    expect(kept).toEqual(rows.filter(isLiveSale).map((r) => r.billid));
  });
});
