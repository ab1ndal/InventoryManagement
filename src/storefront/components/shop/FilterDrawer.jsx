import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Left-hand drawer for filters below `lg`. Same open/close pattern as
// CartDrawer (always mounted, slid off-screen and inert when closed); adds
// Escape-to-close, body scroll lock and focus hand-off.
export default function FilterDrawer({ open, onClose, footerLabel, children }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div
          data-testid="filter-backdrop"
          className="fixed inset-0 bg-storefront-charcoal/40 z-[60] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-label="Filters"
        aria-modal={open}
        aria-hidden={!open}
        inert={!open}
        className={`fixed top-0 left-0 h-full w-[88%] max-w-sm bg-storefront-cream z-[70] flex flex-col shadow-xl transition-transform duration-300 ease-out lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-storefront-border">
          <p className="font-display text-xl font-semibold text-storefront-charcoal">Filters</p>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close filters"
            onClick={onClose}
            className="p-2 -mr-2 text-storefront-muted hover:text-storefront-charcoal transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-storefront-charcoal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>

        <div className="border-t border-storefront-border bg-storefront-cream px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs font-medium tracking-widest uppercase py-3.5 hover:bg-storefront-warm transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-gold focus-visible:ring-offset-2"
          >
            {footerLabel}
          </button>
        </div>
      </div>
    </>
  );
}
