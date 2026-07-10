import React from "react";
import { render, screen } from "@testing-library/react";
import ShippingPolicyPage from "../pages/policies/ShippingPolicyPage";
import ReturnsPolicyPage from "../pages/policies/ReturnsPolicyPage";
import PrivacyPolicyPage from "../pages/policies/PrivacyPolicyPage";
import TermsPage from "../pages/policies/TermsPage";

describe("Policy pages", () => {
  it("shipping page states real dispatch and free-shipping facts", () => {
    render(<ShippingPolicyPage />);
    expect(screen.getByRole("heading", { name: /shipping policy/i })).toBeInTheDocument();
    expect(screen.getByText(/dispatch.*2 working days/i)).toBeInTheDocument();
    expect(screen.getByText(/free.*above ₹5,000/i)).toBeInTheDocument();
  });

  it("returns page states no-returns / 7-day in-store exchange", () => {
    render(<ReturnsPolicyPage />);
    expect(screen.getByRole("heading", { name: /returns.*exchange/i })).toBeInTheDocument();
    expect(screen.getByText(/exchange.*within 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/in-store only/i)).toBeInTheDocument();
  });

  it("privacy and terms render with review markers", () => {
    const { unmount } = render(<PrivacyPolicyPage />);
    expect(screen.getByRole("heading", { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getAllByText(/needs owner\/legal review/i).length).toBeGreaterThan(0);
    unmount();
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: /terms/i })).toBeInTheDocument();
    expect(screen.getAllByText(/needs owner\/legal review/i).length).toBeGreaterThan(0);
  });
});
