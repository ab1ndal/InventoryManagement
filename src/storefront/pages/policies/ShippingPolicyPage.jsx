import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { SHIPPING } from "./policyContent";

export default function ShippingPolicyPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Shipping Policy"
      seoDescription="How and when Bindal's Creations dispatches and delivers orders across India."
    >
      {SHIPPING.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
