jest.mock("lib/supabaseClient", () => ({
  supabase: {
    from: jest.fn(),
  },
}));
jest.mock("../pages/ShopPage", () => (props) => (
  <div data-testid="shop-page">
    {props.title}|{props.scopeCategoryIds.join(",")}
  </div>
));
jest.mock("../components/ProductCard", () => (props) => (
  <div data-testid="product-card">{props.product.name}</div>
));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import CollectionPage from "../pages/CollectionPage";

function renderAt(slug) {
  return render(
    <MemoryRouter initialEntries={[`/collections/${slug}`]}>
      <Routes>
        <Route path="/collections/:slug" element={<CollectionPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("CollectionPage", () => {
  beforeEach(() => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: [] }),
      }),
    });
  });

  it("renders the collection title", async () => {
    renderAt("wedding");
    expect(await screen.findByText("Wedding")).toBeInTheDocument();
  });

  it("shows the empty state when the collection has no membership", async () => {
    renderAt("wedding");
    expect(
      await screen.findByText(/curated pieces coming soon/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse the full shop/i })).toHaveAttribute(
      "href",
      "/shop"
    );
  });

  it("keeps a product-list collection in its curated order", async () => {
    const { getCollection } = require("../lib/collections");
    const [first, second] = getCollection("diwali").productIds;
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        // The database returns rows in its own order, not the curated one.
        in: jest.fn().mockResolvedValue({
          data: [
            { productid: second, name: "Second pick" },
            { productid: first, name: "First pick" },
          ],
        }),
      }),
    });
    renderAt("diwali");
    await waitFor(() => expect(screen.getAllByTestId("product-card")).toHaveLength(2));
    expect(screen.getAllByTestId("product-card").map((el) => el.textContent)).toEqual([
      "First pick",
      "Second pick",
    ]);
  });

  it("renders a category collection as a filterable shop scoped to its categories", () => {
    renderAt("suits");
    expect(screen.getByTestId("shop-page")).toHaveTextContent("Suits|ST,RMS");
  });

  it("shows a not-found state for an unknown slug", async () => {
    renderAt("nope");
    expect(await screen.findByText(/collection not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse all collections/i })).toHaveAttribute(
      "href",
      "/collections"
    );
  });
});
