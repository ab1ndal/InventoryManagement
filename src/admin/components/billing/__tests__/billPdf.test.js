import { billDisplayData, savePdfPaths, withOrderContact } from "../billPdf";

describe("billDisplayData", () => {
  test("an online order's bill carries the name given at checkout, not the account's", () => {
    expect(billDisplayData({ first_name: "someone.else", last_name: null }, { contact_name: "Meera Sharma" }))
      .toEqual({ customerName: "Meera Sharma", isOnlineOrder: true });
  });

  test("a shop bill carries the customer's name", () => {
    expect(billDisplayData({ first_name: "Asha", last_name: "Rao" }, null))
      .toEqual({ customerName: "Asha Rao", isOnlineOrder: false });
  });

  test("a bill with no customer has no name", () => {
    expect(billDisplayData(null, null)).toEqual({ customerName: "", isOnlineOrder: false });
  });
});

describe("savePdfPaths", () => {
  test("new file is versioned; every older path is cleared, except the new one", () => {
    const { newPath, oldPaths } = savePdfPaths({
      billId: 407, billNumber: "FY26-000390", previousPdfUrl: "bill-FY26-000390-v1.pdf", now: 2,
    });
    expect(newPath).toBe("bill-FY26-000390-v2.pdf");
    expect(oldPaths).toEqual(["bill-FY26-000390.pdf", "bill-407.pdf", "bill-FY26-000390-v1.pdf"]);
  });

  test("a stored public URL is reduced to its path", () => {
    const { oldPaths } = savePdfPaths({
      billId: 1, billNumber: null, previousPdfUrl: "https://x/storage/v1/object/public/invoices/a%20b.pdf?t=1", now: 2,
    });
    expect(oldPaths).toContain("a b.pdf");
  });
});

describe("withOrderContact", () => {
  const account = { first_name: "someone.else", last_name: null };

  test("an online bill shows who the order is for and reaches their phone", () => {
    const bill = { billid: 1, customers: account, orders: [{ contact_name: "Meera Sharma", contact_phone: "+919000000000" }] };
    expect(withOrderContact(bill)).toMatchObject({
      customers: { first_name: "Meera Sharma", last_name: null },
      contact_phone: "+919000000000",
    });
  });

  test("a shop bill is left alone", () => {
    const bill = { billid: 2, customers: account, orders: [] };
    expect(withOrderContact(bill)).toBe(bill);
  });
});
