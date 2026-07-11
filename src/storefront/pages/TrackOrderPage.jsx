import React, { useState } from "react";
import Seo from "../components/Seo";

export default function TrackOrderPage() {
  const [orderRef, setOrderRef] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(e) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <Seo title="Track order" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">
        Track your order
      </h1>

      {submitted ? (
        <div className="space-y-4 text-sm font-sans text-storefront-charcoal">
          <p>
            Online order tracking will be available once online orders go live. For any order placed in-store or on WhatsApp, message us at +91 98108 73280 and we'll share the status.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              className="block text-xs font-sans tracking-wide text-storefront-charcoal mb-2"
              htmlFor="orderRef"
            >
              Order Reference
            </label>
            <input
              id="orderRef"
              type="text"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              className="w-full border border-storefront-border bg-white px-3 py-3 text-sm font-sans focus:outline-none focus:border-storefront-gold"
            />
          </div>

          <div>
            <label
              className="block text-xs font-sans tracking-wide text-storefront-charcoal mb-2"
              htmlFor="phone"
            >
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-storefront-border bg-white px-3 py-3 text-sm font-sans focus:outline-none focus:border-storefront-gold"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors"
          >
            Check Status
          </button>
        </form>
      )}
    </div>
  );
}
