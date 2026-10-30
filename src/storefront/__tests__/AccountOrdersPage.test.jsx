const mockAuth = jest.fn();
jest.mock("../context/StorefrontAuthContext", () => ({ useStorefrontAuth: () => mockAuth() }));
jest.mock("lib/supabaseClient", () => ({ supabase: { rpc: jest.fn() } }));

import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import AccountOrdersPage from "../pages/AccountOrdersPage";

function row(ref, status, createdAt) {
  return {
    order_ref: ref, status, created_at: createdAt,
    subtotal: 3000, promo_discount: 0, shipping: 80, voucher_applied: 0, credit_applied: 0, gateway_amount: 3080,
    items: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/account/orders"]}>
      <Routes>
        <Route path="/account/orders" element={<AccountOrdersPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

it("lists the shopper's orders newest first with status badges and tracking links", async () => {
  mockAuth.mockReturnValue({ user: { id: "u1" }, loading: false });
  supabase.rpc.mockResolvedValue({
    data: [
      row("WEB-000001", "delivered", "2026-10-01T10:00:00Z"),
      row("WEB-000003", "paid", "2026-10-21T10:00:00Z"),
      row("WEB-000002", "shipped", "2026-10-10T10:00:00Z"),
    ],
    error: null,
  });
  renderPage();
  const rows = await screen.findAllByTestId("account-order");
  expect(supabase.rpc).toHaveBeenCalledWith("my_online_orders");
  expect(rows.map((r) => within(r).getByText(/^WEB-/).textContent)).toEqual(["WEB-000003", "WEB-000002", "WEB-000001"]);
  expect(within(rows[0]).getByText("Paid")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Shipped")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Delivered")).toBeInTheDocument();
  expect(within(rows[0]).getByRole("link", { name: /track/i })).toHaveAttribute("href", "/order/WEB-000003");
  expect(within(rows[0]).getByText(/₹3,080/)).toBeInTheDocument();
});

it("says so when there are no online orders", async () => {
  mockAuth.mockReturnValue({ user: { id: "u1" }, loading: false });
  supabase.rpc.mockResolvedValue({ data: [], error: null });
  renderPage();
  expect(await screen.findByText(/haven't placed any online orders yet/)).toBeInTheDocument();
});

it("sends signed-out visitors to login", () => {
  mockAuth.mockReturnValue({ user: null, loading: false });
  renderPage();
  expect(screen.getByText("login page")).toBeInTheDocument();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it("labels pickup orders as ready for pickup and collected", async () => {
  mockAuth.mockReturnValue({ user: { id: "u1" }, loading: false });
  supabase.rpc.mockResolvedValue({
    data: [
      { ...row("WEB-000005", "ready_for_pickup", "2026-10-25T10:00:00Z"), fulfilment: "pickup" },
      { ...row("WEB-000004", "delivered", "2026-10-24T10:00:00Z"), fulfilment: "pickup" },
    ],
    error: null,
  });
  renderPage();
  const rows = await screen.findAllByTestId("account-order");
  expect(within(rows[0]).getByText("Ready for pickup")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Collected")).toBeInTheDocument();
});
