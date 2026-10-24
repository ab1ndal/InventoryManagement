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

  it("shipping page states the same flat fee checkout charges", () => {
    const { shippingFee } = require("../lib/checkout");
    render(<ShippingPolicyPage />);
    expect(screen.getByText(new RegExp(`flat.*₹${shippingFee(0)}`, "i"))).toBeInTheDocument();
  });

  it("returns page states no-returns / 7-day in-store exchange", () => {
    render(<ReturnsPolicyPage />);
    expect(screen.getByRole("heading", { name: /returns.*exchange/i })).toBeInTheDocument();
    expect(screen.getByText(/exchange.*within 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/in-store only/i)).toBeInTheDocument();
  });

  it("returns page states online cancellation and damaged-item refunds", () => {
    render(<ReturnsPolicyPage />);
    expect(screen.getByText(/cancel an online order any time before it is dispatched/i)).toBeInTheDocument();
    expect(screen.getByText(/within 48 hours of delivery/i)).toBeInTheDocument();
  });

  it("privacy and terms are real content naming the payment partner", () => {
    const { container, unmount } = render(<PrivacyPolicyPage />);
    expect(screen.getByRole("heading", { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/do not see or store your card/i)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/placeholder|TODO/i);
    unmount();
    const terms = render(<TermsPage />);
    expect(screen.getByRole("heading", { name: /terms/i })).toBeInTheDocument();
    expect(screen.getByText(/no GST is charged separately/i)).toBeInTheDocument();
    expect(screen.getByText(/laws of India/i)).toBeInTheDocument();
    expect(terms.container).not.toHaveTextContent(/placeholder|TODO/i);
  });
});
