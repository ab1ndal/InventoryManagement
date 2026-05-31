import { render, screen } from "@testing-library/react";
import DashboardFilters from "../DashboardFilters";

const fyList = [
  { startYear: 2026, label: "FY 26–27" },
  { startYear: 2025, label: "FY 25–26" },
];

test("renders a tab per FY and month selects", () => {
  render(
    <DashboardFilters
      fyList={fyList}
      value={{ startYear: 2026, fromIdx: 0, toIdx: 11 }}
      onChange={() => {}}
    />
  );
  expect(screen.getByText("FY 26–27")).toBeInTheDocument();
  expect(screen.getByText("FY 25–26")).toBeInTheDocument();
  expect(screen.getByText("From: Apr")).toBeInTheDocument();
  expect(screen.getByText("To: Mar")).toBeInTheDocument();
});
