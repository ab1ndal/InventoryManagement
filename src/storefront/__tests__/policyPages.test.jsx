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
    expect(screen.getByText(/free on orders of ₹5,000 and above/i)).toBeInTheDocument();
  });

  it("shipping page says the courier charge is shown at checkout, not a flat fee", () => {
    const { container } = render(<ShippingPolicyPage />);
    expect(
      screen.getByText(/courier charge for your pincode is shown at checkout before you pay/i)
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/flat shipping charge/i);
  });

  it("returns page offers original method or instant store credit, and no shipping refund on RTO", () => {
    render(<ReturnsPolicyPage />);
    expect(screen.getAllByText(/instant store credit if you choose/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/refunded to the original payment method, or as instant store credit if you choose/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/prepaid parcel is refused or undeliverable.*shipping charge is not refundable/i)
    ).toBeInTheDocument();
  });

  it("terms cancellation paragraph matches the refund choice and RTO rule", () => {
    render(<TermsPage />);
    expect(screen.getByText(/cancelled before dispatch.*instant store credit if you choose.*shipping charge is not refundable/i)).toBeInTheDocument();
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
    const view = render(<TermsPage />);
    expect(screen.getByRole("heading", { name: /terms/i })).toBeInTheDocument();
    expect(screen.getByText(/no GST is charged separately/i)).toBeInTheDocument();
    expect(screen.getByText(/laws of India/i)).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(/placeholder|TODO/i);
  });
});
