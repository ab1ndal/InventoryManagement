import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SearchNoResults from "../components/SearchNoResults";

test("offers category links and a WhatsApp link carrying the search", () => {
  render(
    <MemoryRouter>
      <SearchNoResults query="zzz" />
    </MemoryRouter>
  );
  expect(screen.getByText(/No products match “zzz”/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sarees" })).toHaveAttribute("href", "/collections/sarees");
  const wa = screen.getByRole("link", { name: "Ask us on WhatsApp" });
  expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\d+\?text=.*zzz/);
  expect(wa.className).toContain("text-storefront-charcoal");
});
