import React from "react";
import { CARE_NOTE, COLOUR_NOTE } from "../../lib/deliveryEstimate";

// Structured "Details" table for the PDP, built only from real per-product
// data (product row + its variants). There are no care/work columns, so the
// notes below the table stay honest, universal microcopy. `sizes` holds only
// the in-stock sizes, already formatted and ordered.
export default function ProductSpecs({ productId, fabric, category, colours = [], sizes = [] }) {
  const rows = [
    category && { label: "Category", value: category },
    fabric && { label: "Fabric", value: fabric },
    colours.length > 0 && { label: colours.length > 1 ? "Colours" : "Colour", value: colours.join(", ") },
    sizes.length > 0 && {
      label: sizes.length > 1 ? "Available sizes" : "Available size",
      value: sizes.join(", "),
    },
    productId && { label: "Product code", value: productId },
  ].filter(Boolean);

  return (
    <section aria-labelledby="product-details" className="mb-6">
      <h2
        id="product-details"
        className="text-[10px] font-medium tracking-[0.2em] uppercase text-storefront-charcoal font-sans mb-3"
      >
        Details
      </h2>

      {rows.length > 0 && (
        <dl className="mb-4 border-t border-storefront-border/70">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[8rem_1fr] gap-4 py-2.5 border-b border-storefront-border/70"
            >
              <dt className="text-xs text-storefront-muted font-sans">{r.label}</dt>
              <dd className="text-xs text-storefront-charcoal font-sans">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="text-xs text-storefront-muted font-sans leading-relaxed mb-1.5">
        {CARE_NOTE}
      </p>
      <p className="text-[11px] text-storefront-muted/80 font-sans leading-relaxed">
        {COLOUR_NOTE}
      </p>
    </section>
  );
}
