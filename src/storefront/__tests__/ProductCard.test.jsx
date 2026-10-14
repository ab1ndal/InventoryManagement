jest.mock("../lib/productImage", () => ({
  getProductImagePaths: () => Promise.resolve([]),
}));
jest.mock("../context/WishlistContext", () => ({
  useWishlist: () => ({ has: () => false, toggle: jest.fn() }),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProductCard from "../components/ProductCard";

const base = {
  productid: "BC25001",
  name: "Silk-Saree",
  retailprice: 2499,
  fabric: "Silk",
  categories: { name: "Saree" },
};

function renderCard(product) {
  return render(
    <MemoryRouter>
      <ProductCard product={product} />
    </MemoryRouter>
  );
}

describe("ProductCard", () => {
  it("shows name, price and category", () => {
    renderCard(base);
    expect(screen.getByText("Silk Saree")).toBeInTheDocument();
    expect(screen.getByText("₹2,499")).toBeInTheDocument();
    expect(screen.getByText("Saree")).toBeInTheDocument();
  });

  it("shows Sold out when total stock across variants is 0", () => {
    renderCard({ ...base, productsizecolors: [{ stock: 0 }, { stock: 0 }] });
    expect(screen.getByText(/sold out/i)).toBeInTheDocument();
    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
  });

  it("shows Only N left when total stock is 3 or fewer", () => {
    renderCard({ ...base, productsizecolors: [{ stock: 2 }, { stock: 1 }] });
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
  });

  it("shows no stock badge when stock is ample", () => {
    renderCard({ ...base, productsizecolors: [{ stock: 2 }, { stock: 2 }] });
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
  });

  it("shows no stock badge when stock data is absent", () => {
    renderCard(base);
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
  });

  it("does not treat a product with no variants as sold out", () => {
    renderCard({ ...base, productsizecolors: [] });
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument();
  });
});
