import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StorefrontFooter from "../components/StorefrontFooter";

function renderFooter() {
  render(
    <MemoryRouter>
      <StorefrontFooter />
    </MemoryRouter>
  );
}

describe("StorefrontFooter", () => {
  it("links to all four policy pages", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /shipping/i })).toHaveAttribute("href", "/policies/shipping");
    expect(screen.getByRole("link", { name: /returns/i })).toHaveAttribute("href", "/policies/returns");
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/policies/privacy");
    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/policies/terms");
  });

  it("links to About, Contact, and Size Guide", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /about/i })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: /contact/i })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: /size guide/i })).toHaveAttribute("href", "/size-guide");
  });
});
