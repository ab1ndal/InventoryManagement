import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { RETURNS } from "./policyContent";

export default function ReturnsPolicyPage() {
  return (
    <StaticPage
      title="Returns & Exchange"
      seoDescription="Returns within 7 days of delivery, damaged or wrong items within 48 hours, and 7-day in-store exchange."
    >
      {RETURNS.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
