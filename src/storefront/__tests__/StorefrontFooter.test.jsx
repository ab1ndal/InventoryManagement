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

  it("uses handpicked wording, never crafted", () => {
    renderFooter();
    expect(screen.getByText(/handpicked with love/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/crafted/i);
  });
});

describe("StorefrontFooter — shop links", () => {
  it("lists the header categories, linking to their collection pages", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: "Sarees" })).toHaveAttribute("href", "/collections/sarees");
    expect(screen.getByRole("link", { name: "Suits" })).toHaveAttribute("href", "/collections/suits");
    expect(screen.getByRole("link", { name: "Diwali Glam" })).toHaveAttribute("href", "/collections/diwali");
    expect(screen.queryByRole("link", { name: /dupattas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /salwar suits/i })).not.toBeInTheDocument();
  });

  it("lists Shop All once, under Explore rather than Help", () => {
    renderFooter();
    const shopAll = screen.getAllByRole("link", { name: "Shop All" });
    expect(shopAll).toHaveLength(1);
    expect(shopAll[0].closest("div")).toHaveTextContent(/^Explore/);
  });

  it("splits categories (Shop) from seasonal and service pages (Explore)", () => {
    renderFooter();
    const column = (name) => screen.getByRole("heading", { name }).closest("div");
    expect(column("Shop")).toHaveTextContent("Sarees");
    expect(column("Shop")).not.toHaveTextContent("Custom Tailoring");
    expect(column("Explore")).toHaveTextContent("Diwali Glam");
    expect(column("Explore")).toHaveTextContent("Custom Tailoring");
    expect(column("Explore")).toHaveTextContent("Collections");
  });
});
