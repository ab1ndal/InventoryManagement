jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));

import React from "react";
import { render, screen } from "@testing-library/react";
import ProductGrid from "../components/shop/ProductGrid";

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe("ProductGrid", () => {
  it("lays products out 2-up on mobile, 3-up beside the sidebar, 4-up on wide screens", () => {
    render(
      <ProductGrid
        products={[{ productid: "BC1", name: "A" }, { productid: "BC2", name: "B" }]}
        loading={false}
        loadingMore={false}
        hasMore={false}
        fetchNextPage={() => {}}
      />
    );
    const grid = screen.getAllByTestId("product-card")[0].parentElement;
    expect(grid).toHaveClass("grid-cols-2", "lg:grid-cols-3", "xl:grid-cols-4");
    expect(grid).not.toHaveClass("grid-cols-1");
  });
});
