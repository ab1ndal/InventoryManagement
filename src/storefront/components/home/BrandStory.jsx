import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

// Real store photo (owner's photos, 2026-10-25). Set to null to fall back to
// the text-only layout; never use a placeholder box.
const STORE_PHOTO_URL = "/store/store-sarees.webp";

export default function BrandStory() {
  return (
    <section className="py-16 sm:py-20 bg-storefront-cream">
      <div
        className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${
          STORE_PHOTO_URL ? "grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16 items-center" : ""
        }`}
      >
        {STORE_PHOTO_URL && (
          <img
            src={STORE_PHOTO_URL}
            alt="Inside the Bindal's Creation store"
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full object-cover rounded-sm"
          />
        )}

        {/* Text */}
        <div className={STORE_PHOTO_URL ? "" : "max-w-2xl mx-auto text-center"}>
          <h2 className="font-display font-semibold text-storefront-charcoal text-[clamp(2rem,4vw,3rem)] leading-tight mb-4">
            Rooted in tradition,<br />handpicked with love
          </h2>
          <p
            className={`font-sans text-sm text-storefront-muted leading-relaxed mb-8 ${
              STORE_PHOTO_URL ? "max-w-md" : "max-w-xl mx-auto"
            }`}
          >
            A family-run shop in Ghaziabad since 2018. We pick every saree,
            lehenga and suit ourselves. Visit us at Sihani Gate Market, or shop
            online.
          </p>
          <Link
            to="/about"
            className="group inline-flex items-center gap-2 text-storefront-charcoal font-sans text-sm font-medium tracking-widest uppercase border-b border-storefront-charcoal/30 hover:border-storefront-gold hover:text-storefront-gold pb-1 transition-colors"
          >
            Read our story
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
