import React from "react";
import { render, screen } from "@testing-library/react";
import TrustBar from "../components/home/TrustBar";

describe("TrustBar", () => {
  it("advertises 7-day in-store exchange, not returns", () => {
    render(<TrustBar />);
    expect(screen.getByText(/7-Day Exchange/i)).toBeInTheDocument();
    expect(screen.getByText(/In-store exchange within 7 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/returns/i)).toBeNull();
  });

  it("does not claim Secure Checkout before checkout ships", () => {
    render(<TrustBar />);
    expect(screen.queryByText(/secure checkout/i)).toBeNull();
  });
});
