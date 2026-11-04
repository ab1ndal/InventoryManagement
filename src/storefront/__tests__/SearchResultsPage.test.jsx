import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SearchResultsPage from "../pages/SearchResultsPage";

const mockUseProductSearch = jest.fn();
jest.mock("../hooks/useProductSearch", () => ({
  SEARCH_PAGE_SIZE: 20,
  useProductSearch: (query, limit) => mockUseProductSearch(query, limit),
}));
jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));


describe("SearchResultsPage", () => {
  beforeEach(() => {
    mockUseProductSearch.mockReturnValue({ results: [], total: 0, loading: false });
  });

  const twenty = Array.from({ length: 20 }, (_, i) => ({ productid: `BC${i}`, name: `Saree ${i}`, retailprice: 1000 }));

  it("gives the real total, not the number on screen, and shows more on request", () => {
    mockUseProductSearch.mockReturnValue({ results: twenty, total: 89, loading: false });
    render(
      <MemoryRouter initialEntries={["/search?q=saree"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getByText("89 results")).toBeInTheDocument();
    expect(screen.queryByText("20 results")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 20 of 89")).toBeInTheDocument();
    expect(mockUseProductSearch).toHaveBeenLastCalledWith("saree", 20);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(mockUseProductSearch).toHaveBeenLastCalledWith("saree", 40);
  });

  it("keeps the shown results on screen while more load", () => {
    mockUseProductSearch.mockReturnValue({ results: twenty, total: 89, loading: true });
    render(
      <MemoryRouter initialEntries={["/search?q=saree"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getAllByTestId("product-card")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("offers no more when everything is shown", () => {
    mockUseProductSearch.mockReturnValue({ results: twenty, total: 20, loading: false });
    render(
      <MemoryRouter initialEntries={["/search?q=saree"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getByText("20 results")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("shows the heading with query, result count, and product cards", () => {
    mockUseProductSearch.mockReturnValue({
      results: [
        { productid: "BC1", name: "Silk Saree", retailprice: 1000 },
        { productid: "BC2", name: "Cotton Saree", retailprice: 800 },
      ],
      total: 2,
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
    mockUseProductSearch.mockReturnValue({ results: [], total: 0, loading: false });
    render(
      <MemoryRouter initialEntries={["/search?q=zzz"]}>
        <SearchResultsPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/no products match/i)).toBeInTheDocument();
  });
});
