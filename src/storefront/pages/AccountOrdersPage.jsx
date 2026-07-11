import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";

export default function AccountOrdersPage() {
  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
      <Seo title="Order history" noindex />
      <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">Order history</h1>
      <p className="text-sm font-sans text-storefront-muted mb-6">
        Online order history is coming soon. For past in-store purchases, contact us and we'll help.
      </p>
      <Link to="/account" className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
        ← Back to account
      </Link>
    </div>
  );
}
