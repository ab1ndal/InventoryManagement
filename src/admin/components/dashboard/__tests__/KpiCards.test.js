import { render, screen } from "@testing-library/react";
import KpiCards from "../KpiCards";

const current = {
  bills: [{ billid: 1, net_amount: 1500 }, { billid: 2, net_amount: 500 }],
  items: [{ billid: 1, total: 2000, cost_price: 500, quantity: 1, discount_total: 100 }],
};
const prior = {
  bills: [{ billid: 9, net_amount: 1000 }],
  items: [{ billid: 9, total: 1000, cost_price: 400, quantity: 1, discount_total: 50 }],
};

test("renders six KPI cards with revenue figure", () => {
  render(<KpiCards current={current} prior={prior} loading={false} />);
  expect(screen.getByText("Revenue")).toBeInTheDocument();
  expect(screen.getByText("Gross Margin %")).toBeInTheDocument();
  expect(screen.getByText("Profit")).toBeInTheDocument();
  // revenue 2000 -> ₹2,000 (en-IN grouping)
  expect(screen.getByText("₹2,000")).toBeInTheDocument();
});

test("shows skeleton text while loading", () => {
  render(<KpiCards current={current} prior={prior} loading={true} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});
