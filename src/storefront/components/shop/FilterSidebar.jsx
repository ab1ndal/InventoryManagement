import React, { useId, useState } from "react";
import { Check } from "lucide-react";
import PriceInputs from "./PriceInputs";
import { PRICE_PRESETS, activePresetIndex } from "../../lib/pricePresets";

// Options beyond this many sit behind "View more".
const VISIBLE_LIMIT = 8;

// Families with no single hex (Multi/Printed) get a rainbow swatch.
const MULTI_GRADIENT =
  "conic-gradient(from 0deg, #e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c)";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-storefront-charcoal focus-visible:ring-offset-2 focus-visible:ring-offset-storefront-cream";

function isLightHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
}

function Section({ title, onClear, children }) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="py-5 border-b border-storefront-border first:pt-0 last:border-b-0"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2
          id={headingId}
          className="font-sans text-[11px] font-semibold tracking-[0.18em] uppercase text-storefront-charcoal"
        >
          {title}
        </h2>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${title}`}
            className={`font-sans text-[11px] tracking-wide text-storefront-muted underline underline-offset-2 hover:text-storefront-charcoal transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}
          >
            Clear
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Swatch({ hex }) {
  return (
    <span
      aria-hidden="true"
      className={`w-3.5 h-3.5 rounded-full flex-shrink-0 ${
        !hex || isLightHex(hex) ? "ring-1 ring-inset ring-storefront-border" : ""
      }`}
      style={hex ? { backgroundColor: hex } : { background: MULTI_GRADIENT }}
    />
  );
}

// Checkbox-style list. Visibility: an option missing from `baseSet` (no
// products at all) is hidden; one missing from `availableSet` (no products
// under the other active filters) is greyed and inert. Selected options are
// always shown and clickable so a dead-end selection can be undone. A null
// set means "unknown" and restricts nothing.
function OptionList({ field, options, getKey, getLabel, getSwatch, selected, availableSet, baseSet, onToggle }) {
  const [expanded, setExpanded] = useState(false);

  const shown = options.filter((o) => {
    const key = getKey(o);
    return !baseSet || baseSet.has(key) || selected.includes(key);
  });
  const visible = expanded ? shown : shown.slice(0, VISIBLE_LIMIT);
  const hiddenCount = shown.length - VISIBLE_LIMIT;

  return (
    <>
      <ul className="space-y-0.5">
        {visible.map((o) => {
          const key = getKey(o);
          const label = getLabel(o);
          const active = selected.includes(key);
          const disabled = !active && availableSet != null && !availableSet.has(key);
          return (
            <li key={key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={active}
                aria-disabled={disabled || undefined}
                onClick={disabled ? undefined : () => onToggle(field, key)}
                className={`group w-full flex items-center gap-2.5 py-1.5 text-left font-sans text-[13px] transition-colors duration-150 ${FOCUS_RING} ${
                  disabled
                    ? "opacity-40 cursor-not-allowed"
                    : "cursor-pointer"
                } ${active ? "text-storefront-charcoal font-medium" : "text-storefront-warm"}`}
              >
                <span
                  aria-hidden="true"
                  className={`w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
                    active
                      ? "bg-storefront-charcoal border-storefront-charcoal"
                      : `bg-white border-storefront-border ${disabled ? "" : "group-hover:border-storefront-charcoal"}`
                  }`}
                >
                  {active && <Check size={11} strokeWidth={2.5} className="text-storefront-cream" />}
                </span>
                {getSwatch && <Swatch hex={getSwatch(o)} />}
                <span className={`truncate ${disabled ? "" : "group-hover:text-storefront-charcoal"}`}>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className={`mt-2 font-sans text-[11px] tracking-[0.12em] uppercase text-storefront-gold hover:text-storefront-gold-dark transition-colors duration-150 cursor-pointer ${FOCUS_RING}`}
        >
          {expanded ? "View less" : `View more (${hiddenCount})`}
        </button>
      )}
    </>
  );
}

function PriceSection({ priceMin, priceMax, setPrice, clearPrice }) {
  const active = activePresetIndex(priceMin, priceMax);
  return (
    <>
      <ul className="space-y-0.5 mb-4">
        {PRICE_PRESETS.map((p, i) => {
          const on = i === active;
          return (
            <li key={p.label}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => (on ? clearPrice() : setPrice(p.min, p.max))}
                className={`group w-full flex items-center gap-2.5 py-1.5 text-left font-sans text-[13px] transition-colors duration-150 cursor-pointer ${FOCUS_RING} ${
                  on ? "text-storefront-charcoal font-medium" : "text-storefront-warm hover:text-storefront-charcoal"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors duration-150 ${
                    on
                      ? "border-storefront-charcoal"
                      : "bg-white border-storefront-border group-hover:border-storefront-charcoal"
                  }`}
                >
                  {on && <span className="w-2 h-2 rounded-full bg-storefront-charcoal" />}
                </span>
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>
      <PriceInputs priceMin={priceMin} priceMax={priceMax} onSetPrice={setPrice} />
    </>
  );
}

export default function FilterSidebar({
  filters,
  categoryOptions = [],
  colorOptions = [],
  colorFamilyHex = {},
  sizeOptions = [],
  sizeDisplayMap = {},
  fabricOptions = [],
  availableOptions,
  baseOptions,
  toggle,
  setPrice,
  clearField,
  clearOne,
}) {
  const avail = availableOptions ?? null;
  const base = baseOptions ?? null;
  const priceActive = filters.priceMin != null || filters.priceMax != null;

  const clearPrice = () => clearOne("price", "price");

  // One checkbox-list section; skipped until its options have loaded.
  const listSection = (field, title, options, getKey, getLabel, getSwatch) =>
    options.length > 0 && (
      <Section
        title={title}
        onClear={filters[field].length > 0 ? () => clearField(field) : null}
      >
        <OptionList
          field={field}
          options={options}
          getKey={getKey}
          getLabel={getLabel}
          getSwatch={getSwatch}
          selected={filters[field]}
          availableSet={avail?.[field] ?? null}
          baseSet={base?.[field] ?? null}
          onToggle={toggle}
        />
      </Section>
    );

  const identity = (v) => v;

  return (
    <div>
      {listSection("categories", "Category", categoryOptions, (c) => c.categoryid, (c) => c.name)}
      <Section title="Price" onClear={priceActive ? clearPrice : null}>
        <PriceSection
          priceMin={filters.priceMin}
          priceMax={filters.priceMax}
          setPrice={setPrice}
          clearPrice={clearPrice}
        />
      </Section>
      {listSection("sizes", "Size", sizeOptions, identity, (s) => sizeDisplayMap[s] ?? s)}
      {listSection("colors", "Colour", colorOptions, identity, identity, (c) => colorFamilyHex[c])}
      {listSection("fabrics", "Fabric", fabricOptions, identity, identity)}
    </div>
  );
}
