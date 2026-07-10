import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BrandStory from "../components/home/BrandStory";

describe("BrandStory", () => {
  it("renders a story blurb and a link to the About page", () => {
    render(
      <MemoryRouter>
        <BrandStory />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: /our story/i })).toHaveAttribute("href", "/about");
  });
});
