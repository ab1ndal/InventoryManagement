import React from "react";
import { render, screen } from "@testing-library/react";
import TrustBar from "../components/home/TrustBar";

describe("TrustBar", () => {
  it("shows the four factual promises", () => {
    render(<TrustBar />);
    expect(screen.getByText(/handpicked with love/i)).toBeInTheDocument();
    expect(screen.getByText(/easy exchanges in store/i)).toBeInTheDocument();
    expect(screen.getByText(/whatsapp help/i)).toBeInTheDocument();
    expect(screen.getByText(/free shipping over ₹5,000/i)).toBeInTheDocument();
  });

  it("calls out plus sizes", () => {
    render(<TrustBar />);
    expect(screen.getByText(/plus sizes up to 6xl/i)).toBeInTheDocument();
  });

  it("advertises in-store exchange within 7 days, not returns", () => {
    render(<TrustBar />);
    expect(screen.getByText(/exchange within 7 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/returns/i)).toBeNull();
  });

  it("links WhatsApp help to a chat", () => {
    render(<TrustBar />);
    expect(screen.getByRole("link", { name: /whatsapp help/i })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/")
    );
  });

  it("does not claim Secure Checkout or crafted goods", () => {
    const { container } = render(<TrustBar />);
    expect(screen.queryByText(/secure checkout/i)).toBeNull();
    expect(container.textContent).not.toMatch(/crafted/i);
  });
});
