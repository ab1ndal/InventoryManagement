import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { getProductImageUrl } from "../lib/productImage";
import FreeShippingNudge from "../components/FreeShippingNudge";

jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../lib/productImage", () => ({ getProductImageUrl: jest.fn() }));


// Chainable PostgREST stand-in: every filter returns the builder, awaiting it
// resolves to `result`. Records each call so tests can assert the filters.
function builder(result, calls) {
  const b = {};
  ["select", "in", "not", "gt", "gte", "order", "limit"].forEach((m) => {
    b[m] = jest.fn((...args) => {
      calls.push([m, ...args]);
      return b;
    });
  });
  b.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return b;
}

const CART = [
  { variant_id: "v1", product_id: "BC25001", quantity: 1, name: "Silk Saree", price: 3500 },
];

const SUGGESTIONS = [
  { productid: "BC25001", name: "Silk Saree", retailprice: 3500 },
  { productid: "BC25002", name: "Cotton Kurta", retailprice: 1600 },
  { productid: "BC25003", name: "Linen Dupatta", retailprice: 1800 },
];

function renderNudge(props) {
  return render(
    <MemoryRouter>
      <FreeShippingNudge {...props} />
    </MemoryRouter>
  );
}

let calls;
beforeEach(() => {
  calls = [];
  getProductImageUrl.mockResolvedValue(null);
  supabase.from.mockImplementation(() => {
    const b = builder({ data: SUGGESTIONS, error: null }, calls);
    b.select = jest.fn((cols) => {
      calls.push(["select", cols]);
      // The cart-category lookup selects only categoryid.
      if (cols === "productid, categoryid") {
        return builder({ data: [{ productid: "BC25001", categoryid: "SR" }], error: null }, calls);
      }
      return b;
    });
    return b;
  });
});

it("shows the gap and progress below the threshold", async () => {
  renderNudge({ amount: 3760, cartItems: [] });
  expect(screen.getByText("Add ₹1,240 more for free shipping")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  // Gap 1240 is within the suggestion limit; let that fetch settle.
  expect(await screen.findByText("Add one of these")).toBeInTheDocument();
});

it("celebrates once free shipping is unlocked", () => {
  renderNudge({ amount: 5200, cartItems: CART });
  expect(screen.getByText("You've unlocked free shipping")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("shows no suggestions when the gap is above the suggestion limit", async () => {
  renderNudge({ amount: 2000, cartItems: CART });
  expect(screen.getByText("Add ₹3,000 more for free shipping")).toBeInTheDocument();
  await Promise.resolve();
  expect(screen.queryByText("Add one of these")).not.toBeInTheDocument();
  expect(supabase.from).not.toHaveBeenCalled();
});

it("suggests in-stock products that close the gap, excluding cart items", async () => {
  renderNudge({ amount: 3500, cartItems: CART });
  expect(await screen.findByText("Add one of these")).toBeInTheDocument();
  expect(await screen.findByText("Cotton Kurta")).toBeInTheDocument();
  expect(screen.getByText("Linen Dupatta")).toBeInTheDocument();
  expect(screen.queryByText("Silk Saree")).not.toBeInTheDocument();
  // Filtered server-side: price covers the gap, in stock, capped at 4.
  expect(calls).toContainEqual(["gte", "retailprice", 1500]);
  expect(calls).toContainEqual(["gt", "productsizecolors.stock", 0]);
  expect(calls).toContainEqual(["limit", 4]);
  expect(calls).toContainEqual(["in", "categoryid", ["SR"]]);
  await waitFor(() => expect(getProductImageUrl).toHaveBeenCalled());
});

it("renders nothing for an empty cart", () => {
  const { container } = renderNudge({ amount: 0, cartItems: [] });
  expect(container).toBeEmptyDOMElement();
});
