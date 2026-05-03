import React, { useState, useEffect } from "react";

const PRESETS = [
  { label: "Under ₹1,000", min: null, max: 1000 },
  { label: "₹1k – ₹3k", min: 1000, max: 3000 },
  { label: "₹3k – ₹5k", min: 3000, max: 5000 },
  { label: "₹5k – ₹10k", min: 5000, max: 10000 },
  { label: "₹10,000+", min: 10000, max: null },
];

export default function PriceInputs({ priceMin, priceMax, onSetPrice }) {
  const [localMin, setLocalMin] = useState(priceMin != null ? String(priceMin) : "");
  const [localMax, setLocalMax] = useState(priceMax != null ? String(priceMax) : "");

  useEffect(() => {
    setLocalMin(priceMin != null ? String(priceMin) : "");
  }, [priceMin]);

  useEffect(() => {
    setLocalMax(priceMax != null ? String(priceMax) : "");
  }, [priceMax]);

  function commit(rawMin, rawMax) {
    const min = rawMin === "" ? null : Math.max(0, Number(rawMin));
    const max = rawMax === "" ? null : Math.max(0, Number(rawMax));
    if (min !== null && max !== null && min >= max) return;
    onSetPrice(min === 0 ? null : min, max);
  }

  function isPresetActive(p) {
    return priceMin === p.min && priceMax === p.max;
  }

  return (
    <div className="space-y-4">
      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onSetPrice(p.min, p.max)}
            className={`px-3 py-1 text-[11px] font-montserrat tracking-wide border whitespace-nowrap transition-colors duration-150 cursor-pointer ${
              isPresetActive(p)
                ? "bg-storefront-charcoal text-storefront-cream border-storefront-charcoal"
                : "border-storefront-border text-storefront-warm hover:border-storefront-charcoal hover:text-storefront-charcoal"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Free inputs */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-[10px] text-storefront-muted font-montserrat tracking-[0.15em] uppercase mb-1.5">
            Min
          </label>
          <div className="flex items-center border border-storefront-border focus-within:border-storefront-charcoal transition-colors">
            <span className="pl-2.5 text-sm text-storefront-muted font-montserrat select-none">₹</span>
            <input
              type="number"
              min={0}
              step={100}
              placeholder="0"
              value={localMin}
              onChange={(e) => setLocalMin(e.target.value)}
              onBlur={() => commit(localMin, localMax)}
              onKeyDown={(e) => e.key === "Enter" && commit(localMin, localMax)}
              className="w-full px-2 py-2 text-sm font-montserrat text-storefront-charcoal bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>

        <span className="text-storefront-muted text-sm pb-2.5 flex-shrink-0">–</span>

        <div className="flex-1">
          <label className="block text-[10px] text-storefront-muted font-montserrat tracking-[0.15em] uppercase mb-1.5">
            Max
          </label>
          <div className="flex items-center border border-storefront-border focus-within:border-storefront-charcoal transition-colors">
            <span className="pl-2.5 text-sm text-storefront-muted font-montserrat select-none">₹</span>
            <input
              type="number"
              min={0}
              step={100}
              placeholder="Any"
              value={localMax}
              onChange={(e) => setLocalMax(e.target.value)}
              onBlur={() => commit(localMin, localMax)}
              onKeyDown={(e) => e.key === "Enter" && commit(localMin, localMax)}
              className="w-full px-2 py-2 text-sm font-montserrat text-storefront-charcoal bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
