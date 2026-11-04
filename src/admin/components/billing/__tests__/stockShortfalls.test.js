import { render, screen } from "@testing-library/react";
import { describeStockShortfalls } from "../stockHelpers";
import PaymentHistory from "../PaymentHistory";

const stock = { v1: { stock: 5, size: "M", color: "Red" } };

test("two lines of one variant are judged on their total", () => {
  const items = [
    { variantid: "v1", product_name: "Kurti", quantity: 4 },
    { variantid: "v1", product_name: "Kurti", quantity: 4 },
  ];
  expect(describeStockShortfalls(items, stock)).toBe("Kurti (M/Red): requested 8, available 5");
});

test("lines that fit together pass, and quantities typed as text still add up", () => {
  const items = [
    { variantid: "v1", product_name: "Kurti", quantity: "2" },
    { variantid: "v1", product_name: "Kurti", quantity: 3 },
  ];
  expect(describeStockShortfalls(items, stock)).toBeNull();
});

test("an unknown variant has no stock", () => {
  const items = [{ variantid: "gone", product_name: "Saree", quantity: 1 }];
  expect(describeStockShortfalls(items, stock)).toBe("Saree (/): requested 1, available 0");
});

test("a payment shows the date it was entered for, in any browser time zone", () => {
  render(
    <PaymentHistory
      payments={[{ payment_id: 1, amount: 100, recorded_at: "2026-10-20T12:00:00" }]}
      netAmount={100}
    />,
  );
  expect(screen.getByText("20/10/2026")).toBeInTheDocument();
});
