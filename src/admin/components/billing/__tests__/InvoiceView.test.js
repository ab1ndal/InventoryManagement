import { render, screen, within } from "@testing-library/react";
import InvoiceView from "../InvoiceView";

const base = {
  billId: 1, billNumber: "FY26-000217", billDate: "2026-07-13",
  customerName: "Test", salespersonNames: [],
  items: [{ _id: "a", product_name: "Saree", mrp: 1000, quantity: 1, alteration_charge: 105, stitchType: "unstitched" }],
  computed: { itemsSubtotal: 1105, itemLevelDiscountTotal: 0, overallDiscount: 0, balanceDiscount: 0, preOverallTaxable: 1100, gstTotal: 0, grandTotal: 1105, voucherPreTax: 0 },
  paymentMethod: "Cash", paymentAmount: 1105, appliedCodes: [], allDiscounts: [],
};

test("bos: title, no declaration, no tax columns", () => {
  render(<InvoiceView {...base} docType="bos" />);
  expect(screen.getByText("Bill of Supply")).toBeInTheDocument();
  expect(screen.queryByText(/Composition taxable person/i)).not.toBeInTheDocument();
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

describe("WhatsApp Community QR footer", () => {
  const { QRCodeSVG } = require("qrcode.react");
  const { WHATSAPP_COMMUNITY_INVITE_URL } = require("../communityInvite");

  // Module path encodes the payload; compare against a QR built straight from the invite URL.
  const expectedModulePath = () => {
    const { container } = render(
      <QRCodeSVG value={WHATSAPP_COMMUNITY_INVITE_URL} level="M" marginSize={4} />,
    );
    // QR modules are SVG path data; no accessible query exposes them.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const d = container.querySelectorAll("path")[1].getAttribute("d");
    // eslint-disable-next-line testing-library/no-container
    container.remove();
    return d;
  };

  test.each(["invoice", "bos"])("%s: footer has QR encoding the invite URL + caption", (docType) => {
    const expected = expectedModulePath();
    render(<InvoiceView {...base} docType={docType} />);
    const block = screen.getByTestId("community-qr");
    expect(within(block).getByText(/Scan to join our WhatsApp Community/, { selector: "div" })).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access -- SVG path data, see expectedModulePath
    const paths = block.querySelectorAll("svg path");
    expect(paths).toHaveLength(2);
    expect(paths[1].getAttribute("d")).toBe(expected);
  });

  test("invite URL is the Community link", () => {
    expect(WHATSAPP_COMMUNITY_INVITE_URL).toBe("https://chat.whatsapp.com/ErIgYB8O2Cq6z8DXYG1iCg");
  });
});
