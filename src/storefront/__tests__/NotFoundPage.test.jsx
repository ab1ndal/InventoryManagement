import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotFoundPage from "../pages/NotFoundPage";

describe("NotFoundPage", () => {
  it("renders the not-found heading and a link to shop", () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /continue shopping/i })).toHaveAttribute("href", "/shop");
  });
});
