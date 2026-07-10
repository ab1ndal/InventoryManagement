import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { PRIVACY } from "./policyContent";

export default function PrivacyPolicyPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Privacy Policy"
      seoDescription="How Bindal's Creations handles your personal information."
    >
      {PRIVACY.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
