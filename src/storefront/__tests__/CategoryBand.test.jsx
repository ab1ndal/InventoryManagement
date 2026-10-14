jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../lib/productImage", () => ({
  getProductImageUrl: (id) => Promise.resolve(`https://img.test/${id}.webp`),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import CategoryBand, { pickBandEntries } from "../components/home/CategoryBand";

const LINKS = [
  { label: "Sarees", to: "/collections/sarees" },
  { label: "Men", to: "/collections/men" },
  { label: "Gowns", to: "/collections/gowns" },
  { label: "Shop All", to: "/shop" },
];
const COLLECTIONS = [
  { slug: "sarees", categoryIds: ["SA"] },
  { slug: "men", categoryIds: ["SW", "KP"] },
  { slug: "gowns", categoryIds: ["GWN"] },
];
// Newest first, as the loader queries them.
const PRODUCTS = [
  { productid: "BC9", categoryid: "KP" },
  { productid: "BC8", categoryid: "SA" },
  { productid: "BC7", categoryid: "SW" },
];

describe("pickBandEntries", () => {
  it("keeps nav order, maps each category link to its collection's newest product, drops empty ones", () => {
    expect(pickBandEntries(LINKS, COLLECTIONS, PRODUCTS)).toEqual([
      { label: "Sarees", to: "/collections/sarees", newestProductId: "BC8" },
      { label: "Men", to: "/collections/men", newestProductId: "BC9" },
    ]);
  });
});

describe("CategoryBand", () => {
  beforeEach(() => {
    supabase.from.mockReturnValue({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: [
              { productid: "BC20", categoryid: "SA" },
              { productid: "BC19", categoryid: "LE" },
            ],
          }),
      }),
    });
  });

  it("leads with the Diwali Edit and links icons to category collections", async () => {
    render(
      <MemoryRouter>
        <CategoryBand />
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: /sarees/i })).toHaveAttribute(
      "href",
      "/collections/sarees"
    );
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/collections/diwali");
    expect(links[0]).toHaveTextContent(/diwali edit/i);
    expect(screen.getByRole("link", { name: /lehengas/i })).toHaveAttribute("href", "/collections/lehengas");
    // No products in these categories in the mock, so no icon.
    expect(screen.queryByRole("link", { name: /^men$/i })).toBeNull();
  });
});
