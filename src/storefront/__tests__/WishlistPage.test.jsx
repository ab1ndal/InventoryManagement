const mockUseWishlist = jest.fn();
jest.mock("../context/WishlistContext", () => ({
  useWishlist: () => mockUseWishlist(),
}));
jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WishlistPage from "../pages/WishlistPage";

describe("WishlistPage", () => {
  it("renders a saved item via ProductCard", () => {
    mockUseWishlist.mockReturnValue({
      items: [{ productid: "BC1", name: "Silk Saree", retailprice: 1000 }],
    });
    render(<MemoryRouter><WishlistPage /></MemoryRouter>);
    expect(screen.getByTestId("product-card")).toHaveTextContent("Silk Saree");
  });

  it("shows an empty state with a link to shop when there are no items", () => {
    mockUseWishlist.mockReturnValue({ items: [] });
    render(<MemoryRouter><WishlistPage /></MemoryRouter>);
    expect(screen.getByText(/no saved items yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /continue shopping/i })).toHaveAttribute("href", "/shop");
  });
});
