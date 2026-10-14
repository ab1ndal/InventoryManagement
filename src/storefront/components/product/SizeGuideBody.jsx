import React from "react";
import { MEASURE_INTRO, SIZE_ROWS } from "../../pages/sizeGuideContent";

const SIZES = ["S", "M", "L", "XL"];

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
