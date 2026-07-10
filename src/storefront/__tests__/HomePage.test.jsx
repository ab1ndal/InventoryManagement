import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Stub the data-fetching sections so the test doesn't hit Supabase.
jest.mock("../components/home/HeroBanner", () => () => <div data-testid="hero" />);
jest.mock("../components/home/CategoryShowcase", () => () => <div data-testid="category" />);
jest.mock("../components/home/NewArrivals", () => () => <div data-testid="arrivals" />);

import HomePage from "../pages/HomePage";

describe("HomePage", () => {
  it("renders TrustBar and BrandStory, and no bestseller/featured grid", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );
    // TrustBar (real) present:
    expect(screen.getByText(/7-Day Exchange/i)).toBeInTheDocument();
    // BrandStory (real) present via its About link:
    expect(screen.getByRole("link", { name: /our story/i })).toHaveAttribute("href", "/about");
    // Removed grids' distinctive copy is gone:
    expect(screen.queryByText(/curated picks/i)).toBeNull();
    expect(screen.queryByText(/bridal edit/i)).toBeNull();
  });
});
