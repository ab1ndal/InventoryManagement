import { render, screen } from "@testing-library/react";
import CategoryBreakdown from "../CategoryBreakdown";

const current = {
  bills: [],
  items: [
    { category: "Saree", total: 1000, cost_price: 300, quantity: 1 },
    { category: "Kurti", total: 400, cost_price: 100, quantity: 1 },
  ],
};

test("lists categories sorted by revenue with margin", () => {
  render(<CategoryBreakdown current={current} loading={false} />);
  const rows = screen.getAllByTestId("category-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Saree");
  expect(screen.getByText("₹1,000")).toBeInTheDocument();
});

test("empty state when no items", () => {
  render(<CategoryBreakdown current={{ bills: [], items: [] }} loading={false} />);
  expect(screen.getByText(/no category data/i)).toBeInTheDocument();
});
