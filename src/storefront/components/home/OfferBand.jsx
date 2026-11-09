import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HOME_OFFER } from "../../lib/siteConfig";

const INDIA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dateInIndia(now) {
  const parts = Object.fromEntries(
    INDIA_DATE.formatToParts(now).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isOfferActive(now, endsOn = HOME_OFFER.endsOn) {
  return dateInIndia(now) <= endsOn;
}

export default function OfferBand({ now = new Date() }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  if (!isOfferActive(now)) return null;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(HOME_OFFER.code);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="home-offer-heading" className="bg-storefront-gold text-storefront-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-7 lg:gap-12 lg:items-center">
          <div className="min-w-0">
            <h2
              id="home-offer-heading"
              className="font-display font-semibold text-storefront-cream text-3xl sm:text-4xl leading-tight tracking-[-0.02em] [text-wrap:balance]"
            >
              {HOME_OFFER.headline}
            </h2>
            <p className="font-sans text-sm text-storefront-cream leading-relaxed mt-3">
              {HOME_OFFER.terms}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
            <div className="inline-flex w-full sm:w-auto items-stretch border border-storefront-cream">
              <span className="flex-1 sm:flex-none px-5 py-3 font-sans text-base font-semibold tracking-[0.18em] text-center">
                {HOME_OFFER.code}
              </span>
              <button
                type="button"
                onClick={copyCode}
                aria-label={`Copy offer code ${HOME_OFFER.code}`}
                className="min-w-[7.25rem] border-l border-storefront-cream bg-storefront-charcoal hover:bg-storefront-warm px-4 py-3 font-sans text-xs font-medium tracking-widest uppercase text-storefront-cream active:scale-[0.98] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-cream focus-visible:ring-inset"
              >
                <span aria-live="polite">{copied ? "Copied" : "Copy code"}</span>
              </button>
            </div>
            <Link
              to="/shop"
              className="inline-flex w-full sm:w-auto justify-center items-center border border-storefront-cream hover:bg-storefront-cream hover:text-storefront-charcoal px-7 py-3 font-sans text-xs font-medium tracking-widest uppercase active:scale-[0.98] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-charcoal focus-visible:ring-offset-2 focus-visible:ring-offset-storefront-gold"
            >
              Shop now
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
