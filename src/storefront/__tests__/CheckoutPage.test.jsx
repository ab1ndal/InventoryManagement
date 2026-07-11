const mockUseCart = jest.fn();
jest.mock("../context/CartContext", () => ({
  useCart: () => mockUseCart(),
}));

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CheckoutPage from "../pages/CheckoutPage";

const ITEM = { variant_id: "v1", product_id: "BC1", quantity: 2, name: "Silk Saree", size: "FREE", color: "Red", price: 1500, image_url: null };

// CRA sets Jest's `resetMocks: true` — re-arm the mock's return value here.
beforeEach(() => {
  mockUseCart.mockReturnValue({ items: [ITEM] });
});

it("renders contact/address fields and the order summary", () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/phone/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/address line 1/i)).toBeInTheDocument();
  expect(screen.getByText("Silk Saree (FREE/Red) ×2")).toBeInTheDocument();
  // subtotal ₹3,000, below ₹5000 threshold → ₹99 shipping shown
  expect(screen.getAllByText("₹3,000").length).toBeGreaterThan(0);
  expect(screen.getByText("₹99")).toBeInTheDocument();
});

it("keeps the place-order button disabled and offers no COD", () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  expect(screen.getByRole("button", { name: /place order/i })).toBeDisabled();
  expect(screen.queryByText(/cash on delivery/i)).not.toBeInTheDocument();
});

it("enables the WhatsApp control once the address form is valid", async () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);

  // WhatsApp control starts out disabled (form incomplete)
  expect(screen.getByRole("button", { name: /complete your order on whatsapp/i })).toBeDisabled();

  userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
  userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
  userEvent.type(screen.getByPlaceholderText(/address line 1/i), "58 Sihani Gate Market");
  userEvent.type(screen.getByPlaceholderText(/^city$/i), "Ghaziabad");
  userEvent.selectOptions(screen.getByRole("combobox"), "Uttar Pradesh");
  userEvent.type(screen.getByPlaceholderText(/pincode/i), "201001");

  const whatsappLink = await screen.findByRole("link", { name: /complete your order on whatsapp/i });
  expect(whatsappLink).toHaveAttribute("href", expect.stringContaining("wa.me/919810873280"));
  expect(whatsappLink).toHaveAttribute("href", expect.stringContaining("Ghaziabad"));
});

it("redirects to /cart when the cart is empty", () => {
  mockUseCart.mockReturnValue({ items: [] });
  render(<MemoryRouter initialEntries={["/checkout"]}><CheckoutPage /></MemoryRouter>);
  expect(screen.queryByText(/checkout/i)).not.toBeInTheDocument();
});
