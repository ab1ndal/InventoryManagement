import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AboutPage from "../pages/AboutPage";

describe("AboutPage", () => {
  it("renders the story heading and a link to shop", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: /our story/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /shop the collection/i })).toHaveAttribute("href", "/shop");
  });

  it("shows the craftsmanship photo with its licence credit, not a placeholder", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("img", { name: /zari and mirror work/i })).toHaveAttribute("src", "/about/zari-embroidery.webp");
    expect(screen.getByRole("link", { name: /cc by 2\.0/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\[craftsmanship/i);
  });

  it("keeps the copy plain: no em dashes (owner found them AI-sounding)", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    );
    expect(document.body.textContent).not.toMatch(/—/);
  });
});
