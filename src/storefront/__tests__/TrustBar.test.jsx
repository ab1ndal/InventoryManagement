import React from "react";
import { render, screen } from "@testing-library/react";
import TrustBar from "../components/home/TrustBar";

describe("TrustBar", () => {
  it("shows the four factual promises", () => {
    render(<TrustBar />);
    expect(screen.getByText(/handpicked with love/i)).toBeInTheDocument();
    expect(screen.getByText(/7-day returns & exchange/i)).toBeInTheDocument();
    expect(screen.getByText(/whatsapp help/i)).toBeInTheDocument();
    expect(screen.getByText(/free shipping over ₹5,000/i)).toBeInTheDocument();
  });

  it("calls out plus sizes", () => {
    render(<TrustBar />);
    expect(screen.getByText(/plus sizes up to 6xl/i)).toBeInTheDocument();
  });

  it("advertises 7-day returns and exchange", () => {
    render(<TrustBar />);
    expect(screen.getByText("7-day returns & exchange")).toBeInTheDocument();
    expect(screen.getByText(/within 7 days of delivery or purchase/i)).toBeInTheDocument();
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
