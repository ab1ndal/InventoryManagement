import React from "react";

// How a tailor in India takes measurements, in inches. Only the bust picks a
// ready-made size (see SIZE_CHART); the rest are what we ask for blouse
// stitching and alterations.
export const MEASUREMENTS = [
  { n: 1, name: "Bust / Chest", how: "Around the fullest part of the chest, under the arms." },
  { n: 2, name: "Waist", how: "Around the natural waist, the narrowest part of the body." },
  { n: 3, name: "Hip", how: "Around the fullest part of the hips." },
  { n: 4, name: "Shoulder", how: "Across the back, from one shoulder tip to the other." },
  { n: 5, name: "Sleeve length", how: "From the shoulder tip down to where the sleeve should end." },
  { n: 6, name: "Armhole", how: "Around the arm where it joins the shoulder." },
  { n: 7, name: "Length", how: "From the top of the shoulder, beside the neck, down to the hem you want." },
];

const KURTA_OUTLINE =
  "M140 44 L95 58 L45 190 L75 200 L108 122 L112 200 L92 390 L228 390 L208 200 L212 122 " +
  "L245 200 L275 190 L225 58 L180 44 Q160 78 140 44 Z";

function Marker({ x, y, n }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" className="fill-storefront-charcoal" />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        className="fill-storefront-cream font-sans"
        fontSize="10"
        fontWeight="600"
      >
        {n}
      </text>
    </g>
  );
}

function Measure({ d }) {
  return (
    <path
      d={d}
      fill="none"
      strokeWidth="1.5"
      strokeDasharray="4 3"
      markerStart="url(#measure-tick)"
      markerEnd="url(#measure-tick)"
      className="stroke-storefront-gold"
    />
  );
}

export default function MeasurementDiagram() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,240px)_1fr] gap-6 sm:gap-8 items-center bg-storefront-card border border-storefront-border rounded-sm p-5 sm:p-6 mb-6">
      <svg
        viewBox="0 0 320 420"
        role="img"
        aria-label="Kurta sketch marking where to measure bust, waist, hip, shoulder, sleeve, armhole and length"
        className="w-full max-w-[240px] mx-auto"
      >
        <defs>
          <marker id="measure-tick" viewBox="0 0 2 10" refX="1" refY="5" markerWidth="2" markerHeight="10" orient="auto">
            <rect width="2" height="10" className="fill-storefront-gold" />
          </marker>
        </defs>

        <path d={KURTA_OUTLINE} strokeWidth="2" strokeLinejoin="round" className="fill-storefront-cream stroke-storefront-warm" />
        {/* Side seams and placket, for a tailor's-sketch read */}
        <path d="M160 74 L160 150" strokeWidth="1" className="stroke-storefront-border" />

        <Measure d="M110 136 L210 136" />
        <Measure d="M113 200 L207 200" />
        <Measure d="M107 262 L213 262" />
        <Measure d="M95 30 L225 30" />
        <Measure d="M82 52 L33 182" />
        <Measure d="M95 58 Q122 90 108 122" />
        <Measure d="M300 44 L300 390" />
        {/* Guides tying the length line to the neck point and the hem */}
        <path d="M180 44 L300 44 M228 390 L300 390" strokeWidth="1" strokeDasharray="1 3" className="stroke-storefront-muted" />

        <Marker x={160} y={136} n={1} />
        <Marker x={160} y={200} n={2} />
        <Marker x={160} y={262} n={3} />
        <Marker x={160} y={30} n={4} />
        <Marker x={52} y={118} n={5} />
        <Marker x={128} y={96} n={6} />
        <Marker x={300} y={220} n={7} />
      </svg>

      <div>
        <h2 className="font-display text-xl font-semibold text-storefront-charcoal mb-1">How to measure</h2>
        <p className="font-sans text-xs text-storefront-muted mb-4">
          In inches, with a soft tape, snug but not tight. Your bust picks the size; we use the rest for
          blouse stitching and alterations.
        </p>
        <ol className="space-y-2">
          {MEASUREMENTS.map((m) => (
            <li key={m.n} className="flex gap-3 font-sans text-sm leading-snug">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-storefront-charcoal text-storefront-cream text-[11px] font-semibold flex items-center justify-center mt-px">
                {m.n}
              </span>
              <span className="text-storefront-muted">
                <span className="font-medium text-storefront-charcoal">{m.name}:</span> {m.how}
              </span>
            </li>
          ))}
        </ol>
        <p className="font-sans text-xs text-storefront-muted mt-4">
          Tip: lay a kurta or blouse that fits you well flat and measure it the same way.
        </p>
      </div>
    </div>
  );
}
