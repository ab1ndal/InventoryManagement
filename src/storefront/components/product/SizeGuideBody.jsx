import React from "react";
import { MEASURE_INTRO, SIZE_CHART } from "../../pages/sizeGuideContent";

// Shared by the /size-guide page and the PDP size-guide modal so the two
// never drift apart.
export function SizeGuideIntro() {
  return (
    <div className="space-y-4 mb-8">
      {MEASURE_INTRO.map((para, i) => (
        <p key={i} className="text-sm text-storefront-muted font-sans leading-relaxed">
          {para}
        </p>
      ))}
    </div>
  );
}

export function SizeGuideTable() {
  return (
    <div className="mb-8">
      <table className="w-full max-w-xs text-sm font-sans border-collapse">
        <thead>
          <tr className="border-b border-storefront-border text-left">
            <th scope="col" className="py-2 pr-4 font-display font-semibold text-storefront-charcoal">
              Size
            </th>
            <th scope="col" className="py-2 pl-3 font-display font-semibold text-storefront-charcoal text-right">
              Fits bust (inches)
            </th>
          </tr>
        </thead>
        <tbody>
          {SIZE_CHART.map(({ size, bust }) => (
            <tr key={size} className="border-b border-storefront-border/60">
              <th scope="row" className="py-2 pr-4 text-left font-normal text-storefront-charcoal">
                {size}
              </th>
              <td className="py-2 pl-3 text-right text-storefront-muted tabular-nums">{bust}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SizeGuideHelp() {
  return (
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
  );
}
