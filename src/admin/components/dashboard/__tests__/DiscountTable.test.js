import { render, screen } from "@testing-library/react";
import DiscountTable from "../DiscountTable";

const current = {
  bills: [{ billid: 1, applied_codes: ["X"] }, { billid: 2, applied_codes: [] }],
  items: [
    { billid: 1, discount_total: 150 },
    { billid: 2, discount_total: 50 },
  ],
};

test("shows total, code, and manual discount rows", () => {
  render(<DiscountTable current={current} loading={false} />);
  expect(screen.getByText("Total Discount")).toBeInTheDocument();
  expect(screen.getByText("Code-driven")).toBeInTheDocument();
  expect(screen.getByText("Manual")).toBeInTheDocument();
  expect(screen.getByText("₹200")).toBeInTheDocument(); // total
  expect(screen.getByText("₹150")).toBeInTheDocument(); // code
});
