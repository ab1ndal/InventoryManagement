jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProductRail from "../components/home/ProductRail";

function renderRail(props) {
  return render(
    <MemoryRouter>
      <ProductRail title="Diwali Edit" viewAllHref="/collections/diwali" {...props} />
    </MemoryRouter>
  );
}

describe("ProductRail", () => {
  it("renders a titled rail of product cards with a view-all link", () => {
    renderRail({
      loading: false,
      products: [
        { productid: "BC1", name: "One" },
        { productid: "BC2", name: "Two" },
      ],
    });
    expect(screen.getByRole("heading", { name: "Diwali Edit" })).toBeInTheDocument();
    expect(screen.getAllByTestId("product-card").map((c) => c.textContent)).toEqual(["One", "Two"]);
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute("href", "/collections/diwali");
  });

  it("renders nothing once loaded with no products", () => {
    const { container } = renderRail({ loading: false, products: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
