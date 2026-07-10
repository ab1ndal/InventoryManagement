import React from "react";
import { Link } from "react-router-dom";
import StaticPage from "../components/StaticPage";
import { ABOUT } from "./aboutContent";

export default function AboutPage() {
  return (
    <StaticPage
      eyebrow={ABOUT.eyebrow}
      title={ABOUT.title}
      seoTitle="About"
      seoDescription="The story behind Bindal's Creations — a family-run ethnic-wear house in Ghaziabad."
      containerClassName="max-w-5xl"
    >
      <p className="font-sans text-base text-storefront-muted leading-relaxed max-w-2xl mb-12">
        {ABOUT.lede}
      </p>

      {/* Story */}
      <div className="max-w-2xl space-y-4 mb-14">
        {ABOUT.story.map((para, i) => (
          <p key={i} className="font-sans text-sm text-storefront-charcoal leading-relaxed">
            {para}
          </p>
        ))}
      </div>

      {/* Craftsmanship with image placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mb-14">
        <div>
          <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">
            {ABOUT.craftsmanship.title}
          </h2>
          {ABOUT.craftsmanship.body.map((para, i) => (
            <p key={i} className="font-sans text-sm text-storefront-muted leading-relaxed mb-3">
              {para}
            </p>
          ))}
        </div>
        <div className="aspect-[4/3] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide">
          [Craftsmanship / artisan photo]
        </div>
      </div>

      {/* Values */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-storefront-border pt-10 mb-12">
        {ABOUT.values.map((v) => (
          <div key={v.title}>
            <h3 className="font-display text-lg text-storefront-charcoal mb-1">{v.title}</h3>
            <p className="font-sans text-sm text-storefront-muted leading-relaxed">{v.desc}</p>
          </div>
        ))}
      </div>

      <Link
        to="/shop"
        className="inline-flex items-center gap-2 bg-storefront-charcoal hover:bg-storefront-warm text-storefront-cream font-sans text-sm font-medium tracking-widest uppercase px-10 py-3.5 transition-colors duration-200"
      >
        Shop the Collection
      </Link>
    </StaticPage>
  );
}
