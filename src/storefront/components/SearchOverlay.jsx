import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useProductSearch } from "../hooks/useProductSearch";
import { SEARCH_MIN_CHARS } from "../lib/searchUtils";

// Command-palette style product search. Debounced name/category match; results
// link straight to the PDP. Keyboard: ↑/↓ to move, Enter to open, Esc to close.
export default function SearchOverlay({ open, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { results, loading } = useProductSearch(query);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Focus the input on open; clear state on close so the next open starts fresh.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
    setQuery("");
    setActive(0);
  }, [open]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Reset highlight whenever the result set changes.
  useEffect(() => {
    setActive(0);
  }, [results]);

  if (!open) return null;

  const clean = query.trim();

  const go = (product) => {
    navigate(`/product/${product.productid}`);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search products"
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label="Close search"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-storefront-charcoal/40 backdrop-blur-sm cursor-default"
      />

      <div className="relative w-full max-w-xl bg-storefront-cream shadow-xl border border-storefront-border">
        <div className="flex items-center gap-3 px-4 border-b border-storefront-border">
          <Search size={18} className="text-storefront-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sarees, lehengas, suits…"
            className="flex-1 bg-transparent py-4 text-sm font-sans text-storefront-charcoal placeholder:text-storefront-muted focus:outline-none"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={onClose}
            className="p-1 text-storefront-muted hover:text-storefront-charcoal transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <p className="px-4 py-6 text-xs font-sans text-storefront-muted">Searching…</p>
          )}

          {!loading && clean.length < SEARCH_MIN_CHARS && (
            <p className="px-4 py-6 text-xs font-sans text-storefront-muted">
              Type at least {SEARCH_MIN_CHARS} characters to search.
            </p>
          )}

          {!loading && clean.length >= SEARCH_MIN_CHARS && results.length === 0 && (
            <p className="px-4 py-6 text-sm font-sans text-storefront-charcoal">
              No products match “{clean}”.
            </p>
          )}

          {!loading &&
            results.map((product, i) => (
              <button
                key={product.productid}
                type="button"
                onClick={() => go(product)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center justify-between gap-4 px-4 py-3 text-left border-b border-storefront-border/50 last:border-0 transition-colors ${
                  i === active ? "bg-storefront-warm/10" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-sans text-storefront-charcoal truncate">
                    {product.name}
                  </span>
                  {product.categories?.name && (
                    <span className="block text-[11px] font-sans text-storefront-muted">
                      {product.categories.name}
                    </span>
                  )}
                </span>
                <span className="text-sm font-sans tabular-nums text-storefront-charcoal flex-shrink-0">
                  ₹{Number(product.retailprice).toLocaleString("en-IN")}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
