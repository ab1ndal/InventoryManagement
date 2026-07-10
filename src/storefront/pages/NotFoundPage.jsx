import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-24">
      <Seo
        title="Page not found"
        description="The page you’re looking for doesn’t exist or may have moved."
        noindex
      />
      <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold mb-4">
        404
      </span>
      <h1 className="font-display text-4xl sm:text-5xl font-semibold text-storefront-charcoal mb-4">
        Page not found
      </h1>
      <p className="font-sans text-sm text-storefront-muted mb-8 max-w-md">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/shop"
          className="bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase px-6 py-3 hover:bg-storefront-warm transition-colors duration-150"
        >
          Continue shopping
        </Link>
        <Link
          to="/"
          className="font-sans text-xs tracking-widest uppercase px-6 py-3 border border-storefront-border text-storefront-charcoal hover:border-storefront-charcoal transition-colors duration-150"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
