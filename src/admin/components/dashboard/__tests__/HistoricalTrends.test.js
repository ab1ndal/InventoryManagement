import React from "react";
import { render, screen } from "@testing-library/react";
import HistoricalTrends from "../HistoricalTrends";

// Supabase mock — supports direct await and .range() for paginated fetch
const createMockQuery = (data = []) => {
  const q = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    range: () => Promise.resolve({ data, error: null }),
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
    catch: (rej) => Promise.resolve({ data, error: null }).catch(rej),
  };
  return q;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: { from: () => createMockQuery() },
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

jest.mock("react-plotly.js/factory", () => () => () => <div data-testid="plotly-chart" />);
jest.mock("plotly.js-basic-dist-min", () => ({}));

describe("HistoricalTrends", () => {
  it("renders loading state on initial mount", () => {
    render(<HistoricalTrends />);
    expect(screen.getByText(/loading historical trends/i)).toBeInTheDocument();
  });
});
