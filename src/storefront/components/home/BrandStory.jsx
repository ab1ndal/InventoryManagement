import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export default function BrandStory() {
  return (
    <section className="py-20 bg-storefront-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16 items-center">
        {/* Image */}
        <div className="aspect-[4/3] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide order-1 md:order-none">
          [Brand / store photo]
        </div>

        {/* Text */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8 bg-storefront-gold" aria-hidden="true" />
            <span className="font-sans text-xs tracking-[0.3em] uppercase text-storefront-gold">
              Our Story
            </span>
          </div>
          <h2 className="font-display font-semibold text-storefront-charcoal text-[clamp(2rem,4vw,3rem)] leading-tight mb-4">
            Rooted in tradition,<br />crafted with love
          </h2>
          <p className="font-sans text-sm text-storefront-muted leading-relaxed max-w-md mb-8">
            A family-run ethnic-wear house in Ghaziabad, bringing handpicked
            sarees, lehengas, and suits to families who care about craft. Come
            visit us in person, or explore the collection online.
          </p>
          <Link
            to="/about"
            className="group inline-flex items-center gap-2 text-storefront-charcoal font-sans text-sm font-medium tracking-widest uppercase border-b border-storefront-charcoal/30 hover:border-storefront-gold hover:text-storefront-gold pb-1 transition-colors"
          >
            Our Story
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
