import React from "react";
import Seo from "./Seo";

export default function StaticPage({ eyebrow, title, seoTitle, seoDescription, children }) {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo title={seoTitle || title} description={seoDescription} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        {eyebrow && (
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
            <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
              {eyebrow}
            </span>
          </div>
        )}
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-10">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
