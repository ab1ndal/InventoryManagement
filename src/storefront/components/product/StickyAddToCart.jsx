import React, { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";

// One bar for every viewport. It shows whenever the page's main Add to Cart
// button is off screen — above it after scrolling past, or below the fold on
// a phone before reaching it — so a purchase button is always one tap away
// without ever showing two at once.
export default function StickyAddToCart({ targetRef, image, name, price, label, disabled = false, onClick }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(!entry.isIntersecting);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);

  // The site-wide floating WhatsApp button sits in the same corner; this flag
  // lets it lift above the bar instead of covering its button.
  useEffect(() => {
    if (!visible) return;
    document.body.dataset.stickyCart = "";
    return () => {
      delete document.body.dataset.stickyCart;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      data-testid="sticky-add-to-cart"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-storefront-border animate-in slide-in-from-bottom duration-200"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
        {image && (
          <img
            src={image}
            alt=""
            className="w-10 h-[53px] object-cover object-top flex-shrink-0 bg-storefront-cream"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-storefront-charcoal truncate">{name}</p>
          <p className="font-sans text-sm font-semibold text-storefront-charcoal tabular-nums">
            ₹{Number(price).toLocaleString("en-IN")}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className="flex items-center justify-center gap-2 bg-storefront-gold text-white font-sans text-[11px] tracking-[0.15em] uppercase px-5 sm:px-10 py-3.5 hover:bg-storefront-gold-dark transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <ShoppingBag size={15} aria-hidden="true" />
          {label}
        </button>
      </div>
    </div>
  );
}
