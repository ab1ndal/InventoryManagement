import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CartProvider } from "../context/CartContext";
import StorefrontHeader from "../components/StorefrontHeader";

function renderHeader() {
  render(
    <MemoryRouter>
      <CartProvider>
        <StorefrontHeader />
      </CartProvider>
    </MemoryRouter>
  );
}

describe("StorefrontHeader", () => {
  it("links to About and Contact", () => {
    renderHeader();
    expect(screen.getAllByRole("link", { name: "About" })[0]).toHaveAttribute("href", "/about");
    expect(screen.getAllByRole("link", { name: "Contact" })[0]).toHaveAttribute("href", "/contact");
  });

  it("has no Search button", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
  });
});
