import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { RETURNS } from "./policyContent";

export default function ReturnsPolicyPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Returns & Exchange"
      seoDescription="Our exchange policy: 7-day in-store exchange on unworn items. No returns."
    >
      {RETURNS.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
