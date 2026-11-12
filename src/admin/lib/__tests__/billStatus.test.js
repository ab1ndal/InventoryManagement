import { BILL_STATUS, billStatusFields, isDraft, isCancelled } from "../billStatus";

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
