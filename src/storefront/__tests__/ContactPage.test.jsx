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

  it("pins the map and directions to the Google listing, not the address text", () => {
    render(<ContactPage />);
    const map = screen.getByTitle(/store location/i);
    expect(map.getAttribute("src")).toContain("q=28.6658525,77.4270128");
    expect(map.getAttribute("src")).not.toMatch(/Sihani/i);
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute(
      "href",
      "https://maps.google.com/?cid=3990311017020362668"
    );
  });

  it("shows the real shop photos", () => {
    render(<ContactPage />);
    expect(screen.getByRole("img", { name: /shop front/i })).toHaveAttribute("src", "/store/store-front.webp");
    expect(screen.getByRole("img", { name: /inside the shop/i })).toHaveAttribute("src", "/store/store-interior.webp");
  });
});
