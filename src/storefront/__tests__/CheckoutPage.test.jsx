import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CheckoutPage from "../pages/CheckoutPage";

// The nudge queries Supabase for suggestions (FreeShippingNudge.test.jsx
// covers that); here we only check it receives the item subtotal.
jest.mock("../components/FreeShippingNudge", () => ({ amount }) =>
  require("react").createElement("div", { "data-testid": "free-shipping-nudge", "data-amount": amount })
);
// Live switch off: the page must be exactly the WhatsApp flow.
const mockGetCheckoutLive = jest.fn();
const mockQuote = jest.fn();
jest.mock("../lib/ordersApi", () => ({
  ...jest.requireActual("../lib/ordersApi"),
  getCheckoutLive: () => mockGetCheckoutLive(),
  quote: (...args) => mockQuote(...args),
}));
const mockUseCart = jest.fn();
jest.mock("../context/CartContext", () => ({
  useCart: () => mockUseCart(),
}));


const ITEM = { variant_id: "v1", product_id: "BC1", quantity: 2, name: "Silk Saree", size: "FREE", color: "Red", price: 1500, image_url: null };

// CRA sets Jest's `resetMocks: true` — re-arm the mock's return value here.
beforeEach(() => {
  mockUseCart.mockReturnValue({ items: [ITEM] });
  mockGetCheckoutLive.mockResolvedValue(false);
});

it("with checkout_live off shows the WhatsApp CTA and never asks for a quote", async () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  await waitFor(() => expect(mockGetCheckoutLive).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /complete your order on whatsapp/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /online payment launching soon/i })).toBeDisabled();
  await new Promise((r) => setTimeout(r, 400));
  expect(mockQuote).not.toHaveBeenCalled();
  expect(screen.queryByText(/gift card/i)).not.toBeInTheDocument();
});

it("renders contact/address fields and the order summary", () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  expect(screen.getByPlaceholderText(/full name/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/phone/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/flat, house no/i)).toBeInTheDocument();
  expect(screen.getByText("Silk Saree (FREE/Red) ×2")).toBeInTheDocument();
  // subtotal ₹3,000, below ₹5000 threshold → ₹150 shipping shown
  expect(screen.getAllByText("₹3,000").length).toBeGreaterThan(0);
  expect(screen.getByText("₹150")).toBeInTheDocument();
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
  userEvent.type(screen.getByPlaceholderText(/pincode/i), "201001");
  userEvent.type(screen.getByPlaceholderText(/flat, house no/i), "58");
  userEvent.type(screen.getByPlaceholderText(/area, street/i), "Sihani Gate Market");
  userEvent.type(screen.getByPlaceholderText(/^landmark/i), "Near Durga Bhabhi Chowk");
  userEvent.type(screen.getByPlaceholderText(/^city$/i), "Ghaziabad");
  userEvent.selectOptions(screen.getByRole("combobox"), "Uttar Pradesh");

  const whatsappLink = await screen.findByRole("link", { name: /complete your order on whatsapp/i });
  expect(whatsappLink).toHaveAttribute("href", expect.stringContaining("wa.me/919810873280"));
  const text = decodeURIComponent(whatsappLink.getAttribute("href").split("?text=")[1]);
  expect(text).toContain("58\nSihani Gate Market\nLandmark: Near Durga Bhabhi Chowk\nGhaziabad, Uttar Pradesh 201001");
});

it("requires the area/street line for delivery", async () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
  userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
  userEvent.type(screen.getByPlaceholderText(/pincode/i), "201001");
  userEvent.type(screen.getByPlaceholderText(/flat, house no/i), "58");
  userEvent.type(screen.getByPlaceholderText(/^city$/i), "Ghaziabad");
  userEvent.selectOptions(screen.getByRole("combobox"), "Uttar Pradesh");
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(screen.getByRole("button", { name: /complete your order on whatsapp/i })).toBeDisabled();
  userEvent.type(screen.getByPlaceholderText(/area, street/i), "Sihani Gate Market");
  expect(await screen.findByRole("link", { name: /complete your order on whatsapp/i })).toBeInTheDocument();
});

it("offers WhatsApp checkout for an address outside Uttar Pradesh", async () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);

  userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
  userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");
  userEvent.type(screen.getByPlaceholderText(/pincode/i), "400001");
  userEvent.type(screen.getByPlaceholderText(/flat, house no/i), "12");
  userEvent.type(screen.getByPlaceholderText(/area, street/i), "Marine Drive");
  userEvent.type(screen.getByPlaceholderText(/^city$/i), "Mumbai");
  userEvent.selectOptions(screen.getByRole("combobox"), "Maharashtra");

  const whatsappLink = await screen.findByRole("link", { name: /complete your order on whatsapp/i });
  expect(whatsappLink).toHaveAttribute("href", expect.stringContaining("Maharashtra"));
});

it("passes the item subtotal to the free-shipping nudge", () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  expect(screen.getByTestId("free-shipping-nudge")).toHaveAttribute("data-amount", "3000");
});

it("redirects to /cart when the cart is empty", () => {
  mockUseCart.mockReturnValue({ items: [] });
  render(<MemoryRouter initialEntries={["/checkout"]}><CheckoutPage /></MemoryRouter>);
  expect(screen.queryByText(/checkout/i)).not.toBeInTheDocument();
});

it("offers store pickup on WhatsApp with contact details only", async () => {
  render(<MemoryRouter><CheckoutPage /></MemoryRouter>);
  // userEvent fires synchronously; let react-hook-form's mount-time validity
  // check (ship branch) resolve first, or its stale result lands last.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  userEvent.click(screen.getByRole("radio", { name: /pick up at the shop/i }));
  expect(screen.queryByPlaceholderText(/flat, house no/i)).not.toBeInTheDocument();
  expect(screen.getByText("Free (store pickup)")).toBeInTheDocument();
  expect(screen.queryByTestId("free-shipping-nudge")).not.toBeInTheDocument();

  userEvent.type(screen.getByPlaceholderText(/full name/i), "Priya Sharma");
  userEvent.type(screen.getByPlaceholderText(/^phone/i), "9810873280");

  const whatsappLink = await screen.findByRole("link", { name: /complete your order on whatsapp/i });
  const text = decodeURIComponent(whatsappLink.getAttribute("href").split("?text=")[1]);
  expect(text).toContain("Store pickup:\nPriya Sharma\n9810873280");
  expect(text).toContain("Shipping: Free");
  expect(text).not.toContain("Deliver to");
});
