import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ProductGrid from "../components/shop/ProductGrid";

jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));


let intersect;
beforeAll(() => {
  global.IntersectionObserver = class {
    constructor(cb) {
      intersect = () => cb([{ isIntersecting: true }]);
    }
    observe() {}
    disconnect() {}
  };
});

const productsOf = (n) =>
  Array.from({ length: n }, (_, i) => ({ productid: `BC${i}`, name: `P${i}` }));

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
    // The column classes live on the cards' wrapper, which has no role.
    // eslint-disable-next-line testing-library/no-node-access
    const grid = screen.getAllByTestId("product-card")[0].parentElement;
    expect(grid).toHaveClass("grid-cols-2", "lg:grid-cols-3", "xl:grid-cols-4");
    expect(grid).not.toHaveClass("grid-cols-1");
  });

  it("auto-loads the next page while fewer than 48 products are shown", () => {
    const fetchNextPage = jest.fn();
    render(
      <ProductGrid products={productsOf(24)} loading={false} loadingMore={false} hasMore fetchNextPage={fetchNextPage} />
    );
    intersect();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("stops auto-loading at 48 so the footer is reachable, and offers a Load more button", () => {
    const fetchNextPage = jest.fn();
    render(
      <ProductGrid products={productsOf(48)} loading={false} loadingMore={false} hasMore fetchNextPage={fetchNextPage} />
    );
    intersect();
    expect(fetchNextPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("hides Load more once there is nothing left", () => {
    render(
      <ProductGrid products={productsOf(48)} loading={false} loadingMore={false} hasMore={false} fetchNextPage={() => {}} />
    );
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});
