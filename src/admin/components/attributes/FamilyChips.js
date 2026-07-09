import React from "react";

// Family membership toggle: each family is a clickable chip; selected chips are
// filled. Optional hexMap renders a swatch dot (colors). Shared by the attribute
// managers and AddFabricDialog. Presentational only — parent owns state.
export default function FamilyChips({ families, selected, onToggle, hexMap }) {
  const sel = new Set(selected || []);
  return (
    <div className="flex flex-wrap gap-1.5">
      {families.map((f) => {
        const on = sel.has(f);
        return (
          <button
            key={f}
            type="button"
            onClick={() => onToggle(f)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
              on
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            {hexMap && (
              <span
                className="h-2.5 w-2.5 rounded-full border border-black/10"
                style={{ background: hexMap[f] || "transparent" }}
              />
            )}
            {f}
          </button>
        );
      })}
    </div>
  );
}
