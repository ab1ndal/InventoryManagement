import React from "react";
import Seo from "../components/Seo";
import { FAQ_ITEMS } from "./faqContent";

function FaqItem({ q, a }) {
  return (
    <details className="group border-b border-storefront-border py-5">
      <summary className="flex items-start justify-between gap-4 cursor-pointer list-none font-display text-lg text-storefront-charcoal">
        <span>{q}</span>
        <span className="text-storefront-gold text-xl leading-none flex-shrink-0 transition-transform duration-200 group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-3 text-sm text-storefront-muted font-sans leading-relaxed">
        {a}
      </p>
    </details>
  );
}

export default function FaqPage() {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo
        title="FAQ"
        description="Answers to common questions about delivery, exchanges, payments, sizing, and visiting Bindal's Creations."
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Help
          </span>
        </div>
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-none mb-10">
          Frequently Asked Questions
        </h1>
        <div>
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </div>
  );
}
