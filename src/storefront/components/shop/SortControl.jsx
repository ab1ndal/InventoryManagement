import React from "react";
import { SORT_OPTIONS } from "../../hooks/sortOptions";

export default function SortControl({ value, onChange }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-sans tracking-[0.12em] uppercase text-storefront-muted">
        Sort
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Sort products"
        className="bg-transparent border border-storefront-border text-storefront-charcoal font-sans text-xs tracking-wide px-2.5 py-1.5 cursor-pointer hover:border-storefront-charcoal focus:outline-none focus:border-storefront-charcoal transition-colors"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
