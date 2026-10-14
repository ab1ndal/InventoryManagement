import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Stub the data-fetching sections so the test doesn't hit Supabase.
jest.mock("../components/home/CategoryBand", () => () => <div data-testid="category-band" />);
jest.mock("../components/home/HeroSlider", () => () => <div data-testid="hero" />);
jest.mock("../components/home/DiwaliRail", () => () => <div data-testid="diwali-rail" />);
jest.mock("../components/home/NewArrivals", () => () => <div data-testid="arrivals" />);
jest.mock("../components/home/CategoryRail", () => (props) => (
  <div data-testid="category-rail">{props.title}</div>
));

import HomePage from "../pages/HomePage";

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

// True when `a` comes before `b` in document order.
function precedes(a, b) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("HomePage", () => {
  it("puts products first: category band, hero, rails, then trust row and story", () => {
    renderHome();
    const band = screen.getByTestId("category-band");
    const hero = screen.getByTestId("hero");
    const diwali = screen.getByTestId("diwali-rail");
    const arrivals = screen.getByTestId("arrivals");
    const categoryRails = screen.getAllByTestId("category-rail");
    const trust = screen.getByRole("region", { name: /why shop with us/i });
    const story = screen.getByRole("link", { name: /our story/i });

    expect(precedes(band, hero)).toBe(true);
    expect(precedes(hero, diwali)).toBe(true);
    expect(precedes(diwali, arrivals)).toBe(true);
    expect(precedes(arrivals, categoryRails[0])).toBe(true);
    expect(precedes(categoryRails[categoryRails.length - 1], trust)).toBe(true);
    expect(precedes(trust, story)).toBe(true);
  });

  it("shows rails for sarees, lehengas and kurtis", () => {
    renderHome();
    const titles = screen.getAllByTestId("category-rail").map((r) => r.textContent);
    expect(titles).toEqual(["Sarees", "Lehengas", "Kurtis"]);
  });

  it("has a page heading for the home page", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
