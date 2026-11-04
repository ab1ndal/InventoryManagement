import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AllProductsPage from "../pages/AllProductsPage";

const mockPages = [];
const mockRanges = [];

jest.mock("lib/supabaseClient", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        order: () => chain,
        range: (from, to) => {
          mockRanges.push([from, to]);
          return Promise.resolve(mockPages.shift());
        },
      };
      return chain;
    },
  },
}));

jest.mock("../components/Seo", () => () => null);

const renderPage = () =>
  render(
    <MemoryRouter>
      <AllProductsPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockPages.length = 0;
  mockRanges.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

test("links every product across pages of results", async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ productid: `BC${i}`, name: `Piece ${i}` }));
  mockPages.push(
    { data: full, error: null },
    { data: [{ productid: "BC-last", name: "Last Piece" }], error: null },
  );
  renderPage();

  const last = await screen.findByRole("link", { name: "Last Piece" });
  expect(last).toHaveAttribute("href", "/product/BC-last");
  expect(screen.getAllByRole("listitem")).toHaveLength(1001);
  expect(mockRanges).toEqual([
    [0, 999],
    [1000, 1999],
  ]);
});

test("a failed load offers the shop instead of an empty page", async () => {
  mockPages.push({ data: null, error: { message: "down" } });
  renderPage();
  expect(await screen.findByRole("link", { name: "Browse the shop" })).toHaveAttribute("href", "/shop");
});
