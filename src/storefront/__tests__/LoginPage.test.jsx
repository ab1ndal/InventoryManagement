const mockSignIn = jest.fn(async () => ({ error: null }));
jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ signInWithOtp: mockSignIn, user: null }),
}));

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../pages/LoginPage";

it("emails a magic link and shows the sent state", async () => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /sign-in link/i }).closest("form")); });
  expect(mockSignIn).toHaveBeenCalledWith("a@b.com");
  expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
});
