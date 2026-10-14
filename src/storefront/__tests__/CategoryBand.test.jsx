jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../lib/productImage", () => ({
  getProductImageUrl: (id) => Promise.resolve(`https://img.test/${id}.webp`),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import CategoryBand, { pickBandCategories } from "../components/home/CategoryBand";

const CATEGORIES = [
  { categoryid: "SA", name: "Saree" },
  { categoryid: "LE", name: "Lehenga" },
  { categoryid: "PNT", name: "Pant" },
];
// Newest first, as the loader queries them.
const PRODUCTS = [
  { productid: "BC9", categoryid: "LE" },
  { productid: "BC8", categoryid: "SA" },
  { productid: "BC7", categoryid: "SA" },
  { productid: "BC6", categoryid: "LE" },
  { productid: "BC5", categoryid: "SA" },
  { productid: "BC4", categoryid: "PNT" },
];

describe("pickBandCategories", () => {
  it("keeps categories with enough products, most stocked first, with their newest product", () => {
    expect(pickBandCategories(CATEGORIES, PRODUCTS, 2)).toEqual([
      { categoryid: "SA", name: "Saree", newestProductId: "BC8" },
      { categoryid: "LE", name: "Lehenga", newestProductId: "BC9" },
    ]);
  });
});

// The band needs 10+ products per category: 12 sarees, 10 lehengas, 1 pant.
const STOCKED = [
  ...Array.from({ length: 12 }, (_, i) => ({ productid: `BC${200 - i}`, categoryid: "SA" })),
  ...Array.from({ length: 10 }, (_, i) => ({ productid: `BC${100 - i}`, categoryid: "LE" })),
  { productid: "BC1", categoryid: "PNT" },
];

describe("CategoryBand", () => {
  beforeEach(() => {
    supabase.from.mockImplementation((table) => {
      if (table === "categories") {
        return { select: () => Promise.resolve({ data: CATEGORIES }) };
      }
      return {
        select: () => ({ order: () => Promise.resolve({ data: STOCKED }) }),
      };
    });
  });

  it("leads with the Diwali Edit and links each category icon", async () => {
    render(
      <MemoryRouter>
        <CategoryBand />
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: /saree/i })).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/collections/diwali");
    expect(links[0]).toHaveTextContent(/diwali edit/i);
    expect(screen.queryByRole("link", { name: /pant/i })).toBeNull();
  });
});
