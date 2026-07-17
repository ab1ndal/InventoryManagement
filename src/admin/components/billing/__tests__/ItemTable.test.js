import { render, screen } from "@testing-library/react";
import ItemTable from "../ItemTable";

const items = [
  { _id: "a", productid: "BC25001", product_name: "Saree", mrp: 1000, quantity: 1, alteration_charge: 0, gstRate: 18 },
];

const noop = () => {};

test("bos: hides GST% and GST Amt columns", () => {
  render(<ItemTable items={items} setItems={noop} docType="bos" />);
  expect(screen.queryByText("GST%")).not.toBeInTheDocument();
  expect(screen.queryByText("GST Amt")).not.toBeInTheDocument();
  // non-tax columns still present
  expect(screen.getByText("Subtotal")).toBeInTheDocument();
  expect(screen.getByText("Total")).toBeInTheDocument();
});

test("invoice: keeps GST% and GST Amt columns", () => {
  render(<ItemTable items={items} setItems={noop} docType="invoice" />);
  expect(screen.getByText("GST%")).toBeInTheDocument();
  expect(screen.getByText("GST Amt")).toBeInTheDocument();
});

test("bos: subtotal equals total when no alteration", () => {
  render(<ItemTable items={items} setItems={noop} docType="bos" />);
  expect(screen.getAllByText("₹1,000")).toHaveLength(3); // MRP, Subtotal, Total
  expect(screen.queryByText("₹1,050")).not.toBeInTheDocument();
});

test("bos: total adds full alteration charge to subtotal", () => {
  const withAlt = [{ ...items[0], alteration_charge: 105 }];
  render(<ItemTable items={withAlt} setItems={noop} docType="bos" />);
  expect(screen.getByText("₹1,105")).toBeInTheDocument();
});

test("invoice: total includes GST", () => {
  render(<ItemTable items={items} setItems={noop} docType="invoice" />);
  expect(screen.getByText("₹1,050")).toBeInTheDocument();
});

test("defaults to bos when docType omitted", () => {
  render(<ItemTable items={items} setItems={noop} />);
  expect(screen.queryByText("GST%")).not.toBeInTheDocument();
  expect(screen.queryByText("GST Amt")).not.toBeInTheDocument();
});
