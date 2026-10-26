import React from "react";
import StaticPage from "../components/StaticPage";
import {
  SizeGuideIntro,
  SizeGuideTable,
  SizeGuideHelp,
} from "../components/product/SizeGuideBody";
import MeasurementDiagram from "../components/product/MeasurementDiagram";

export default function SizeGuidePage() {
  return (
    <StaticPage
      title="Size Guide"
      seoDescription="How to measure and choose the right size at Bindal's Creation. Unsure? Message us on WhatsApp."
    >
      <SizeGuideIntro />
      <SizeGuideTable />

      <MeasurementDiagram />

      <SizeGuideHelp />
    </StaticPage>
  );
}
