import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FaqPage from "../pages/FaqPage";

describe("FaqPage", () => {
  it("renders the exchange policy and delivery answers", () => {
    render(<MemoryRouter><FaqPage /></MemoryRouter>);
    expect(screen.getByText(/within 7 days of delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/within 48 hours of delivery/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't offer returns/i)).toBeNull();
    expect(screen.getByText(/dispatch within 2 working days/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /returns & exchange policy/i })).toHaveAttribute("href", "/policies/returns");
    // COD is asked about, and the answer is a plain no.
    expect(screen.getByText(/Not yet\. Online orders are paid online/)).toBeInTheDocument();
    expect(screen.getByText(/free on orders of ₹5,000 and above/)).toBeInTheDocument();
    expect(screen.getByText(/open 10 AM to 8:30 PM/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /plus size collection/i })).toHaveAttribute("href", "/collections/plus-size");
  });
});
