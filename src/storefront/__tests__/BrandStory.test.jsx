import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BrandStory from "../components/home/BrandStory";

function renderStory() {
  return render(
    <MemoryRouter>
      <BrandStory />
    </MemoryRouter>
  );
}

describe("BrandStory", () => {
  it("renders a story blurb and a link to the About page", () => {
    renderStory();
    expect(screen.getByRole("link", { name: /our story/i })).toHaveAttribute("href", "/about");
  });

  it("says handpicked, never crafted", () => {
    const { container } = renderStory();
    expect(container.textContent).toMatch(/handpicked/i);
    expect(container.textContent).not.toMatch(/crafted/i);
  });

  it("shows the real store photo", () => {
    renderStory();
    expect(screen.getByRole("img", { name: /inside the bindal's creation store/i })).toHaveAttribute(
      "src",
      "/store/store-sarees.webp"
    );
  });
});
