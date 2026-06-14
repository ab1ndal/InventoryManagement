import { buildBillFilename } from "../billFilename";

describe("buildBillFilename", () => {
  it("builds name from date, supplier, invoice number, and extension", () => {
    const result = buildBillFilename({
      date: "2026-06-13",
      supplierName: "Acme Textiles",
      invoiceNumber: "INV-0042",
      transactionId: 99,
      ext: "PDF",
    });
    expect(result).toBe("130626_AcmeTextiles_INV-0042.pdf");
  });

  it("falls back to transaction id when invoice number is blank", () => {
    const result = buildBillFilename({
      date: "2026-06-13",
      supplierName: "Acme Textiles",
      invoiceNumber: "",
      transactionId: 99,
      ext: "jpg",
    });
    expect(result).toBe("130626_AcmeTextiles_99.jpg");
  });

  it("strips spaces and special characters from supplier name", () => {
    const result = buildBillFilename({
      date: "2026-06-13",
      supplierName: "Acme Textiles & Co.",
      invoiceNumber: "INV-0042",
      transactionId: 99,
      ext: "pdf",
    });
    expect(result).toBe("130626_AcmeTextilesCo_INV-0042.pdf");
  });
});
