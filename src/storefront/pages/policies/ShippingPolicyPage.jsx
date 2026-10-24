import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { SHIPPING } from "./policyContent";

export default function ShippingPolicyPage() {
  return (
    <StaticPage
      title="Shipping Policy"
      seoDescription="How and when Bindal's Creation dispatches and delivers orders within Uttar Pradesh."
    >
      {SHIPPING.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
