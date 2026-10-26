import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProductCard from "../components/ProductCard";

const mockImagePaths = jest.fn();
jest.mock("../lib/productImage", () => ({
  getProductImagePaths: (...args) => mockImagePaths(...args),
}));
jest.mock("../components/BlurFillImage", () => ({ alt }) => <img alt={alt} />);
jest.mock("../context/WishlistContext", () => ({
  useWishlist: () => ({ has: () => false, toggle: jest.fn() }),
}));


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
  beforeEach(() => {
    mockImagePaths.mockReset();
    mockImagePaths.mockResolvedValue([]);
  });

  it("shows price and fabric, with no visible title or category tag", () => {
    renderCard(base);
    expect(screen.getByText("₹2,499")).toBeInTheDocument();
    expect(screen.getByText("Silk")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText("Saree")).not.toBeInTheDocument();
  });

  it("names the card link via sr-only text when there is no photo", () => {
    renderCard(base);
    expect(screen.getByText("Silk Saree")).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: /silk saree/i })).toHaveAttribute(
      "href",
      "/product/BC25001"
    );
  });

  it("carries the de-hyphenated name in image alt text, not as sr-only text", async () => {
    mockImagePaths.mockResolvedValue(["a.png", "b.png"]);
    renderCard(base);
    expect(await screen.findByAltText("Silk Saree — view 1")).toBeInTheDocument();
    expect(screen.getByAltText("Silk Saree — view 2")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Silk Saree")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /silk saree/i })).toBeInTheDocument();
  });

  it("uses the de-hyphenated name in the wishlist button label", () => {
    renderCard(base);
    expect(screen.getByRole("button", { name: "Add Silk Saree to wishlist" })).toBeInTheDocument();
  });

  it("shows Sold out when total stock across variants is 0", () => {
    renderCard({ ...base, productsizecolors: [{ stock: 0 }, { stock: 0 }] });
    expect(screen.getByText(/sold out/i)).toBeInTheDocument();
    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
  });

  it("hides the price when every variant is sold out", () => {
    renderCard({ ...base, productsizecolors: [{ stock: 0 }, { stock: 0 }] });
    expect(screen.queryByText("₹2,499")).not.toBeInTheDocument();
  });

  it("keeps the price when only some variants are sold out", () => {
    renderCard({ ...base, productsizecolors: [{ stock: 0 }, { stock: 1 }] });
    expect(screen.getByText("₹2,499")).toBeInTheDocument();
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument();
  });

  it("keeps the price when stock data is absent", () => {
    renderCard(base);
    expect(screen.getByText("₹2,499")).toBeInTheDocument();
  });

  it("shows no low-stock badge even when only one piece is left", () => {
    // Most items are single pieces (stock 1-3), so a low-stock badge would sit
    // on ~80% of cards: noise that reads as false scarcity.
    renderCard({ ...base, productsizecolors: [{ stock: 1 }] });
    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument();
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
