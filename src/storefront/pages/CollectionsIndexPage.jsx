import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";
import { COLLECTIONS } from "../lib/collections";

export default function CollectionsIndexPage() {
  return (
    <div className="min-h-screen bg-storefront-cream">
      <Seo title="Collections" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-10 text-center">
          Collections
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {COLLECTIONS.map((c) => (
            <Link
              key={c.slug}
              to={`/collections/${c.slug}`}
              className="group block bg-white border border-storefront-border/70 hover:border-storefront-gold/60 transition-colors p-8 text-center"
            >
              <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-2">
                {c.title}
              </h2>
              {c.subtitle && (
                <p className="font-sans text-sm text-storefront-muted">{c.subtitle}</p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
