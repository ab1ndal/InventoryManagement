import React from "react";
import StaticPage from "../components/StaticPage";
import { MEASURE_INTRO, SIZE_ROWS } from "./sizeGuideContent";

const SIZES = ["S", "M", "L", "XL"];

export default function SizeGuidePage() {
  return (
    <StaticPage
      eyebrow="Sizing"
      title="Size Guide"
      seoDescription="How to measure and choose the right size at Bindal's Creations. Unsure? Message us on WhatsApp."
    >
      <div className="space-y-4 mb-8">
        {MEASURE_INTRO.map((para, i) => (
          <p key={i} className="text-sm text-storefront-muted font-sans leading-relaxed">
            {para}
          </p>
        ))}
      </div>

      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="border-b border-storefront-border text-left">
              <th className="py-2 pr-4 font-display font-semibold text-storefront-charcoal">
                Measurement
              </th>
              {SIZES.map((s) => (
                <th
                  key={s}
                  scope="col"
                  className="py-2 px-3 font-display font-semibold text-storefront-charcoal text-center"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIZE_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-storefront-border/60">
                <td className="py-2 pr-4 text-storefront-charcoal">{row.label}</td>
                {SIZES.map((s) => (
                  <td key={s} className="py-2 px-3 text-center text-storefront-muted tabular-nums">
                    {row[s]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="aspect-[16/9] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide mb-6">
        [Measurement diagram]
      </div>

      <p className="text-sm text-storefront-muted font-sans leading-relaxed">
        Still unsure? Message us on WhatsApp at{" "}
        <a
          href="https://wa.me/919810873280?text=Hi,%20I%20need%20help%20with%20sizing"
          target="_blank"
          rel="noopener noreferrer"
          className="text-storefront-gold hover:underline"
        >
          +91 98108 73280
        </a>{" "}
        with your measurements and we'll help you pick the right fit.
      </p>
    </StaticPage>
  );
}
