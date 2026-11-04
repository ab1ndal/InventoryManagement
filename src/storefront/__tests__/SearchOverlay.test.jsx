import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SearchOverlay from "../components/SearchOverlay";

const mockUseProductSearch = jest.fn();
jest.mock("../hooks/useProductSearch", () => ({
  useProductSearch: (query) => mockUseProductSearch(query),
}));

const results = (n) =>
  Array.from({ length: n }, (_, i) => ({ productid: `BC${i}`, name: `Saree ${i}`, retailprice: 1000 }));

function open() {
  render(
    <MemoryRouter>
      <SearchOverlay open onClose={() => {}} />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByPlaceholderText(/search sarees/i), { target: { value: "saree" } });
}

describe("SearchOverlay", () => {
  it("says it is showing the first few of a larger total", () => {
    mockUseProductSearch.mockReturnValue({ results: results(20), total: 89, loading: false });
    open();
    expect(screen.getByText("First 20 of 89")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /see all 89 results for “saree”/i })).toBeInTheDocument();
  });

  it("says nothing extra when every match is listed", () => {
    mockUseProductSearch.mockReturnValue({ results: results(3), total: 3, loading: false });
    open();
    expect(screen.queryByText(/^First/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /see all 3 results/i })).toBeInTheDocument();
  });
});
