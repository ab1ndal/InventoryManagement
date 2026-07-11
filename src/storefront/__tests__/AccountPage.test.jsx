const mockSignOut = jest.fn(async () => ({ error: null }));
jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ user: { id: "u1", email: "a@b.com" }, signOut: mockSignOut, loading: false }),
}));
jest.mock("lib/supabaseClient", () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import AccountPage from "../pages/AccountPage";

beforeEach(() => {
  supabase.rpc.mockResolvedValue({
    data: [{ customerid: 1, first_name: "Asha", last_name: "K", phone: "", email: "a@b.com", address: "", gender: "", needs_review: false }],
    error: null,
  });
});

it("resolves and shows the customer on mount", async () => {
  render(<MemoryRouter><AccountPage /></MemoryRouter>);
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("resolve_my_customer"));
  expect(await screen.findByDisplayValue("Asha")).toBeInTheDocument();
  expect(screen.getByText("a@b.com")).toBeInTheDocument();
});
