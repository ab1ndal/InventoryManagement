// src/storefront/__tests__/ContactPage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import ContactPage from "../pages/ContactPage";

describe("ContactPage", () => {
  it("shows address, hours, and a WhatsApp link", () => {
    render(<ContactPage />);
    expect(screen.getByRole("heading", { name: /visit us|contact/i })).toBeInTheDocument();
    expect(screen.getByText(/58 Sihani Gate/i)).toBeInTheDocument();
    expect(screen.getByText(/closed tuesdays/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /whatsapp/i })).toHaveAttribute(
      "href",
      expect.stringContaining("wa.me/919810873280")
    );
  });
});
