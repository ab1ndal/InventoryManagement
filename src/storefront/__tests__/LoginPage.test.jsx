import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../pages/LoginPage";

const mockSignIn = jest.fn(async () => ({ error: null }));
jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ signInWithOtp: mockSignIn, user: null }),
}));


it("emails a magic link and shows the sent state", async () => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
  fireEvent.click(screen.getByRole("button", { name: /sign-in link/i }));
  expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  expect(mockSignIn).toHaveBeenCalledWith("a@b.com");
});
