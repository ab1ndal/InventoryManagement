import React from "react";
import StaticPage from "../components/StaticPage";
import {
  SizeGuideIntro,
  SizeGuideTable,
  SizeGuideHelp,
} from "../components/product/SizeGuideBody";

export default function SizeGuidePage() {
  return (
    <StaticPage
      title="Size Guide"
      seoDescription="How to measure and choose the right size at Bindal's Creation. Unsure? Message us on WhatsApp."
    >
      <SizeGuideIntro />
      <SizeGuideTable />

      <div className="aspect-[16/9] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide mb-6">
        [Measurement diagram]
      </div>

      <SizeGuideHelp />
    </StaticPage>
  );
}
