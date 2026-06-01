import { render, screen } from "@testing-library/react";
import SalespersonTable from "../SalespersonTable";

const current = {
  bills: [],
  items: [
    { billid: 1, salesperson_id: 10, total: 1000 },
    { billid: 2, salesperson_id: 20, total: 400 },
  ],
};

test("renders ranked rows with salesperson names", () => {
  render(<SalespersonTable current={current} salespersonsById={{ 10: "Asha", 20: "Bina" }} loading={false} />);
  expect(screen.getByText("Asha")).toBeInTheDocument();
  expect(screen.getByText("Bina")).toBeInTheDocument();
  const rows = screen.getAllByTestId("salesperson-row");
  expect(rows[0]).toHaveTextContent("Asha"); // highest revenue first
});
