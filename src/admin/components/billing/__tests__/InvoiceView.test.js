import { render, screen, within } from "@testing-library/react";
import InvoiceView from "../InvoiceView";

const base = {
  billId: 1, billNumber: "FY26-000217", billDate: "2026-07-13",
  customerName: "Test", salespersonNames: [],
  items: [{ _id: "a", product_name: "Saree", mrp: 1000, quantity: 1, alteration_charge: 105, stitchType: "unstitched" }],
  computed: { itemsSubtotal: 1105, itemLevelDiscountTotal: 0, overallDiscount: 0, balanceDiscount: 0, preOverallTaxable: 1100, gstTotal: 0, grandTotal: 1105, voucherPreTax: 0 },
  paymentMethod: "Cash", paymentAmount: 1105, appliedCodes: [], allDiscounts: [],
};

test("bos: title, declaration, no tax columns", () => {
  render(<InvoiceView {...base} docType="bos" />);
  expect(screen.getByText("Bill of Supply")).toBeInTheDocument();
  expect(screen.getByText(/Composition taxable person, not eligible to collect tax/i)).toBeInTheDocument();
  expect(screen.queryByText("CGST (₹)")).not.toBeInTheDocument();
  expect(screen.queryByText("Taxable (₹)")).not.toBeInTheDocument();
});

test("invoice: keeps tax columns, no declaration", () => {
  render(<InvoiceView {...base} computed={{ ...base.computed, gstTotal: 55, grandTotal: 1155 }} />);
  expect(screen.getByText("GST%")).toBeInTheDocument();
  expect(screen.getByText("Taxable (₹)")).toBeInTheDocument();
  expect(screen.getByText("CGST (₹)")).toBeInTheDocument();
  expect(screen.getByText("SGST (₹)")).toBeInTheDocument();
  expect(screen.queryByText(/Composition taxable person/i)).not.toBeInTheDocument();
});
