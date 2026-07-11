import React from "react";
import { CARE_NOTE, COLOUR_NOTE } from "../../lib/deliveryEstimate";

// Consolidated "Details" block for the PDP. Only fabric + category are real
// per-product data (no care/work columns exist), so specifics come from the
// product row and everything else is honest, universal microcopy.
export default function ProductSpecs({ fabric, category }) {
  const rows = [
    fabric && { label: "Fabric", value: fabric },
    category && { label: "Category", value: category },
  ].filter(Boolean);

  return (
    <div className="mb-6">
      <h2 className="text-[10px] font-medium tracking-[0.2em] uppercase text-storefront-charcoal font-sans mb-3">
        Details
      </h2>

      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 mb-4">
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <dt className="text-xs text-storefront-muted font-sans">{r.label}</dt>
              <dd className="text-xs text-storefront-charcoal font-sans">{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      <p className="text-xs text-storefront-muted font-sans leading-relaxed mb-1.5">
        {CARE_NOTE}
      </p>
      <p className="text-[11px] text-storefront-muted/80 font-sans leading-relaxed">
        {COLOUR_NOTE}
      </p>
    </div>
  );
}
