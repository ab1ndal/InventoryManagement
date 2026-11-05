import React from "react";
import { render, screen } from "@testing-library/react";
import TrustBar from "../components/home/TrustBar";

describe("TrustBar", () => {
  it("shows the four factual promises", () => {
    render(<TrustBar />);
    expect(screen.getByText(/handpicked with love/i)).toBeInTheDocument();
    expect(screen.getByText("7-day returns")).toBeInTheDocument();
    expect(screen.getByText(/whatsapp help/i)).toBeInTheDocument();
    expect(screen.getByText(/free shipping over ₹5,000/i)).toBeInTheDocument();
  });

  it("calls out plus sizes", () => {
    render(<TrustBar />);
    expect(screen.getByText(/plus sizes up to 6xl/i)).toBeInTheDocument();
  });

  it("says returns are for online orders and exchange is in store, as the bills do", () => {
    render(<TrustBar />);
    expect(screen.getByText("7-day returns")).toBeInTheDocument();
    expect(screen.getByText(/online orders: return in 7 days\. exchange in store with your bill/i)).toBeInTheDocument();
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
