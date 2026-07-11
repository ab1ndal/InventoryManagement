import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("opens the search overlay from the Search button", () => {
    renderHeader();
    const searchBtn = screen.getByRole("button", { name: "Search" });
    expect(screen.queryByRole("dialog", { name: /search products/i })).toBeNull();
    fireEvent.click(searchBtn);
    expect(screen.getByRole("dialog", { name: /search products/i })).toBeInTheDocument();
  });
});
