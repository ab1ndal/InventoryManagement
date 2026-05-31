import { render, screen } from "@testing-library/react";

// Mock the Plotly factory so we don't render a real chart in jsdom.
jest.mock("react-plotly.js/factory", () => () => (props) => (
  <div data-testid="plot" data-traces={props.data.length} />
));
jest.mock("plotly.js-basic-dist-min", () => ({}));

import RevenueChart from "../RevenueChart";

const period = (rev) => ({
  bills: [{ billid: 1, orderdate: "2026-04-10T00:00:00Z", net_amount: rev }],
  items: [{ billid: 1, total: rev, cost_price: rev * 0.4, quantity: 1 }],
});

test("renders three traces: prior bars, current bars, margin line", () => {
  render(
    <RevenueChart
      current={period(1000)}
      prior={period(800)}
      range={{ startYear: 2026, fromIdx: 0, toIdx: 11 }}
      loading={false}
    />
  );
  expect(screen.getByTestId("plot").getAttribute("data-traces")).toBe("3");
});

test("renders loading state when loading=true", () => {
  render(
    <RevenueChart
      current={period(1000)}
      prior={period(800)}
      range={{ startYear: 2026, fromIdx: 0, toIdx: 11 }}
      loading={true}
    />
  );
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});
