jest.mock("../pages/ShopPage", () => (props) => (
  <div data-testid="shop-page">
    {props.title}|{(props.scopeCategoryIds || []).join(",")}|{(props.scopeProductIds || []).join(",")}
  </div>
));

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CollectionPage from "../pages/CollectionPage";
import { getCollection } from "../lib/collections";

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

  it("renders a product-list collection as a filterable shop scoped to its products", () => {
    renderAt("diwali");
    const ids = getCollection("diwali").productIds;
    expect(screen.getByTestId("shop-page")).toHaveTextContent(`Diwali Glam||${ids.join(",")}`);
  });

  it("renders a category collection as a filterable shop scoped to its categories", () => {
    renderAt("suits");
    expect(screen.getByTestId("shop-page")).toHaveTextContent("Suits|ST,RMS|");
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
