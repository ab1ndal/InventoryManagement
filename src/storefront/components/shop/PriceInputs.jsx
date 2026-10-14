import React, { useState, useEffect, useId } from "react";

export default function PriceInputs({ priceMin, priceMax, onSetPrice }) {
  // The sidebar is mounted twice (desktop column + mobile drawer), so label
  // ids must be unique per instance.
  const id = useId();
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
    const nextMin = min === 0 ? null : min;
    // Filters apply instantly, so a blur with nothing changed must not
    // re-run the product query.
    if (nextMin === (priceMin ?? null) && max === (priceMax ?? null)) return;
    onSetPrice(nextMin, max);
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label
          htmlFor={`${id}-min`}
          className="block text-[10px] text-storefront-muted font-sans tracking-[0.15em] uppercase mb-1.5"
        >
          Min
        </label>
        <div className="flex items-center border border-storefront-border focus-within:border-storefront-charcoal transition-colors">
          <span className="pl-2.5 text-sm text-storefront-muted font-sans select-none">₹</span>
          <input
            id={`${id}-min`}
            type="number"
            min={0}
            step={100}
            placeholder="0"
            value={localMin}
            onChange={(e) => setLocalMin(e.target.value)}
            onBlur={() => commit(localMin, localMax)}
            onKeyDown={(e) => e.key === "Enter" && commit(localMin, localMax)}
            className="w-full px-2 py-2 text-sm font-sans text-storefront-charcoal bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
      </div>

      <span className="text-storefront-muted text-sm pb-2.5 flex-shrink-0">–</span>

      <div className="flex-1">
        <label
          htmlFor={`${id}-max`}
          className="block text-[10px] text-storefront-muted font-sans tracking-[0.15em] uppercase mb-1.5"
        >
          Max
        </label>
        <div className="flex items-center border border-storefront-border focus-within:border-storefront-charcoal transition-colors">
          <span className="pl-2.5 text-sm text-storefront-muted font-sans select-none">₹</span>
          <input
            id={`${id}-max`}
            type="number"
            min={0}
            step={100}
            placeholder="Any"
            value={localMax}
            onChange={(e) => setLocalMax(e.target.value)}
            onBlur={() => commit(localMin, localMax)}
            onKeyDown={(e) => e.key === "Enter" && commit(localMin, localMax)}
            className="w-full px-2 py-2 text-sm font-sans text-storefront-charcoal bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
      </div>
    </div>
  );
}
