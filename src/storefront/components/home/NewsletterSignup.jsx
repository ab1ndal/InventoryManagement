import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!email) return;
    // TODO: wire to Supabase Edge Function / Resend in Phase 6
    setSubmitted(true);
    toast.success("You're on the list! We'll be in touch soon.");
  }

  return (
    <section className="py-20 bg-storefront-cream px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto text-center">
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-montserrat text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Stay Connected
          </span>
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
        </div>
        <h2 className="font-cormorant font-semibold text-4xl sm:text-5xl text-storefront-charcoal mb-3">
          Join Our World
        </h2>
        <p className="font-montserrat text-sm text-storefront-muted max-w-sm mx-auto mb-8 leading-relaxed">
          Be the first to know about new collections, exclusive offers, and style inspiration.
        </p>

        {submitted ? (
          <p className="font-cormorant text-xl text-storefront-gold italic">
            Thank you for subscribing! ✦
          </p>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email address"
              aria-label="Email address"
              className="flex-1 px-4 py-3 border border-storefront-border bg-white font-montserrat text-sm text-storefront-charcoal placeholder:text-storefront-muted focus:outline-none focus:border-storefront-gold transition-colors"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 bg-storefront-charcoal hover:bg-storefront-warm text-storefront-cream font-montserrat text-sm font-medium tracking-widest uppercase px-6 py-3 transition-colors duration-200 cursor-pointer"
            >
              Subscribe <ArrowRight size={14} />
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
