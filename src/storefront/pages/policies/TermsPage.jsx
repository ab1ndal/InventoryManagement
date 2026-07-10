import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { TERMS } from "./policyContent";

export default function TermsPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Terms of Service"
      seoDescription="The terms governing use of the Bindal's Creations website and orders."
    >
      {TERMS.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
