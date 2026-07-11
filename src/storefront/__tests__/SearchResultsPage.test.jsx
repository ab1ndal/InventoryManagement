const mockUseProductSearch = jest.fn();
jest.mock("../hooks/useProductSearch", () => ({
  useProductSearch: (query) => mockUseProductSearch(query),
}));
jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SearchResultsPage from "../pages/SearchResultsPage";

describe("SearchResultsPage", () => {
  beforeEach(() => {
    mockUseProductSearch.mockReturnValue({ results: [], loading: false });
  });

  it("shows the heading with query, result count, and product cards", () => {
    mockUseProductSearch.mockReturnValue({
      results: [
        { productid: "BC1", name: "Silk Saree", retailprice: 1000 },
        { productid: "BC2", name: "Cotton Saree", retailprice: 800 },
      ],
      loading: false,
    });
    render(
      <MemoryRouter initialEntries={["/search?q=saree"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: /results for “saree”/i })).toBeInTheDocument();
    expect(screen.getByText(/2 results/i)).toBeInTheDocument();
    expect(screen.getAllByTestId("product-card")).toHaveLength(2);
  });

  it("shows a prompt when the query is empty", () => {
    render(
      <MemoryRouter initialEntries={["/search"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/type something to search/i)).toBeInTheDocument();
  });

  it("shows a no-results state when the search returns nothing", () => {
    mockUseProductSearch.mockReturnValue({ results: [], loading: false });
    render(
      <MemoryRouter initialEntries={["/search?q=zzz"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/no products match/i)).toBeInTheDocument();
  });
});
