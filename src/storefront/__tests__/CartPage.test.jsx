const mockRevalidate = jest.fn(async () => []);
jest.mock("../context/CartContext", () => ({
  useCart: () => ({
    items: [
      { variant_id: "v1", product_id: "BC1", quantity: 2, name: "Silk Saree", size: "FREE", color: "Red", price: 1500, image_url: null },
    ],
    updateQty: jest.fn(),
    removeItem: jest.fn(),
    revalidateCart: mockRevalidate,
  }),
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CartPage from "../pages/CartPage";

// CRA sets Jest's `resetMocks: true`, which wipes the factory-supplied
// implementation above before every test — re-arm it here.
beforeEach(() => {
  mockRevalidate.mockImplementation(async () => []);
});

it("lists items, shows subtotal, and revalidates on mount", async () => {
  render(<MemoryRouter><CartPage /></MemoryRouter>);
  expect(screen.getByText("Silk Saree")).toBeInTheDocument();
  // single item → line total equals subtotal; both render ₹3,000 (see CartDrawer.test.jsx for the same pattern)
  expect(screen.getAllByText(/₹3,000/).length).toBeGreaterThan(0);
  await waitFor(() => expect(mockRevalidate).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: /order on whatsapp/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /^checkout$/i })).toHaveAttribute("href", "/checkout");
});
